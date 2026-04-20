"""
Receipt voucher extraction via Tally XML HTTP.

Pulls every RECEIPT voucher for a company along with its BILLALLOCATIONS
(so we can honour Tally's own bill-wise set-off on the cloud side).

Observed Tally Prime 7.x schema:

  <VOUCHER VCHTYPE="Receipt" ACTION="Create">
    <DATE>20260320</DATE>
    <VOUCHERNUMBER>RCT-001</VOUCHERNUMBER>
    <PARTYLEDGERNAME>ACME Traders</PARTYLEDGERNAME>
    <AMOUNT>-100000</AMOUNT>                      (credit is negative)
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>ACME Traders</LEDGERNAME>
      <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
      <AMOUNT>-100000</AMOUNT>
      <BILLALLOCATIONS.LIST>
        <NAME>INV-2026-001</NAME>
        <AMOUNT>-60000</AMOUNT>
        <BILLTYPE>Agst Ref</BILLTYPE>
      </BILLALLOCATIONS.LIST>
      <BILLALLOCATIONS.LIST>
        <NAME>INV-2026-002</NAME>
        <AMOUNT>-40000</AMOUNT>
        <BILLTYPE>Agst Ref</BILLTYPE>
      </BILLALLOCATIONS.LIST>
    </ALLLEDGERENTRIES.LIST>
  </VOUCHER>

Rules applied:
  * Take the absolute value of AMOUNT — Tally sign conventions flip on credit.
  * BILLTYPE == "Agst Ref" means the allocation points to an existing bill.
    BILLTYPE == "New Ref" is an advance; we drop it to signal on-account.
  * The receipt's total amount is the absolute party-ledger amount, NOT
    the sum of bill-allocations (Tally can have receipts with partial bill
    allocations + an advance portion that lives on New Ref rows).
"""

import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import requests

log = logging.getLogger("credfloat-connector.receipts")


@dataclass
class BillRefAllocation:
    bill_ref: str
    amount: float


@dataclass
class ReceiptRecord:
    company: str
    tally_ledger_name: str
    voucher_ref: str
    receipt_date: str  # ISO yyyy-mm-dd
    amount: float
    bill_refs: list[BillRefAllocation] = field(default_factory=list)


RECEIPTS_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatReceiptVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatReceiptVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FILTERS>CredFloatIsReceipt</FILTERS>
            <FETCH>Date, VoucherNumber, PartyLedgerName, Amount, AllLedgerEntries</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="CredFloatIsReceipt">$VCHTYPE = "Receipt"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""

_INVALID_XML_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def _parse_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    if not s or s == "0":
        return None
    for fmt in ("%Y%m%d", "%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_amount(s: Optional[str]) -> float:
    if not s:
        return 0.0
    s = s.strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def fetch_receipts(
    company_name: str,
    tally_url: str = "http://localhost:9000",
    timeout: int = 120,
) -> list[ReceiptRecord]:
    """
    Returns one ReceiptRecord per Receipt voucher, with BILLALLOCATIONS on
    each. Silent empty list on Tally errors — caller logs counts.
    """
    body = RECEIPTS_TDL.format(company=_xml_escape(company_name))
    log.info(f"Fetching receipts (company={company_name})")

    try:
        r = requests.post(
            tally_url,
            data=body.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            timeout=timeout,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        log.error(f"Tally receipt fetch failed: {e}")
        return []

    raw = _INVALID_XML_RE.sub(b" ", r.content)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        log.error(f"Tally receipt response parse error: {e}")
        return []

    receipts: list[ReceiptRecord] = []
    skipped_bad_date = 0
    skipped_no_party = 0

    for voucher in root.iter("VOUCHER"):
        date_iso = _parse_date(voucher.findtext("DATE"))
        vch_num = (voucher.findtext("VOUCHERNUMBER") or "").strip()
        party_name = (voucher.findtext("PARTYLEDGERNAME") or "").strip()

        if not date_iso:
            skipped_bad_date += 1
            continue
        if not party_name:
            skipped_no_party += 1
            continue
        if not vch_num:
            # Synthesize a stable ref from date + party so conflict-on-upsert
            # works. Tally occasionally suppresses VoucherNumber on imported
            # vouchers — don't drop the row just because the ref is missing.
            vch_num = f"rct-{date_iso}-{party_name}"

        # Find the party-ledger entry (the one whose LEDGERNAME matches
        # PARTYLEDGERNAME). Its AMOUNT is the true receipt total.
        total_amount = 0.0
        bill_refs: list[BillRefAllocation] = []
        for entry in voucher.iter("ALLLEDGERENTRIES.LIST"):
            ledger_name = (entry.findtext("LEDGERNAME") or "").strip()
            if ledger_name != party_name:
                continue
            total_amount = abs(_parse_amount(entry.findtext("AMOUNT")))

            for alloc in entry.iter("BILLALLOCATIONS.LIST"):
                bill_type = (alloc.findtext("BILLTYPE") or "").strip()
                # "Agst Ref" = allocation to an existing bill. "New Ref" =
                # advance that becomes an opening bill of its own, not an
                # allocation. Ignore anything else (rare, e.g. "On Account").
                if bill_type != "Agst Ref":
                    continue
                bill_ref = (alloc.findtext("NAME") or "").strip()
                amt = abs(_parse_amount(alloc.findtext("AMOUNT")))
                if not bill_ref or amt <= 0:
                    continue
                bill_refs.append(BillRefAllocation(bill_ref=bill_ref, amount=amt))
            break  # one party-ledger entry per voucher is enough

        if total_amount <= 0:
            continue

        receipts.append(
            ReceiptRecord(
                company=company_name,
                tally_ledger_name=party_name,
                voucher_ref=vch_num,
                receipt_date=date_iso,
                amount=total_amount,
                bill_refs=bill_refs,
            )
        )

    log.info(
        f"  Parsed {len(receipts)} receipts · "
        f"{skipped_bad_date} bad-date · {skipped_no_party} missing-party"
    )
    return receipts
