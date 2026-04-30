# CredFloat Data Contract v1

Single source of truth for **what data crosses which boundary**. Every other production decision (DB schema, .exe behaviour, web UI fallbacks, third-party integrations) must conform to this spec. If a feature requires breaking a row in this table, the row changes first — code follows.

Status: **draft for review**, tracks current Prisma schema as of `20260424100001_drop_share_pin`.

---

## 1. Privacy invariant (the one rule)

> A name, GSTIN, address, phone, or email belonging to a debtor or client company **must not be readable by any party outside DPS & Co's control**, including but not limited to:
> - Hosting providers (Vercel, Hetzner, AWS staff, datacentre operators)
> - Email/SMS/voice vendors (Resend, Twilio) — *recipient address only, never name in body/subject*
> - LLM providers (Anthropic, OpenAI, anyone)
> - Analytics/error tracking (Sentry, PostHog, Vercel logs)
> - Database backups stored on third-party object storage
> - Anyone who steals a copy of the production database

A breach of the production server must yield, at worst, **pseudonymous aggregates** (`C-0421 owes ₹1.2L, 47 days overdue`) — never `M-TRADING CO. owes ₹1.2L`.

---

## 2. Trust zones

```
Zone A — Client PC                    Zone B — DPS server                  Zone C — Partner laptop          Zone D — Third parties
(.exe runs here)                      (Hetzner / E2E VPS, Mumbai)          (browser, signed in)              (Resend, Twilio, etc.)
═══════════════════                   ═══════════════════════════          ═══════════════════════           ════════════════════════
Holds:                                Holds:                                Holds (in browser memory):        Receives:
  • raw Tally XML                       • encrypted PII columns               • the decryption key             • email/phone (recipient
  • plaintext party names               • plaintext aggregates              Derives key from:                    only — required to deliver)
  • the connector's mTLS cert           • plaintext audit log meta            partner password +              Never receives:
  • a local SQLite cache                  (no names)                          per-firm salt (PBKDF2 1M)         • client/debtor name
  • encryption key for                  • PDF blobs encrypted at-rest                                          • GSTIN
    Zone B's PII columns                  with the same key                                                    • address
                                                                                                              • narration text
```

Trust assumptions:
- Zone A may be compromised by malware on the client's PC. Containment: only that one client's data is exposed.
- Zone B may be compromised by hosting provider, attacker, or rogue admin. Containment: aggregates only — names remain unreadable.
- Zone C is the most-trusted zone. A single compromised partner laptop = full firm-wide exposure. Mitigations live in OS hardening + 2FA + short session TTL, not in this contract.
- Zone D is treated as adversarial; only the minimum required for delivery is sent.

---

## 3. Field-by-field classification

Legend:
- **🟢 cleartext** — fine to store on Zone B server in plaintext, fine to log
- **🟡 encrypted-at-rest** — stored in Zone B as `pgcrypto` ciphertext, key only in Zone C
- **🔴 local-only** — never leaves Zone A
- **⚪ derivable** — computed from other fields, doesn't need its own row

### 3.1 `Firm` (DPS & Co's own info)
| Field | Class | Notes |
|---|---|---|
| `id`, `createdAt` | 🟢 | |
| `name`, `frn`, `partnerName`, `partnerMno` | 🟢 | The CA firm itself is not a debtor; this is the firm running CredFloat |
| `bankName`, `bankAccountName`, `bankAccountNumber`, `bankIfsc`, `upiId` | 🟢 | Firm's own collection account, public on letterhead |

### 3.2 `FirmStaff`
| Field | Class | Notes |
|---|---|---|
| `id`, `firmId`, `role`, `createdAt` | 🟢 | |
| `email`, `name` | 🟢 | Staff identity, not client data |
| `passwordHash` | 🟢 | bcrypt; safe by construction |

