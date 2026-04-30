"""Single-shot sync entry point — HTTP-XML only.

Drops the ODBC dependency. All Tally reads (companies, debtor ledgers,
invoices, receipts, day-book) go through Tally's HTTP server on port 9000.
"""
from __future__ import annotations
import logging
from dataclasses import asdict
from datetime import datetime, timezone

import requests

from tally_parties import fetch_companies, fetch_debtor_ledgers
from tally_invoices import fetch_bill_wise_outstanding
from tally_receipts import fetch_receipts
from tally_daybook import fetch_day_book

from .config import ConnectorConfig

log = logging.getLogger("credfloat.syncer")


class SyncError(RuntimeError):
    """Raised on any unrecoverable sync failure."""


def _ping_tally(tally_url: str, timeout: int = 5) -> bool:
    """Quick GET to confirm the Tally HTTP server is up before pulling data."""
    try:
        r = requests.get(tally_url, timeout=timeout)
        return r.status_code < 500
    except requests.RequestException:
        return False


def run_once(cfg: ConnectorConfig) -> dict:
    if not cfg.is_complete():
        raise SyncError("Connector is not configured. Open Setup first.")

    if not _ping_tally(cfg.tally_http_url):
        raise SyncError(
            "Tally is not reachable on " + cfg.tally_http_url +
            ". Open Tally Prime, load a company, and enable F1 -> Settings -> "
            "Connectivity -> Client/Server -> ODBC Server."
        )

    companies = fetch_companies(cfg.tally_http_url)
    if not companies:
        raise SyncError(
            "Tally returned no companies. Make sure a company is loaded in Tally."
        )
    log.info("Tally reports %d companies loaded.", len(companies))

    all_parties = []
    all_invoices = []
    all_receipts = []
    all_daybook = []

    for c in companies:
        parties = fetch_debtor_ledgers(c.tally_name, tally_url=cfg.tally_http_url)
        parties = [p for p in parties if p.closing_balance > 0.01]
        log.info("  %s: %d debtors with outstanding", c.tally_name, len(parties))
        all_parties.extend(parties)

        invoices = fetch_bill_wise_outstanding(c.tally_name, tally_url=cfg.tally_http_url)
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

    payload = {
        "synced_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "companies": [asdict(c) for c in companies],
        "parties": [asdict(p) for p in all_parties],
        "invoices": [asdict(i) for i in all_invoices],
        "receipts": [asdict(r) for r in all_receipts],
        "day_book": [asdict(d) for d in all_daybook],
        # Allocation runs in a separate chunked endpoint so the upsert step
        # stays under Vercel's 60s function ceiling on large syncs.
        "skip_allocation": True,
    }

    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(cfg.api_url, json=payload, headers=headers, timeout=300)
    except requests.RequestException as e:
        raise SyncError(f"API push failed: {e}") from e
    if r.status_code >= 400:
        raise SyncError(f"API returned HTTP {r.status_code}: {r.text[:300]}")

    try:
        upsert_result = r.json()
    except ValueError:
        upsert_result = {"status_code": r.status_code}

    # --- Phase 2: allocate in chunks of ALLOCATE_CHUNK party ids ----------
    pending = upsert_result.get("pendingAllocationPartyIds") or []
    allocate_url = cfg.api_url.rsplit("/", 1)[0] + "/sync/allocate"
    ALLOCATE_CHUNK = 25
    alloc_summary = {"partiesProcessed": 0, "invoicesUpdated": 0, "advanceTotal": 0.0}

    for i in range(0, len(pending), ALLOCATE_CHUNK):
        chunk = pending[i : i + ALLOCATE_CHUNK]
        try:
            ar = requests.post(
                allocate_url,
                json={"partyIds": chunk},
                headers=headers,
                timeout=120,
            )
        except requests.RequestException as e:
            raise SyncError(f"Allocate call failed: {e}") from e
        if ar.status_code >= 400:
            raise SyncError(
                f"Allocate returned HTTP {ar.status_code}: {ar.text[:300]}"
            )
        try:
            ad = ar.json().get("allocated", {})
        except ValueError:
            ad = {}
        alloc_summary["partiesProcessed"] += ad.get("partiesProcessed", 0)
        alloc_summary["invoicesUpdated"] += ad.get("invoicesUpdated", 0)
        alloc_summary["advanceTotal"] += ad.get("advanceTotal", 0.0)
        log.info(
            "  Allocated chunk %d-%d of %d (invoices touched: %d)",
            i + 1, i + len(chunk), len(pending), ad.get("invoicesUpdated", 0),
        )

    upsert_result["allocation"] = alloc_summary
    return upsert_result
