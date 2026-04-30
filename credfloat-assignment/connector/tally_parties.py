"""
Debtor ledger + company list via Tally HTTP XML.

Replaces the ODBC path in `tally_connector.py` so the connector .exe ships
without requiring a Windows ODBC driver install on every client PC.

Same protocol as `tally_invoices.py` / `tally_receipts.py` — POST a TDL request
to Tally's HTTP server (default port 9000), parse the XML response.
"""
from __future__ import annotations
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional

import requests

log = logging.getLogger("credfloat-connector.parties")


@dataclass
class CompanyRecord:
    tally_name: str


@dataclass
class PartyRecord:
    company: str
    tally_ledger_name: str
    parent_group: str
    closing_balance: float
    opening_balance: float = 0.0
    mailing_name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None


# Tally sometimes emits XML 1.0-illegal control bytes; strip before parsing.
_INVALID_XML_RE = re.compile(rb"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _parse_amount(s: Optional[str]) -> float:
    if not s:
        return 0.0
    s = s.strip().replace(",", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _post_tally(body: str, tally_url: str, timeout: int = 120) -> Optional[ET.Element]:
    try:
        r = requests.post(
            tally_url,
            data=body.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8"},
            timeout=timeout,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        log.error("Tally XML HTTP request failed: %s", e)
        return None
    raw = _INVALID_XML_RE.sub(b" ", r.content)
    try:
        return ET.fromstring(raw)
    except ET.ParseError as e:
        log.error("Tally response parse error: %s", e)
        return None


# --- Companies -------------------------------------------------------------

COMPANIES_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>Name</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def fetch_companies(tally_url: str = "http://localhost:9000") -> list[CompanyRecord]:
    """Return every company currently loaded in Tally."""
    log.info("Fetching company list from Tally")
    root = _post_tally(COMPANIES_TDL, tally_url)
    if root is None:
        return []
    out: list[CompanyRecord] = []
    seen: set[str] = set()
    for c in root.iter("COMPANY"):
        name = (c.findtext("NAME") or c.get("NAME") or "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(CompanyRecord(tally_name=name))
    log.info("  Found %d companies", len(out))
    return out


# --- Debtor ledgers --------------------------------------------------------

LEDGERS_TDL = """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CredFloatDebtors</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CredFloatDebtors" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FILTER>IsDebtor</FILTER>
            <FETCH>Name, Parent, ClosingBalance, OpeningBalance, MailingName, Email, LedgerMobile, LedgerPhone, LedgerContact, Address</FETCH>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="IsDebtor">$Parent = "Sundry Debtors"</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
"""


def _collect_address(ledger: ET.Element) -> Optional[str]:
    """Address comes back as multiple <ADDRESS.LIST><ADDRESS>line</ADDRESS>...</ADDRESS.LIST>."""
    lines: list[str] = []
    for addr_list in ledger.iter("ADDRESS.LIST"):
        for line in addr_list.iter("ADDRESS"):
            t = (line.text or "").strip()
            if t:
                lines.append(t)
    if not lines:
        # Some builds inline a single <ADDRESS> at the ledger level.
        single = (ledger.findtext("ADDRESS") or "").strip()
        if single:
            lines.append(single)
    return "\n".join(lines) or None


def fetch_debtor_ledgers(
    company_name: str,
    tally_url: str = "http://localhost:9000",
) -> list[PartyRecord]:
    """Return ledgers under 'Sundry Debtors' for the given company.

    Tally convention: debtor balances are negative when the party owes us. We
    flip the sign so downstream "positive = outstanding receivable" semantics
    are intuitive — matches the prior ODBC implementation.
    """
    body = LEDGERS_TDL.format(company=_xml_escape(company_name))
    log.info("Fetching debtor ledgers (company=%s)", company_name)
    root = _post_tally(body, tally_url)
    if root is None:
        return []

    parties: list[PartyRecord] = []
    for led in root.iter("LEDGER"):
        name = (led.findtext("NAME") or led.get("NAME") or "").strip()
        parent = (led.findtext("PARENT") or "").strip()
        if not name:
            continue
        # Defensive: if our IsDebtor filter is bypassed by a quirky build,
        # still skip non-debtor groups so we don't sync vendors as parties.
        if parent and parent.lower() not in {"sundry debtors", "trade debtors"}:
            continue

        closing = -_parse_amount(led.findtext("CLOSINGBALANCE"))  # flip sign
        opening = -_parse_amount(led.findtext("OPENINGBALANCE"))
        email = (led.findtext("EMAIL") or "").strip() or None
        mobile = (led.findtext("LEDGERMOBILE") or "").strip() or None
        phone_landline = (led.findtext("LEDGERPHONE") or "").strip() or None
        phone_contact = (led.findtext("LEDGERCONTACT") or "").strip() or None
        mailing = (led.findtext("MAILINGNAME") or "").strip() or None
        address = _collect_address(led)

        parties.append(
            PartyRecord(
                company=company_name,
                tally_ledger_name=name,
                parent_group=parent or "Sundry Debtors",
                closing_balance=closing,
                opening_balance=opening,
                mailing_name=mailing,
                address=address,
                email=email,
                phone=phone_landline or phone_contact,
                whatsapp_number=mobile,
            )
        )

    log.info("  Parsed %d debtor ledgers", len(parties))
    return parties