### 3.3 `ClientCompany` ⚠️ — names matter here
| Field | Class | Notes |
|---|---|---|
| `id`, `firmId`, `status`, `createdAt`, `updatedAt` | 🟢 | |
| `tallyCompanyName` | 🔴 | **Stays on Zone A only.** Server stores `tallyCompanyHash = HMAC(name, firm_key)` for matching during sync. |
| `displayName` | 🟡 | Encrypted column; UI decrypts in Zone C |
| `gstin` | 🟡 | Encrypted column |
| `addressLine1/2`, `city`, `stateName`, `pincode` | 🟡 | All encrypted; `stateName` may stay cleartext if needed for IGST/CGST routing — see §5 |
| `defaultPlaceOfSupply` | 🟢 | State name only, not identifying alone |

### 3.4 `Party` (debtors) ⚠️ — the hottest table
| Field | Class | Notes |
|---|---|---|
| `id`, `clientCompanyId`, `lastSyncedAt`, `createdAt`, `updatedAt` | 🟢 | |
| `tallyLedgerName` | 🔴 + 🟡 | **Hash on server** (`tallyLedgerHash = HMAC(name, client_key)`); ciphertext column for display via Zone C |
| `mailingName` | 🟡 | Encrypted |
| `parentGroup` | 🟢 | Tally group like "Sundry Debtors" — not identifying |
| `address` | 🟡 | Encrypted |
| `phone`, `whatsappNumber` | 🟡 | Encrypted at rest. **Decrypted briefly in Zone B** at send time; passed to Twilio; then dropped. See §6 for the exception envelope. |
| `email` | 🟡 | Same as phone |
| `contactVerified`, `optedOut`, `optedOutReason` | 🟢 | Booleans/enums, not identifying |
| `closingBalance`, `openingBalance`, `advanceAmount` | 🟢 | Pseudonymous money figures |
| `gstin` | 🟡 | Encrypted |
| `stateName` | 🟢 | Tax routing only |
| `deletedAt` | 🟢 | |

### 3.5 `Invoice` (bills)
| Field | Class | Notes |
|---|---|---|
| All structural FK and timestamp fields | 🟢 | |
| `billRef` | 🟡 | Some firms encode client name in bill numbers ("MTRD-2024-0142") — encrypt to be safe |
| `billDate`, `dueDate`, `originalAmount`, `outstandingAmount`, `status`, `ageBucket`, `origin` | 🟢 | |
| `supplierGstin`, `recipientGstin`, `supplierPan` | 🟡 | Encrypted |
| `placeOfSupply`, `taxableAmount`, `cgst/sgst/igst` | 🟢 | |
| `notes`, `consigneeName`, `consigneeAddress`, `deliveryNote`, `dispatchDocNo`, `dispatchThrough`, `destination`, `termsOfDelivery`, `buyerOrderRef`, `modeOfPayment` | 🟡 | Free text — assume PII |
| `buyerOrderDate` | 🟢 | |

### 3.6 `Receipt`, `ReceiptAllocation`
| Field | Class | Notes |
|---|---|---|
| `voucherRef` | 🟡 | Same reasoning as `billRef` |
| Everything else | 🟢 | Money + FKs |

### 3.7 `LedgerEntry` (day book)
| Field | Class | Notes |
|---|---|---|
| `voucherRef` | 🟡 | |
| `voucherDate`, `voucherType`, `debit`, `credit` | 🟢 | |
| `counterparty` | 🟡 | "TAXABLE @ 18% SALE" is fine, but counterparty often contains a third party's name → encrypt |
| `narration` | 🟡 | Free-text; almost always identifying |

### 3.8 `Note`, `PromiseToPay`, `CallLog.error`
| Field | Class | Notes |
|---|---|---|
| `body`, `notes`, `error` | 🟡 | Free text — staff *will* type names. Encrypt by default. |
| `dtmfResponse`, `durationSec`, `status`, `toNumber` | 🟡 | `toNumber` is a phone — encrypt |
| Twilio SIDs (`executionSid`, `callSid`) | 🟢 | Opaque |

