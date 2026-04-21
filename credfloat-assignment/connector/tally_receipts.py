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
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime
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
        <SVFROMDATE TYPE="Date">{from_date}</SVFROMDATE>
        <SVTODATE TYPE="Date">{to_date}</SVTODATE>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatReceiptVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount, AllLedgerEntries</FETCH>
            <FILTERS>CredFloatIsReceipt</FILTERS>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="CredFloatIsReceipt">$VoucherTypeName = "Receipt"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""

_INVALID_XML_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")

# Tally sometimes emits numeric character references for control chars
# (e.g. `&#4;` meaning ASCII 4) which the XML 1.0 spec bans — lxml's C
# parser rejects the whole document. Scrub them to a space.
_CHAR_REF_RE = re.compile(rb"&#([xX]?[0-9a-fA-F]+);")


def _scrub_char_refs(raw: bytes) -> bytes:
    def _repl(m: "re.Match[bytes]") -> bytes:
        token = m.group(1)
        try:
            n = (
                int(token[1:], 16)
                if token[:1] in (b"x", b"X")
                else int(token)
            )
        except ValueError:
            return b" "
        if n in (9, 10, 13) or 32 <= n <= 0x10FFFF:
            return m.group(0)
        return b" "

    return _CHAR_REF_RE.sub(_repl, raw)


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
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> list[ReceiptRecord]:
    """
    Returns one ReceiptRecord per Receipt voucher, with BILLALLOCATIONS on
    each. Silent empty list on Tally errors — caller logs counts.

    Tally's `Vouchers : VoucherTypeName` collection with CHILDOF "Receipt"
    requires a date range (SVFROMDATE/SVTODATE) — without it Tally returns
    only today's vouchers, which for historical sync is almost never what
    we want. Defaults to 1-Apr-2020 through today (safe over-pull).
    """
    # Default window: wide enough to cover any realistic Tally book.
    fd = from_date or date(2020, 4, 1)
    td = to_date or date.today()
    body = RECEIPTS_TDL.format(
        company=_xml_escape(company_name),
        from_date=fd.strftime("%d-%b-%Y"),
        to_date=td.strftime("%d-%b-%Y"),
    )
    log.info(
        f"Fetching receipts (company={company_name}, "
        f"from={fd.isoformat()}, to={td.isoformat()})"
    )

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
    raw = _scrub_char_refs(raw)

    # DEBUG hook — dump raw Tally XML to a file. Very helpful when the
    # parse returns 0 receipts and you need to see what the TDL actually
    # returned. Enable with TALLY_DEBUG_DUMP=true.
    if os.getenv("TALLY_DEBUG_DUMP", "false").lower() == "true":
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", company_name)[:40]
        dump_path = f"tally_receipts_debug_{safe_name}.xml"
        try:
            with open(dump_path, "wb") as fp:
                fp.write(raw)
            log.info(f"  Wrote Tally response to {dump_path}")
        except OSError as e:
            log.warning(f"  Failed to dump response: {e}")

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        log.error(f"Tally receipt response parse error: {e}")
        return []

    receipts: list[ReceiptRecord] = []
    skipped_bad_date = 0
    skipped_no_party = 0

    for voucher in root.iter("VOUCHER"):
        # Tally wraps its response summary in a CMPINFO block that contains
        # <VOUCHER>0</VOUCHER> as a *count*, not an actual voucher. Skip
        # elements that have no children — real vouchers always do.
        if len(list(voucher)) == 0:
            continue
        date_iso = _parse_date(voucher.findtext("DATE"))
        vch_num = (voucher.findtext("VOUCHERNUMBER") or "").strip()
        party_name = (voucher.findtext("PARTYLEDGERNAME") or "").strip()

        if not date_iso:
            skipped_bad_date += 1
            continue
        if not vch_num:
            # Synthesize a stable ref from date + party so conflict-on-upsert
            # works. Tally occasionally suppresses VoucherNumber on imported
            # vouchers — don't drop the row just because the ref is missing.
            vch_num = f"rct-{date_iso}-{party_name or 'unknown'}"

        # Emit one ReceiptRecord per debtor-side ledger entry. Previously
        # we only captured PARTYLEDGERNAME — that missed receipt vouchers
        # where PARTYLEDGERNAME is set to a bank/cash ledger but the
        # voucher credits one or more debtor ledgers inside
        # ALLLEDGERENTRIES. Those missed credits showed up as a
        # discrepancy between Tally's ledger balance and our invoice
        # residuals.
        #
        # A ledger entry counts as 'debtor-side' if it either:
        #   - has BILLALLOCATIONS (definitive bill-wise tracking signal)
        #   - OR matches PARTYLEDGERNAME (legacy — catches on-account
        #     debtor receipts without bill-wise tracking)
        debtor_entries = []
        for entry in voucher.iter("ALLLEDGERENTRIES.LIST"):
            ledger_name = (entry.findtext("LEDGERNAME") or "").strip()
            if not ledger_name:
                continue
            has_bill_allocs = entry.find("BILLALLOCATIONS.LIST") is not None
            is_party_ledger = bool(party_name) and ledger_name == party_name
            if has_bill_allocs or is_party_ledger:
                debtor_entries.append((ledger_name, entry))

        if not debtor_entries:
            skipped_no_party += 1
            continue

        multi = len(debtor_entries) > 1
        for ledger_name, entry in debtor_entries:
            total_amount = abs(_parse_amount(entry.findtext("AMOUNT")))
            if total_amount <= 0:
                continue

            bill_refs: list[BillRefAllocation] = []
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

            # For vouchers that credit multiple debtors, append the debtor
            # name to voucher_ref so the DB unique constraint on
            # (clientCompanyId, voucherRef) still de-duplicates correctly.
            final_ref = vch_num
            if multi:
                final_ref = f"{vch_num}::{ledger_name[:40]}"

            receipts.append(
                ReceiptRecord(
                    company=company_name,
                    tally_ledger_name=ledger_name,
                    voucher_ref=final_ref,
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
