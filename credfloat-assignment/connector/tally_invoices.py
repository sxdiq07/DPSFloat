"""
Bill-wise outstanding invoice extraction via Tally XML HTTP.

Tally ODBC is great for ledger-level data but cannot surface bill-wise
outstanding entries. For that we POST an XML envelope to Tally's HTTP
server (same port 9000) and parse the response.

Requires "TallyPrime is acting as: Both" (ODBC + Web Server) in
F1 → Settings → Connectivity. Same toggle the ODBC side uses.

Tested against Tally Prime 7.x with the default Bills collection TDL
shipped in this file. If the ledger schema differs for your installation
(older Tally.ERP 9 or custom TDL), the OUTSTANDING_TDL request body
below is the single place to adjust.
"""

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import requests

log = logging.getLogger("credfloat-connector.invoices")


@dataclass
class InvoiceRecord:
    company: str                  # Tally company name (matches ClientCompany.tallyCompanyName)
    tally_ledger_name: str        # debtor ledger name (maps to Party.tallyLedgerName)
    bill_ref: str                 # unique bill reference
    bill_date: str                # ISO yyyy-mm-dd
    due_date: Optional[str]       # ISO yyyy-mm-dd; None if no credit period
    original_amount: float        # original bill amount
    outstanding_amount: float     # current balance (what we care about)


# TDL that fetches every bill with a non-zero debtor opening balance.
# `$$IsDr:$OpeningBalance` filters to debtor-side bills (positive when owed).
# `$BillCreditPeriod` is used to compute due date = BillDate + credit days.
OUTSTANDING_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatBillsOutstanding</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatBillsOutstanding" ISMODIFY="No">
            <TYPE>Bills</TYPE>
            <FETCH>$Name, $PartyLedgerName, $BillDate, $BillCreditPeriod, $OpeningBalance, $Amount</FETCH>
            <FILTER>CredFloatIsDebtor</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="CredFloatIsDebtor">$$IsDr:$OpeningBalance AND NOT $$IsEmpty:$PartyLedgerName</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def _parse_tally_date(s: Optional[str]) -> Optional[str]:
    """Tally dates come in multiple formats — yyyymmdd, d-MMM-yyyy, etc.
    Normalise to ISO yyyy-mm-dd; return None on garbage."""
    if not s:
        return None
    s = s.strip()
    if not s or s == "0":
        return None
    for fmt in ("%Y%m%d", "%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    log.warning(f"Could not parse Tally date: {s!r}")
    return None


def _parse_credit_days(s: Optional[str]) -> int:
    if not s:
        return 0
    # Tally credit-period is typed like '30 Days' or just '30'
    digits = "".join(ch for ch in s if ch.isdigit())
    return int(digits) if digits else 0


def _parse_amount(s: Optional[str]) -> float:
    if not s:
        return 0.0
    # Tally amount looks like "12345.00 Dr" or "-1234.00"
    s = s.strip().replace(",", "")
    sign = 1.0
    if s.endswith("Cr"):
        sign = -1.0
        s = s[:-2].strip()
    elif s.endswith("Dr"):
        s = s[:-2].strip()
    try:
        return sign * float(s)
    except ValueError:
        return 0.0


def fetch_bill_wise_outstanding(
    company_name: str,
    tally_url: str = "http://localhost:9000",
    timeout: int = 60,
) -> list[InvoiceRecord]:
    """
    Synchronous XML HTTP request to Tally. Returns one InvoiceRecord per
    open debtor bill. Empty list if the report is empty or Tally is down.
    """
    body = OUTSTANDING_TDL.format(company=_xml_escape(company_name))
    log.info(f"Fetching bill-wise outstanding from Tally (company={company_name})")

    try:
        r = requests.post(
            tally_url,
            data=body.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            timeout=timeout,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        log.error(f"Tally XML HTTP request failed: {e}")
        return []

    # Tally often emits non-strict XML with stray whitespace and sometimes
    # Windows-1252 bytes. Best-effort parse; log and continue on error.
    raw = r.content
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        log.error(f"Tally response parse error: {e}")
        return []

    invoices: list[InvoiceRecord] = []
    # Look for BILLS or BILLS.LIST children — the exact path varies by TDL
    # response shape. We scan for any element whose tag starts with BILLS.
    for node in root.iter():
        if not node.tag or not node.tag.upper().startswith("BILLS"):
            continue
        # Each bills node may contain repeated BILL entries
        bills = (
            list(node.findall("BILL"))
            or list(node.findall("BILLS"))
            or [node]
        )
        for b in bills:
            name = (b.findtext("NAME") or b.findtext("BILLNAME") or "").strip()
            party = (b.findtext("PARTYLEDGERNAME") or "").strip()
            bill_date = _parse_tally_date(b.findtext("BILLDATE"))
            credit_days = _parse_credit_days(b.findtext("BILLCREDITPERIOD"))
            opening = _parse_amount(b.findtext("OPENINGBALANCE"))
            amount = _parse_amount(b.findtext("AMOUNT") or b.findtext("OPENINGBALANCE"))

            # Only debtor bills (positive opening)
            if opening <= 0 or not name or not party or not bill_date:
                continue

            due_date = None
            if credit_days > 0:
                d = datetime.fromisoformat(bill_date).date()
                due_date = (d.toordinal() + credit_days)
                due_date = date.fromordinal(due_date).isoformat()

            invoices.append(
                InvoiceRecord(
                    company=company_name,
                    tally_ledger_name=party,
                    bill_ref=name,
                    bill_date=bill_date,
                    due_date=due_date,
                    original_amount=abs(amount) or opening,
                    outstanding_amount=opening,
                )
            )

    log.info(f"  Parsed {len(invoices)} bill-wise outstanding entries")
    return invoices


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