### 3.9 `ReminderSent`, `ActivityLog`, `CronRun`, `SavedView`, `PortalToken`
| Field | Class | Notes |
|---|---|---|
| `ActivityLog.meta` | 🟡 | JSON blob — must be schema-checked at write time to refuse plaintext PII keys, or encrypt the whole blob |
| `ReminderSent.error` | 🟡 | Error strings often contain "could not deliver to ravi@..." → encrypt |
| `SavedView.params` | 🟡 | URL params can include search-by-name → encrypt |
| `PortalToken.token` | 🟢 | Opaque random |
| Everything else | 🟢 | |

### 3.10 PDFs (ledger statements, tax invoices)
- Generated in **Zone B** at request time, with names decrypted in-memory using the requesting partner's session key (fetched from Zone C via an authenticated endpoint).
- **Never persisted to disk in plaintext.** If cached for performance, cache is the AES-GCM ciphertext; cache key = `sha256(template_id || party_id || period)`.
- Email attachments: encrypted in Zone B → handed to Resend as bytes for that single send → no retention.

---

## 4. Wire formats

### 4.1 Zone A → Zone B (the .exe push)
Single endpoint: `POST https://api.credfloat.dpsca.in/sync/push`. mTLS auth. Body is a JSON envelope:

```jsonc
{
  "schema": "credfloat.sync.v1",
  "device_id": "dev_8f3a...",
  "client_company_hash": "sha256:7a8b...",   // HMAC(tallyCompanyName, firm_key)
  "synced_at": "2026-04-30T10:15:00Z",
  "parties": [
    {
      "ledger_hash": "sha256:c4d2...",        // HMAC(tallyLedgerName, client_key)
      "parent_group": "Sundry Debtors",       // 🟢
      "closing_balance": 120000.00,           // 🟢
      "opening_balance": 90000.00,            // 🟢
      "advance_amount": 0,                    // 🟢
      "encrypted_pii": "AGE:...",             // age-encrypted blob: {name, mailingName, address, phone, email, gstin}
      "state_name": "Maharashtra"             // 🟢, only if needed for tax routing
    }
  ],
  "invoices": [
    {
      "ledger_hash": "sha256:c4d2...",
      "bill_ref_hash": "sha256:fe0a...",      // for dedup; server can't read the ref
      "bill_date": "2026-03-15",
      "due_date": "2026-04-14",
      "original_amount": 50000.00,
      "outstanding_amount": 50000.00,
      "encrypted_extras": "AGE:..."           // billRef plaintext + any free-text fields
    }
  ],
  "receipts": [ /* same shape */ ],
  "ledger_entries": [
    {
      "ledger_hash": "...",
      "voucher_date": "2026-03-15",
      "voucher_type": "SALES",
      "voucher_ref_hash": "sha256:...",
      "debit": 50000.00,
      "credit": 0,
      "encrypted_extras": "AGE:..."           // counterparty + narration + voucherRef
    }
  ]
}
```

Server logic: stores hashes for dedup/lookup, stores `encrypted_extras` ciphertext in the encrypted columns, never decrypts on the server, only computes aggregates from the cleartext numeric fields.

### 4.2 Zone B → Zone C (browser fetch)
Standard JSON. PII fields come through as ciphertext strings; browser decrypts using the session key derived from the partner's password at login. No new endpoint shapes — the existing API responses just contain ciphertext where they used to contain plaintext names.

### 4.3 Zone B → Zone D (third-party send)
At reminder send time:
1. Backend fetches `Party.email` ciphertext.
2. Decrypts in-memory using a **send-time key** (see §6).
3. Calls Resend with `{ to: "ravi@example.com", subject: "Outstanding from <Firm Name>", html: "..." }`.
4. Subject and body **must** use the firm's name, never the debtor's name.
5. Decrypted email/phone is dropped after the send. Not logged.

---

## 5. Why some PII fields stay 🟢

A few fields are intentionally cleartext on the server. Each has a justification:
- `Party.parentGroup` — Tally group label (e.g. "Sundry Debtors"). Common across all firms; not identifying.
- `Invoice.placeOfSupply`, `Party.stateName` — needed server-side to compute IGST vs CGST/SGST split for the dashboard's tax summary. State name alone identifies no one.
- All money columns and dates — the whole point of the system; pseudonymous when names are encrypted.
- Twilio/Resend `providerId` — opaque vendor IDs. Knowing them yields no PII without vendor cooperation.

