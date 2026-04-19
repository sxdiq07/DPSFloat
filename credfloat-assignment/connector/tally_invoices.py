"""
Bill-wise outstanding extraction via Tally XML HTTP.

Uses Tally's built-in `Bills` collection with an explicit FETCH list.
Tested against Tally Prime 7.x / Tally.ERP 9.

Key schema findings (verified against a real ledger):
  <BILL NAME="..." RESERVEDNAME="...">
    <NAME>bill ref</NAME>
    <PARENT>party ledger name</PARENT>
    <BILLDATE>YYYYMMDD</BILLDATE>
    <BILLCREDITPERIOD>30 Days</BILLCREDITPERIOD> (often empty)
    <OPENINGBALANCE>positive = debtor owes</OPENINGBALANCE>
    <CLOSINGBALANCE>current balance after adjustments</CLOSINGBALANCE>
  </BILL>

CLOSINGBALANCE > 0 = debtor still owes (filter).
CLOSINGBALANCE <= 0 = paid / credit-note / overpayment (skip).
"""

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import requests

log = logging.getLogger("credfloat-connector.invoices")


@dataclass
class InvoiceRecord:
    company: str                  # matches ClientCompany.tallyCompanyName
    tally_ledger_name: str        # party's ledger name (maps to Party.tallyLedgerName)
    bill_ref: str
    bill_date: str                # ISO yyyy-mm-dd
    due_date: Optional[str]
    original_amount: float
    outstanding_amount: float


OUTSTANDING_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatAllBills</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatAllBills" ISMODIFY="No">
            <TYPE>Bills</TYPE>
            <FETCH>Name, Parent, BillDate, BillCreditPeriod, OpeningBalance, ClosingBalance</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""

# XML 1.0 allows: 0x9, 0xA, 0xD, 0x20-0xD7FF, 0xE000-0xFFFD, 0x10000-0x10FFFF
# Tally sometimes emits out-of-range bytes (NULs, 0x01-0x08, etc.) that break
# strict XML parsers. Strip them before parsing.
_INVALID_XML_RE = re.compile(
    rb"[\x00-\x08\x0B\x0C\x0E-\x1F]",
)


def _parse_tally_date(s: Optional[str]) -> Optional[str]:
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
    return None


def _parse_credit_days(s: Optional[str]) -> int:
    if not s:
        return 0
    digits = "".join(ch for ch in s if ch.isdigit())
    return int(digits) if digits else 0


def _parse_amount(s: Optional[str]) -> float:
    if not s:
        return 0.0
    s = s.strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def fetch_bill_wise_outstanding(
    company_name: str,
    tally_url: str = "http://localhost:9000",
    timeout: int = 120,
) -> list[InvoiceRecord]:
    """
    Returns one InvoiceRecord per open debtor bill (CLOSINGBALANCE > 0).
    Silent empty list on Tally errors — the caller logs counts.
    """
    body = OUTSTANDING_TDL.format(company=_xml_escape(company_name))
    log.info(f"Fetching bill-wise outstanding (company={company_name})")

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

    raw = _INVALID_XML_RE.sub(b" ", r.content)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        log.error(f"Tally response parse error: {e}")
        return []

    invoices: list[InvoiceRecord] = []
    skipped_settled = 0
    skipped_bad_party = 0
    skipped_bad_date = 0

    for bill in root.iter("BILL"):
        name = (bill.findtext("NAME") or bill.get("NAME") or "").strip()
        party = (bill.findtext("PARENT") or "").strip()
        bill_date = _parse_tally_date(bill.findtext("BILLDATE"))
        credit_days = _parse_credit_days(bill.findtext("BILLCREDITPERIOD"))
        opening = _parse_amount(bill.findtext("OPENINGBALANCE"))
        closing = _parse_amount(bill.findtext("CLOSINGBALANCE"))

        if not name or not party:
            skipped_bad_party += 1
            continue
        if not bill_date:
            skipped_bad_date += 1
            continue
        # Outstanding = current closing balance. If <= 0 the bill is settled
        # or a credit-note / overpayment that we don't chase for.
        outstanding = closing if closing > 0 else 0
        if outstanding <= 0.01:
            skipped_settled += 1
            continue

        # Credit-period missing → treat bill-date as due-date so the
        # ageing cron can classify the bill. Most real Tally bills don't
        # have explicit credit periods.
        d = datetime.fromisoformat(bill_date).date()
        due_date = (
            (d + timedelta(days=credit_days)).isoformat()
            if credit_days > 0
            else d.isoformat()
        )

        invoices.append(
            InvoiceRecord(
                company=company_name,
                tally_ledger_name=party,
                bill_ref=name,
                bill_date=bill_date,
                due_date=due_date,
                original_amount=abs(opening) or outstanding,
                outstanding_amount=outstanding,
            )
        )

    log.info(
        f"  Parsed {len(invoices)} open bills · {skipped_settled} settled/credit · "
        f"{skipped_bad_party} missing-party · {skipped_bad_date} bad-date"
    )
    return invoices


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
