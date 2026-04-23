"""
Debtor-credit voucher extraction via Tally XML HTTP.

Despite the module name (kept for backward compatibility) this pulls
every voucher type that can REDUCE a debtor's ledger balance — Receipt,
Journal, Credit Note, and Debit Note. Each gets the same BILLALLOCATIONS
treatment so our cloud-side FIFO engine can mirror Tally's set-off.

Why this matters: a Tally ledger balance can go down for reasons other
than a straight Receipt. Credit notes (sales returns), bad-debt writeoffs
posted via Journal, and year-end reclasses all reduce debtor balance at
the ledger level. If we only synced Receipt vouchers, our invoice
residuals would overstate what the debtor actually owes.

We only keep entries whose debtor side is a Cr — i.e. money coming
in that reduces what the debtor owes. Tally's AMOUNT sign and
ISDEEMEDPOSITIVE flag are unreliable, so we resolve Dr/Cr from the
VOUCHER TYPE:

    Receipt, Credit Note, Contra →  debtor is Cr (keep for FIFO)
    Sales, Debit Note, Payment   →  debtor is Dr (skip — not receipt-like)
    Journal / other              →  fall back to ISDEEMEDPOSITIVE

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
            <FILTERS>CredFloatReducesDebtor</FILTERS>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="CredFloatReducesDebtor">($VoucherTypeName = "Receipt") OR ($VoucherTypeName = "Journal") OR ($VoucherTypeName = "Credit Note") OR ($VoucherTypeName = "Debit Note")</SYSTEM>
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
        vch_type = (voucher.findtext("VOUCHERTYPENAME") or "").strip()

        # For Journal / Credit Note / Debit Note, only sync entries that
        # carry an explicit BILLALLOCATIONS reference. Without it, the
        # voucher is a ledger-level adjustment (bad-debt writeoff, year-
        # end reclass, advance transfer) that Tally has already reflected
        # in party.closingBalance — treating it as an on-account receipt
        # would double-count the debtor relief.
        require_bill_allocs = vch_type in (
            "Journal",
            "Credit Note",
            "Debit Note",
        )

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
            # Require bill allocations for non-Receipt voucher types —
            # see comment above. Receipt vouchers still accept on-account
            # entries (PARTYLEDGERNAME match without bill allocations).
            if require_bill_allocs:
                if has_bill_allocs:
                    debtor_entries.append((ledger_name, entry))
            else:
                if has_bill_allocs or is_party_ledger:
                    debtor_entries.append((ledger_name, entry))

        if not debtor_entries:
            skipped_no_party += 1
            continue

        # Voucher-type-first classification. Accounting rules decide
        # whether a debtor is Dr or Cr for the common cases; the flag
        # is only consulted for Journal/unknown voucher types.
        DEBTOR_CR_TYPES = {"Receipt", "Credit Note", "Contra"}
        DEBTOR_DR_TYPES = {"Sales", "Debit Note", "Payment"}

        multi = len(debtor_entries) > 1
        for ledger_name, entry in debtor_entries:
            raw_amount = _parse_amount(entry.findtext("AMOUNT"))
            flag = (entry.findtext("ISDEEMEDPOSITIVE") or "").strip().lower()
            # Decide if this debtor-side entry is a Cr (reduces debt).
            # Only Cr entries belong in this pipeline — Dr entries (e.g.
            # interest charged via Journal) must not be FIFO'd against
            # open bills.
            if vch_type in DEBTOR_CR_TYPES:
                is_cr = True
            elif vch_type in DEBTOR_DR_TYPES:
                is_cr = False
            else:
                # Journal / unknown — use the flag. "No" = Cr.
                is_cr = flag != "yes"
            if not is_cr:
                continue
            total_amount = abs(raw_amount)
            if total_amount <= 0:
                continue

            # Capture ALL bill allocation types, not just "Agst Ref".
            # The allocation engine downstream only matches
            # TALLY_BILLWISE audit rows for bills that exist in our open
            # set (via invoiceByRef lookup), so New Ref / On Account
            # entries naturally produce no audit rows. But their mere
            # presence signals "Tally has already resolved this receipt
            # — don't FIFO it," which prevents advance receipts from
            # being silently reapplied to unrelated open bills.
            bill_refs: list[BillRefAllocation] = []
            for alloc in entry.iter("BILLALLOCATIONS.LIST"):
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
