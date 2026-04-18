# CredFloat — Technical Architecture

**Document:** System Architecture v1.0
**For:** DPS & Co — Internal Tool
**Date:** April 2026
**Status:** Draft for review

---

## 1. Overview

CredFloat is a web-based internal tool that reads data from the firm's existing Tally Prime installations, stores it in a cloud database, and automates debtor payment reminders over WhatsApp, SMS, and Email. The system is **read-only from Tally's perspective** — no data ever flows back into Tally.

The architecture is deliberately minimal: one desktop agent, one cloud web app, and three external communication gateways. Everything runs on managed services — no servers to provision, no Kubernetes, no microservices.

---

## 2. System Components

### 2.1 Tally Connector Agent (desktop)

**Runs on:** The firm's Windows machine(s) where Tally Prime 7.0 is already installed.
**Built in:** Python 3.11+
**Key libraries:** `pyodbc`, `requests`, `pydantic`, `python-dotenv`

**What it does:**
- Queries Tally Prime through its ODBC server (TCP port 9000).
- Extracts four core entities: companies, parties (debtors), outstanding invoices (bills), and receipt vouchers.
- Serializes the data as JSON and POSTs it over HTTPS to the cloud API.
- Runs on a schedule — every 10-15 minutes via Windows Task Scheduler.
- Keeps a local log file and retries failed syncs with exponential backoff.

**Why ODBC, not XML/HTTP:** Tally exposes two integration paths. XML is required for writing data back to Tally; ODBC is simpler and fully sufficient for reading. Since CredFloat never writes to Tally, ODBC is the correct choice — simpler code, SQL-like queries, fewer moving parts.

**Why one agent, not 300:** Tally Prime runs on the firm's own infrastructure with all 300+ client companies loaded on the same machine(s). A single connector deployment covers every client — no installations at client sites. This is the structural advantage over CredFlow.

### 2.2 Cloud Backend

**Hosted on:** Vercel (web app) + Supabase (Postgres) — both support Mumbai / ap-south-1 region.
**Built in:** Next.js 14 (App Router) + TypeScript + Prisma ORM

The backend is a single Next.js application that serves three functions:

**a. Ingestion API** — Receives sync payloads from the connector. Validates, deduplicates, and upserts into Postgres. Every record is tagged with a `client_company_id` for multi-tenant isolation.

**b. Dashboard API** — REST endpoints powering the staff dashboard: aged receivables by client, debtor-level drilldown, reminder history, collection reports.

**c. Reminder Engine** — A cron-triggered job that runs daily, identifies invoices due for a reminder based on each client's configured schedule, and dispatches messages through the gateways.

**Data model (simplified):**
```
firms               — the operating firm (just DPS & Co for V1)
firm_staff          — users who log into the dashboard
client_companies    — the 300+ SME clients whose Tally data is synced
parties             — debtors belonging to each client company
invoices            — outstanding bills owed to client companies
receipts            — payments received against invoices
reminder_rules      — per-client schedule and template config
reminder_sent       — audit log of every reminder dispatched
```

### 2.3 Communication Gateways

All three are third-party services called over HTTPS. India-specific choices:

| Channel | Provider | Why |
|---------|----------|-----|
| WhatsApp | AiSensy or Interakt (BSPs) | Handle Meta template approvals and opt-in flows; mandatory for production |
| SMS | MSG91 | DLT template registration built in (TRAI compliance) |
| Email | Resend or AWS SES Mumbai | Low cost at scale, good deliverability |

All templates are pre-approved and stored per-firm. Messages are sent from the firm's registered sender IDs — debtors see "DPS & Co" or the client company's name, not a generic sender.

### 2.4 Staff Dashboard

**Built in:** Same Next.js app — routes under `/dashboard`
**UI:** shadcn/ui + Tailwind CSS + Recharts

**Key screens:**
- Firm-wide overview: total receivables under management, collections this month, overdue summary across all 300 clients
- Per-client view: aged receivables (current / 0-30 / 30-60 / 60-90 / 90+), debtor list, reminder history
- Reminder configuration: per-client template selection, schedule, channel preferences
- Collection reports: trends, per-client performance, staff activity log

**Access control:** Firm staff only. No client-facing logins in V1. Role-based — partners see everything, staff see assigned clients.

---

## 3. Data Flow

