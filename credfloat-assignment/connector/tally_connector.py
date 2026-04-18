"""
CredFloat Tally Connector — V1

Reads debtor data from Tally Prime via ODBC and pushes to CredFloat cloud API.

Setup checklist:
1. Tally Prime 7.0 running with manager's backup restored
2. In Tally: F1 (Help) -> Settings -> Connectivity -> ODBC Server ON (port 9000)
3. Windows: install Tally ODBC driver (match Python bitness - 64-bit recommended)
   Then configure DSN named 'TallyODBC_9000' in Windows ODBC Data Sources (64-bit)
4. Python 3.11+, then: pip install -r requirements.txt
5. Copy .env.example to .env, fill in values
6. First run with DRY_RUN=true to see payload without pushing
7. Run: python tally_connector.py

Design notes:
- Read-only. Never writes to Tally.
- V1 reads from the currently-loaded company in Tally. Multi-company iteration
  (via SELECT COMPANY command) is Phase 2.
- Closing balance sign is flipped: positive = outstanding receivable from debtor.
"""

import os
import sys
import json
import logging
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import Optional

import pyodbc
import requests
from dotenv import load_dotenv

load_dotenv()

# --- Configuration ---
DSN = os.getenv("TALLY_DSN", "TallyODBC_9000")
API_URL = os.getenv("CREDFLOAT_API_URL", "http://localhost:3000/api/sync")
API_KEY = os.getenv("CREDFLOAT_API_KEY", "")
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("credfloat-connector")


# --- Domain models ---
@dataclass
class CompanyRecord:
    tally_name: str


@dataclass
class PartyRecord:
    company: str
    tally_ledger_name: str
    parent_group: str
    closing_balance: float
    # Contact fields depend on your Tally ODBC schema.
    # Run TallyReader.inspect_ledger_columns() on first run to see what's exposed.
    mailing_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None


@dataclass
class SyncPayload:
    synced_at: str
    companies: list = field(default_factory=list)
    parties: list = field(default_factory=list)


# --- Tally ODBC Reader ---
class TallyReader:
    """Context-managed Tally ODBC connection."""

    def __init__(self, dsn: str = DSN):
        self.dsn = dsn
        self.conn = None

    def __enter__(self):
        log.info(f"Connecting to Tally ODBC (DSN={self.dsn})")
        try:
            self.conn = pyodbc.connect(f"DSN={self.dsn}", timeout=10)
            log.info("Tally ODBC connected.")
        except pyodbc.Error as e:
            log.error(f"ODBC connection failed: {e}")
            log.error(
                "Checklist: (1) Is Tally running? "
                "(2) ODBC server enabled on port 9000? "
                "(3) DSN 'TallyODBC_9000' configured in Windows ODBC Admin?"
            )
            sys.exit(1)
        return self

    def __exit__(self, *args):
        if self.conn:
            self.conn.close()
            log.info("Tally ODBC connection closed.")

    def inspect_ledger_columns(self) -> list:
        """
        Run once on a new Tally setup to see which columns ODBC exposes for Ledger.
        Column availability varies by Tally Prime release.
        """
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM Ledger")
        cols = [d[0] for d in cur.description]
        log.info(f"Ledger columns available in this Tally build: {cols}")
        return cols

    def list_companies(self) -> list[CompanyRecord]:
        cur = self.conn.cursor()
        cur.execute("SELECT $Name FROM Company")
        return [CompanyRecord(tally_name=row[0]) for row in cur.fetchall()]

    def list_debtor_ledgers(self, company_name: str) -> list[PartyRecord]:
        """
        Extract all ledgers under the 'Sundry Debtors' group.

        If the firm uses custom debtor groups (e.g. 'Trade Debtors' or 'Debtors -
        Domestic'), extend the WHERE clause or query the Group table first to
        collect all child groups of 'Sundry Debtors'.

        Contact field names confirmed against Tally Prime 7.x Ledger schema:
        $EMail, $LedgerMobile, $LedgerPhone, $LedgerContact, $_Address1..5.
        Any of these may be null for any given ledger; the web upsert handles
        null/empty values as "no update" rather than clobbering stored values.
        """
        cur = self.conn.cursor()
        cur.execute(
            """
            SELECT $Name, $Parent, $ClosingBalance,
                   $EMail, $LedgerMobile, $LedgerPhone, $LedgerContact,
                   $_Address1, $_Address2, $_Address3, $_Address4, $_Address5
            FROM Ledger
            WHERE $Parent = 'Sundry Debtors'
            """
        )
        parties = []
        for row in cur.fetchall():
            (
                name, parent, closing,
                email, mobile, phone_landline, phone_contact,
                addr1, addr2, addr3, addr4, addr5,
            ) = row
            # Tally convention: debtor balance is negative when party owes us.
            # Flip sign so downstream "positive = outstanding" logic is intuitive.
            outstanding = -float(closing or 0)
            # Concatenate address lines, skipping blanks
            address = "\n".join(
                line.strip() for line in (addr1, addr2, addr3, addr4, addr5)
                if line and str(line).strip()
            ) or None
            parties.append(
                PartyRecord(
                    company=company_name,
                    tally_ledger_name=name or "",
                    parent_group=parent or "",
                    closing_balance=outstanding,
                    address=address,
                    email=(email or None) and str(email).strip() or None,
                    phone=(phone_landline or phone_contact or None) and
                          str(phone_landline or phone_contact).strip() or None,
                    whatsapp_number=(mobile or None) and str(mobile).strip() or None,
                )
            )
        return parties


# --- API Client ---
def push_to_api(payload: SyncPayload) -> None:
    body = asdict(payload)

    if DRY_RUN:
        log.info("DRY_RUN=true -- printing payload instead of pushing.")
        print("\n" + "=" * 60)
        print(json.dumps(body, indent=2, default=str))
        print("=" * 60 + "\n")
        log.info(f"Dry run complete. {len(payload.parties)} parties would be synced.")
        return

    if not API_KEY:
        log.error("CREDFLOAT_API_KEY not set in .env -- aborting push.")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        r = requests.post(API_URL, json=body, headers=headers, timeout=300)
        r.raise_for_status()
        log.info(f"Synced to CredFloat API: HTTP {r.status_code}")
        try:
            log.info(f"Response: {r.json()}")
        except ValueError:
            pass
    except requests.RequestException as e:
        log.error(f"API push failed: {e}")
        sys.exit(1)


# --- Main ---
def main():
    with TallyReader() as tally:
        # Uncomment on first run against a new Tally build:
        # tally.inspect_ledger_columns()

        companies = tally.list_companies()
        log.info(f"Tally reports {len(companies)} companies loaded.")

        all_parties = []
        for c in companies:
            # V1: reads only from the active company. Multi-company iteration
            # requires SELECT COMPANY via Tally XML (Phase 2).
            parties = tally.list_debtor_ledgers(c.tally_name)
            # Keep only parties with actual outstanding amounts.
            parties = [p for p in parties if p.closing_balance > 0.01]
            log.info(f"  {c.tally_name}: {len(parties)} debtors with outstanding")
            all_parties.extend(parties)

        payload = SyncPayload(
            synced_at=datetime.utcnow().isoformat() + "Z",
            companies=[asdict(c) for c in companies],
            parties=[asdict(p) for p in all_parties],
        )
        log.info(
            f"Prepared sync: {len(payload.companies)} companies, "
            f"{len(payload.parties)} parties."
        )
        push_to_api(payload)


if __name__ == "__main__":
    main()
