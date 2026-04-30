"""Single-shot sync entry point.

Wraps the existing tally_connector pipeline (TallyReader + invoices + receipts +
day book) so the service loop can call it on a schedule with retry/backoff.
"""
from __future__ import annotations
import json
import logging
from dataclasses import asdict
from datetime import datetime, timezone

import requests

# These modules already exist in the connector folder.
import tally_connector as tc
from tally_invoices import fetch_bill_wise_outstanding
from tally_receipts import fetch_receipts
from tally_daybook import fetch_day_book

from .config import ConnectorConfig

log = logging.getLogger("credfloat.syncer")


class SyncError(RuntimeError):
    """Raised on any unrecoverable sync failure."""


def run_once(cfg: ConnectorConfig) -> dict:
    """Read Tally, push to API, return the API response dict.

    Raises SyncError on any failure so the caller can decide whether to retry.
    """
    if not cfg.is_complete():
        raise SyncError("Connector is not configured. Open Setup first.")

    # The existing TallyReader reads DSN from module-level config that loads
    # from .env. Override at runtime so the .exe honours the user's choices.
    tc.DSN = cfg.tally_dsn
    tc.API_URL = cfg.api_url
    tc.API_KEY = cfg.api_key
    tc.TALLY_HTTP_URL = cfg.tally_http_url
    tc.DRY_RUN = False

    reader = tc.TallyReader(dsn=cfg.tally_dsn)
    try:
        tally = reader.__enter__()
    except SystemExit as e:
        raise SyncError(
            "Tally ODBC connection failed. Is Tally running with ODBC server enabled?"
        ) from e
    try:
        companies = tally.list_companies()
        log.info("Tally reports %d companies loaded.", len(companies))

        all_parties = []
        all_invoices = []
        all_receipts = []
        all_daybook = []
        for c in companies:
            parties = tally.list_debtor_ledgers(c.tally_name)
            parties = [p for p in parties if p.closing_balance > 0.01]
            log.info("  %s: %d debtors with outstanding", c.tally_name, len(parties))
            all_parties.extend(parties)

            invoices = fetch_bill_wise_outstanding(
                c.tally_name, tally_url=cfg.tally_http_url
            )
            log.info("  %s: %d bill-wise entries", c.tally_name, len(invoices))
            all_invoices.extend(invoices)

            receipts = fetch_receipts(c.tally_name, tally_url=cfg.tally_http_url)
            log.info("  %s: %d receipts", c.tally_name, len(receipts))
            all_receipts.extend(receipts)

            debtor_names = {p.tally_ledger_name for p in parties}
            entries = fetch_day_book(
                c.tally_name, debtor_names, tally_url=cfg.tally_http_url
            )
            log.info("  %s: %d day-book entries", c.tally_name, len(entries))
            all_daybook.extend(entries)

        payload = tc.SyncPayload(
            synced_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            companies=[asdict(c) for c in companies],
            parties=[asdict(p) for p in all_parties],
            invoices=[asdict(i) for i in all_invoices],
            receipts=[asdict(r) for r in all_receipts],
            day_book=[asdict(d) for d in all_daybook],
        )
    finally:
        reader.__exit__(None, None, None)

    body = asdict(payload)
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(cfg.api_url, json=body, headers=headers, timeout=300)
    except requests.RequestException as e:
        raise SyncError(f"API push failed: {e}") from e

    if r.status_code >= 400:
        raise SyncError(f"API returned HTTP {r.status_code}: {r.text[:300]}")

    try:
        return r.json()
    except ValueError:
        return {"status_code": r.status_code}