```
[Tally Prime 7.0] → [ODBC port 9000] → [Connector Agent]
                                              |
                                              | HTTPS POST every 10-15 min
                                              v
                                      [Cloud API: /api/sync]
                                              |
                                              v
                                       [PostgreSQL (Supabase)]
                                              ^
                                              |
                                      [Scheduler: daily cron]
                                              |
                                              | identifies due invoices
                                              v
                                      [Job queue → Gateway workers]
                                              |
                 +----------------------------+----------------------------+
                 |                            |                            |
                 v                            v                            v
          [WhatsApp BSP]                [SMS: MSG91]              [Email: Resend/SES]
                 |                            |                            |
                 +----------------------------+----------------------------+
                                              |
                                              v
                                         [Debtors]

[Staff Dashboard] <---REST API---> [Cloud API]
```

---

## 4. Key Technical Decisions

**ODBC over Tally XML/HTTP.** Read-only access is simpler, faster to build, and fully sufficient. Tally XML is reserved for future write-back use cases (not in V1 scope).

**Single Next.js app, not a separate API + frontend.** Fewer repos, one deployment, shared types between API and dashboard. Easier to maintain for a small team.

**Supabase over self-hosted Postgres.** Point-in-time backups, automatic SSL, row-level security, no DB admin overhead. Cheaper than running an EC2 instance for small-to-medium volume.

**Vercel Cron over a separate worker service.** For V1 volume (~300 clients, a few thousand reminders per day), Vercel's built-in cron is enough. Migration path to BullMQ + Upstash Redis when volume crosses the free tier.

**Indian communication providers.** WhatsApp BSPs and MSG91 handle DLT / TRAI compliance that direct Meta/Twilio integrations don't. Non-negotiable for production use with Indian debtors.

---

## 5. Security & Compliance

- **Transport:** HTTPS everywhere, TLS 1.2+ only.
- **Authentication:** Staff login via NextAuth (email + password, optionally Google SSO for the firm).
- **Secrets:** Gateway API keys in Vercel environment variables, never in the codebase.
- **Tenant isolation:** Every query filters on `client_company_id`. Postgres row-level security as a backstop.
- **DPDP Act (India):**
  - Debtor contacts processed only for the purpose of collecting amounts they already owe (legitimate interest).
  - Opt-out link in every email and SMS.
  - Retention policy: debtor data purged 90 days after invoice is fully settled.
  - Audit log of every reminder sent, retained for 1 year.
- **WhatsApp compliance:** Only pre-approved templates sent. Debtors who reply STOP are marked opted-out across all channels.

---

## 6. V1 Scope Boundaries

**In scope:**
- Tally ODBC read, cloud sync, multi-company dashboard, automated reminders across three channels, ageing analysis, basic reports, staff-only access.

**Out of scope for V1 (deferred):**
- Two-way Tally sync (write-back).
- Client-facing logins.
- Payment gateway integration / collection via UPI.
- Mobile app.
- AI / ML cash flow prediction.
- Multi-tenancy for other CA firms (comes in Phase 3).

---

## 7. Pilot Plan

1. **Week 1–2:** Local dev setup. Install Tally Prime 7.0, load backup file, get ODBC connection working, build connector skeleton that extracts companies and parties.
2. **Week 3–4:** Cloud backend scaffold. Next.js app, Supabase DB, Prisma schema, `/api/sync` endpoint, basic dashboard showing ingested data.
3. **Week 5–6:** Ageing logic, reminder rules table, dashboard UI for ageing buckets and debtor drilldown.
4. **Week 7–8:** Gateway integration (start with Email via Resend — cheapest to test, no compliance hoops), then SMS, then WhatsApp.
5. **Week 9–10:** Pilot with 5-10 client companies, validate sync reliability and reminder effectiveness.
6. **Week 11+:** Scale to all 300 clients; start measuring days-to-collection impact.

---

## 8. Open Items for Discussion

- Does the firm already have a WhatsApp Business API account, or should we onboard through a BSP from scratch?
- Which SMS provider is currently in use, if any? (Affects DLT template migration.)
- How many physical Windows machines run Tally at the firm? Need to decide connector deployment — one machine syncs all, or one agent per machine with dedup at the API?
- Current state of debtor contact data quality in Tally? Connector may need to flag incomplete party records on first sync.
- DPDP Act — should we engage legal review for the consent / opt-out flow before sending a single reminder to real debtors?

---

*Prepared by: [your name] | For internal review by DPS & Co*
