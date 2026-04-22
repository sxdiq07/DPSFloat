"""
Full Tally Day Book extraction via Tally XML HTTP.

For every voucher in the configured date range, we emit one
LedgerEntryRecord per ledger line that touches a debtor. The cloud
side stores them in the LedgerEntry table and the drill-down renders
the full per-party day book — Sales, Receipts, Payments, Journals,
Credit/Debit Notes, Contras — so our numbers match Tally exactly.

Why this exists alongside tally_receipts.py:
  - tally_receipts.py is narrow — only vouchers that REDUCE a debtor
    balance, and only when bill-allocated. It feeds the FIFO engine.
  - tally_daybook.py is wide — every voucher, every debtor-side line,
    regardless of bill allocation. It feeds the audit/drill-down view.

Tally XML voucher shape we care about:
  <VOUCHER VCHTYPE="Sales">
    <DATE>20260221</DATE>
    <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <VOUCHERNUMBER>437</VOUCHERNUMBER>
    <NARRATION>...</NARRATION>
    <PARTYLEDGERNAME>Luggage Plaza</PARTYLEDGERNAME>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>Luggage Plaza</LEDGERNAME>
      <AMOUNT>97704</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>TAXABLE @ 18% SALE</LEDGERNAME>
      <AMOUNT>-82800</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    ...
  </VOUCHER>

Sign convention (per Tally): positive AMOUNT = debit side; negative =
credit side. For each voucher, we emit one record per entry whose
LEDGERNAME is among the known debtor ledgers (passed in by the caller).
Counterparty is inferred as the main "other side" of the voucher —
typically the biggest non-debtor line, or falls back to PARTYLEDGERNAME.
"""

import logging
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import requests

log = logging.getLogger("credfloat-connector.daybook")

# Map Tally VoucherTypeName → our enum values.
VOUCHER_TYPE_MAP = {
    "Sales": "SALES",
    "Purchase": "PURCHASE",
    "Receipt": "RECEIPT",
    "Payment": "PAYMENT",
    "Journal": "JOURNAL",
    "Contra": "CONTRA",
    "Credit Note": "CREDIT_NOTE",
    "Debit Note": "DEBIT_NOTE",
    "Stock Journal": "STOCK_JOURNAL",
}


@dataclass
class LedgerEntryRecord:
    company: str
    tally_ledger_name: str         # the debtor ledger this row is for
    voucher_date: str              # ISO yyyy-mm-dd
    voucher_type: str              # enum value — SALES / RECEIPT / etc.
    voucher_ref: str               # Tally VoucherNumber (or synthesized)
    counterparty: str              # the other main ledger on this voucher
    narration: Optional[str]
    debit: float
    credit: float


DAYBOOK_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatDayBookVouchers</ID>
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
          <COLLECTION NAME="CredFloatDayBookVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <FETCH>Date, VoucherTypeName, VoucherNumber, Narration, PartyLedgerName, AllLedgerEntries</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""

_INVALID_XML_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")
_CHAR_REF_RE = re.compile(rb"&#([xX]?[0-9a-fA-F]+);")


def _scrub_char_refs(raw: bytes) -> bytes:
    """Remove numeric character references that decode to disallowed XML code points."""
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