If a future feature requires moving one of these from 🟢 → 🟡, update §3 first and migrate the column.

---

## 6. Send-time key (the one place the server decrypts)

Reminder sends and PDF generation are the two operations where the server *must* see plaintext briefly. Pattern:

1. Partner is logged in; their session holds the firm-wide encryption key in browser memory.
2. When they click "Send reminders", the browser ships the key to the backend in the request header (`X-Send-Key: <base64>`), over TLS, **scoped to that one HTTP request**.
3. Backend uses the key to decrypt only the ciphertext fields needed for *this* batch.
4. Backend deletes the key from memory the moment the batch finishes (`finally` block + `crypto.zero`).
5. The key is **never** written to a log, an env var, a backup, or persistent storage on the server.

Cron-driven batch sends (the morning batch at 8am) need a different pattern — see §7.

---

## 7. Open questions to resolve before implementing

1. **Cron sends.** Server needs to send reminders at 8am even when no partner is online. Either:
   - (a) The .exe holds the key and triggers the send itself (server is just a relay), or
   - (b) A background "send daemon" runs in Zone C (partner's office machine) and pulls jobs from Zone B.
   - (c) An offline-encrypted "send envelope" is staged at Zone B with a key released only on the morning of, by partner action.
   - **Decision needed by:** before first cron-triggered reminder.
2. **Search by debtor name.** UI search currently does `WHERE party.mailingName ILIKE '%foo%'`. If `mailingName` is encrypted, this query stops working. Options: blind-index of normalised tokens, client-side search over decrypted names in browser memory, or accept "search server-side by hash, must type exact name." — Recommend **client-side search**: ship all decrypted names to browser at login (fits in memory for ~10k debtors), filter locally. Confirm scale.
3. **GSTIN lookups for tax compliance.** Some flows ask "which debtor has this GSTIN?" → if encrypted, need a hash-based lookup (`gstin_hash`) column. Add to schema before encrypting.
4. **Ledger PDF caching.** Tally Day Book → PDF can be slow. Caching the encrypted ciphertext is fine but invalidating it is hard (any new voucher invalidates everything for that party). Decide: re-render every time, or cache + invalidate on push.
5. **Backup encryption key custody.** Backups are encrypted with a separate key. Where does it live? — proposed: split the key with Shamir's scheme between two partners; need two of two to restore. Manual but appropriate for the threat model.
6. **The `tally_receipts_debug_M-TRADING_CO_.xml` file in repo.** Filename leaks a client name. Add a `*_debug_*.xml` rule to `.gitignore` (the user's IDE has it open right now).

---

## 8. Migration path from current schema

The Prisma schema today has all the listed PII fields as plaintext `String`. Migration order, smallest to largest:

1. **Add hash columns** (`tallyCompanyHash`, `tallyLedgerHash`, `gstinHash`, `billRefHash`, `voucherRefHash`) — non-breaking, populate via backfill.
2. **Switch unique keys** to use the hash columns — careful migration, must run while sync is paused.
3. **Add ciphertext columns** parallel to plaintext (`displayName_enc`, etc.) — non-breaking.
4. **Backfill** ciphertext from plaintext using the firm key derived from a partner-set password.
5. **Cut over reads** to the ciphertext columns; UI starts decrypting in Zone C.
6. **Drop the plaintext columns.**
7. **Connector v2** — stops sending plaintext; sends only hashes + age-encrypted blobs.

Steps 1–5 can ship under a feature flag; step 6 is the irreversible one and gates GA.

---

## 9. What this contract does NOT cover (yet)

- Key rotation (procedure for re-encrypting under a new firm key)
- Partner-leaves-firm offboarding (revoking access without re-keying everything)
- DPDP-Act compliance posture (separate document)
- Disaster recovery for lost partner password (which destroys access to all encrypted data)
- Per-staff-role view restrictions (today STAFF sees same data as PARTNER once decrypted)

These are tracked in the architecture backlog and gated behind v1 of this contract landing.