def fetch_day_book(
    company_name: str,
    debtor_ledger_names: set[str],
    tally_url: str = "http://localhost:9000",
    timeout: int = 300,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> list[LedgerEntryRecord]:
    """
    Pulls every voucher in the date range and emits one record per
    debtor-touching ledger line. `debtor_ledger_names` is the set of
    party ledger names the caller wants entries for (matched case-
    sensitively against Tally's LEDGERNAME, which is how Tally stores
    and exports it).

    Defaults to a wide window (2020-04-01 → today) so first-run syncs
    capture the full history.
    """
    fd = from_date or date(2020, 4, 1)
    td = to_date or date.today()
    body = DAYBOOK_TDL.format(
        company=_xml_escape(company_name),
        from_date=fd.strftime("%d-%b-%Y"),
        to_date=td.strftime("%d-%b-%Y"),
    )
    log.info(
        f"Fetching day book (company={company_name}, "
        f"from={fd.isoformat()}, to={td.isoformat()}, "
        f"debtor-count={len(debtor_ledger_names)})"
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
        log.error(f"Tally day book fetch failed: {e}")
        return []

    raw = _INVALID_XML_RE.sub(b" ", r.content)
    raw = _scrub_char_refs(raw)

    if os.getenv("TALLY_DEBUG_DUMP", "false").lower() == "true":
        safe_name = re.sub(r"[^A-Za-z0-9_-]", "_", company_name)[:40]
        dump_path = f"tally_daybook_debug_{safe_name}.xml"
        try:
            with open(dump_path, "wb") as fp:
                fp.write(raw)
            log.info(f"  Wrote Tally response to {dump_path}")
        except OSError as e:
            log.warning(f"  Failed to dump response: {e}")

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        log.error(f"Tally day book response parse error: {e}")
        return []

    entries: list[LedgerEntryRecord] = []
    skipped_bad_date = 0
    skipped_no_debtor = 0
    skipped_unknown_type = 0
    total_vouchers = 0

    for voucher in root.iter("VOUCHER"):
        if len(list(voucher)) == 0:
            continue
        total_vouchers += 1

        date_iso = _parse_date(voucher.findtext("DATE"))
        if not date_iso:
            skipped_bad_date += 1
            continue

        vch_type_raw = (voucher.findtext("VOUCHERTYPENAME") or "").strip()
        vch_type = VOUCHER_TYPE_MAP.get(vch_type_raw)
        if not vch_type:
            vch_type = "OTHER"
            # Only log the first few unknown types to avoid log spam.
            if skipped_unknown_type < 3:
                log.debug(f"  Unmapped voucher type: {vch_type_raw!r}")
            skipped_unknown_type += 1

        vch_num = (voucher.findtext("VOUCHERNUMBER") or "").strip()
        party_ledger = (voucher.findtext("PARTYLEDGERNAME") or "").strip()
        narration = (voucher.findtext("NARRATION") or "").strip() or None

        if not vch_num:
            # Synthesize a stable ref so the DB unique constraint has
            # something to dedupe on. Include vch_type so different
            # voucher types on the same day don't collide.
            vch_num = f"{vch_type.lower()}-{date_iso}-{party_ledger or 'unknown'}"

        # Collect ledger entries from this voucher. We'll emit one
        # LedgerEntryRecord per entry whose LEDGERNAME is a known debtor.
        # Counterparty is inferred from the largest non-debtor line.
        entries_list = list(voucher.iter("ALLLEDGERENTRIES.LIST"))
        if not entries_list:
            # Some Tally builds use a different element name.
            entries_list = list(voucher.iter("LEDGERENTRIES.LIST"))

        debtor_lines = []
        non_debtor_lines = []
        for entry in entries_list:
            ledger_name = (entry.findtext("LEDGERNAME") or "").strip()
            if not ledger_name:
                continue
            amount = _parse_amount(entry.findtext("AMOUNT"))
            if ledger_name in debtor_ledger_names:
                debtor_lines.append((ledger_name, amount))
            else:
                non_debtor_lines.append((ledger_name, amount))

        if not debtor_lines:
            skipped_no_debtor += 1
            continue

        # Pick counterparty = non-debtor line with the largest |amount|.
        counterparty = ""
        if non_debtor_lines:
            counterparty = max(non_debtor_lines, key=lambda x: abs(x[1]))[0]
        elif party_ledger and party_ledger not in debtor_ledger_names:
            counterparty = party_ledger

        for ledger_name, amt in debtor_lines:
            debit = amt if amt > 0 else 0.0
            credit = -amt if amt < 0 else 0.0
            if debit == 0.0 and credit == 0.0:
                continue
            entries.append(
                LedgerEntryRecord(
                    company=company_name,
                    tally_ledger_name=ledger_name,
                    voucher_date=date_iso,
                    voucher_type=vch_type,
                    voucher_ref=vch_num,
                    counterparty=counterparty,
                    narration=narration,
                    debit=debit,
                    credit=credit,
                )
            )

    log.info(
        f"  Day book: {total_vouchers} vouchers scanned · {len(entries)} entries emitted · "
        f"{skipped_no_debtor} no-debtor · {skipped_bad_date} bad-date · "
        f"{skipped_unknown_type} unknown-type"
    )
    return entries
