# CredFloat Web App — Build Brief

> **How to use this file:** Drop it at the root of your Next.js repo as `CURSOR_BRIEF.md`. In Cursor, open this file and ask: *"Read CURSOR_BRIEF.md and scaffold the project following the Build order section."* Cursor will use this as its source of truth throughout the build.

---

## Project context

Building **CredFloat** — an internal web app for DPS & Co (a Chartered Accountancy firm) to automate debtor payment reminders across 300+ client companies. Data flows in from a Python Tally connector (separate repo) via a `POST /api/sync` endpoint. Full architecture: see `CredFloat_Architecture_v1.md`.

V1 is firm-staff-only (no client logins). Three reminder channels: Email, SMS, WhatsApp.

---

## Tech stack — pin these exact choices

- **Framework:** Next.js 14+ (App Router) + TypeScript (strict mode)
- **Styling:** Tailwind CSS + shadcn/ui
- **ORM:** Prisma 5.x
- **Database:** PostgreSQL on Supabase (ap-south-1 / Mumbai region)
- **Auth:** NextAuth.js v5 (Auth.js), credentials provider, JWT sessions
- **Validation:** Zod
- **Dates:** date-fns + date-fns-tz (for IST display)
- **Charts:** Recharts
- **Email:** Resend
- **Tables:** @tanstack/react-table
- **Toasts:** sonner (shadcn wrapper)
- **Icons:** lucide-react

Do **not** add: Redux, tRPC, SWR. Stick to React Server Components + Server Actions.

---

## Project setup

```bash
npx create-next-app@latest credfloat-web --typescript --tailwind --app --src-dir --no-eslint
cd credfloat-web

# shadcn
npx shadcn@latest init
npx shadcn@latest add button input label form card table tabs toast dropdown-menu dialog select badge skeleton sonner

# core deps
npm install prisma @prisma/client zod date-fns date-fns-tz recharts resend next-auth@beta @tanstack/react-table bcryptjs
npm install -D @types/bcryptjs

# init prisma
npx prisma init
```

Replace `prisma/schema.prisma` with the provided `schema.prisma` file.

---

## File structure

```
src/
  app/
    (auth)/
      login/
        page.tsx
    (dashboard)/
      layout.tsx                # protected, renders sidebar + topbar
      page.tsx                  # firm-wide overview
      clients/
        page.tsx                # list of client companies
        [id]/
          page.tsx              # client detail
          reminders/
            page.tsx            # reminder config
      reports/
        page.tsx
      settings/
        page.tsx
    api/
      auth/[...nextauth]/route.ts
      sync/route.ts             # Python connector posts here
      cron/
        compute-ageing/route.ts
        send-reminders/route.ts
    layout.tsx
    globals.css
  components/
    ui/                         # shadcn components
    dashboard/
      sidebar.tsx
      kpi-card.tsx
      ageing-chart.tsx
      debtor-table.tsx
      reminder-log-table.tsx
      client-list-table.tsx
  lib/
    prisma.ts                   # Prisma singleton
    auth.ts                     # NextAuth config
    ageing.ts                   # ageing bucket computation
    email.ts                    # Resend wrapper
    currency.ts                 # INR formatting (lakh/crore)
    session.ts                  # getSession helper
prisma/
  schema.prisma
middleware.ts                   # auth middleware
```

---

## Environment variables (`.env.local`)

```
# Database
DATABASE_URL=postgresql://...supabase.co:5432/postgres
DIRECT_URL=postgresql://...   # for migrations (Supabase provides both)

# Auth
NEXTAUTH_SECRET=               # openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000

# Python connector shared secret
SYNC_API_KEY=                  # random 32+ char token

# Vercel Cron auth
CRON_SECRET=                   # random 32+ char token

# Email
RESEND_API_KEY=
RESEND_FROM=onboarding@resend.dev   # use your domain once verified

# Demo seed (for dev)
SEED_DEMO_USER_EMAIL=demo@dpsandco.in
SEED_DEMO_USER_PASSWORD=dps2026
```

---

## Page specs

### Login — `/login`
- Centered card, 400px wide
- Fields: email, password
- shadcn `<Form>` + react-hook-form + Zod
- On success: `signIn('credentials', ...)` → redirect to `/`
- Show error toast on failure

### Overview — `/`
Layout: 4 KPI cards row, 2 charts row, top-clients table.

**KPI cards:**
1. **Total receivables** — sum of `outstandingAmount` across all OPEN invoices, all clients
2. **Overdue 90+ days** — sum where `ageBucket = DAYS_90_PLUS`
3. **Collections this month** — sum of `receipts.amount` where receiptDate in current month
4. **Active reminders today** — count of `ReminderSent` rows today

Each KPI formatted as INR with lakh/crore (see `lib/currency.ts`).

**Charts:**
- Ageing distribution (`<BarChart>`): 5 bars for the age buckets, height = amount
- Collections trend (`<LineChart>`): monthly sum of receipts over last 6 months

**Table:** Top 10 clients by total overdue amount. Columns: client name, outstanding, overdue 90+, debtor count, last synced (relative time).

### Client list — `/clients`
- Search bar (filter by `displayName`)
- Filter dropdown: status (All / Active / Paused / Archived)
- Data table (@tanstack/react-table), sortable columns:
  - Client name
  - Total outstanding
  - Overdue (60+)
  - Debtor count
  - Last synced (relative)
  - Status (badge)
- Each row clickable → `/clients/[id]`
- Row kebab menu: "Pause reminders" / "Resume reminders" / "View detail"

### Client detail — `/clients/[id]`
Top section:
- Client name (H1) + status badge
- 3 mini KPIs: total outstanding, overdue, debtor count
- "Pause/Resume reminders" toggle button

Tabs:
1. **Debtors** — table of parties: name, phone, email, outstanding, contact completeness indicator (icon if any contact field missing). Row click → drawer with debtor's invoice list.
2. **Invoices** — table of OPEN invoices: bill ref, bill date, due date, days overdue, outstanding, age bucket badge.
3. **Reminders log** — table of reminders sent for this client: date, debtor, invoice, channel, status.

### Reminder config — `/clients/[id]/reminders`
Form (Server Action on submit):
- Enable toggle
- Trigger days: tag input (chips for each number), default `[-3, 0, 7, 14, 30]`
- Channels: 3 checkboxes (Email / SMS / WhatsApp)
- Email template: textarea with variables `{{party_name}}`, `{{amount}}`, `{{bill_ref}}`, `{{days_overdue}}`
- SMS template: textarea (160 char limit shown)
- WhatsApp template ID: text input (from Meta-approved templates)
- "Send test reminder" button → fires one reminder to a test email/number you specify

### Reports — `/reports` (lightweight for V1)
- Collections trend chart (12 months)
- Ageing trend chart (weekly snapshot)
- Per-client leaderboard: best collection velocity

### Settings — `/settings`
- Firm info (read-only in V1)
- Staff list (add/remove staff — Partner role only)
- Sync health: last successful sync timestamp, connector status

---

## API routes

### `POST /api/sync`
Auth: `Authorization: Bearer <SYNC_API_KEY>`.

Request body (Zod schema):
```ts
{
  synced_at: string,    // ISO timestamp
  companies: Array<{ tally_name: string }>,
  parties: Array<{
    company: string,
    tally_ledger_name: string,
    parent_group: string,
    closing_balance: number,
    mailing_name?: string | null,
    address?: string | null,
    phone?: string | null,
    email?: string | null,
  }>
}
```

Logic:
1. Validate bearer token → reject with 401 if invalid
2. Validate body with Zod → reject with 400 on failure
3. Resolve `firmId` — hardcoded to DPS & Co's firm ID for V1 (single-tenant)
4. Upsert each `ClientCompany` by `(firmId, tallyCompanyName)`
5. For each party, upsert by `(clientCompanyId, tallyLedgerName)`, updating `closingBalance` and contact fields
6. Return `{ synced: { companies, parties }, timestamp }`

### `GET /api/cron/compute-ageing`
Auth: `Authorization: Bearer <CRON_SECRET>`.

Logic:
1. For every OPEN invoice, compute `ageBucket` from `dueDate` (or `billDate + default_credit_days`)
2. Bulk update via a single `prisma.$executeRaw` query for speed
3. Return `{ updated: n }`

Schedule: daily at 09:00 IST (via `vercel.json`).

### `GET /api/cron/send-reminders`
Auth: `Authorization: Bearer <CRON_SECRET>`.

Logic:
1. For each ACTIVE ClientCompany with an enabled ReminderRule:
   a. Find OPEN invoices where today = `dueDate + triggerDay` (for any triggerDay in rule)
   b. Skip if a reminder on this invoice+channel was sent in last 24h
   c. For each enabled channel, dispatch via the right provider
   d. Record a `ReminderSent` row per message
2. Catch errors per-invoice — one failure doesn't abort the batch
3. Return `{ sent: n, failed: n, details: [...] }`

Schedule: daily at 10:00 IST.

---

## Auth (NextAuth v5)

`lib/auth.ts`:
- Credentials provider
- Verify email exists in `FirmStaff`, compare password with bcryptjs
- JWT session with `{ id, firmId, role, email, name }` in token
- Session callback exposes these to client

`middleware.ts`:
- Protect everything under `/(dashboard)/*`
- Redirect unauthenticated to `/login`

---

## Styling conventions

- **Color palette:** shadcn defaults (neutral base) + `blue` accent
- **Typography:** default shadcn scale (Inter via next/font)
- **Container padding:** `p-6` on page roots, `gap-4` between sibling blocks
- **KPI cards:** shadcn `<Card>`, title in `text-sm text-muted-foreground`, value in `text-2xl font-semibold`
- **Data tables:** sticky header row, zebra stripes off, hover highlight on rows
- **Empty states:** every list renders a friendly message + icon when empty, never a blank area
- **Loading:** skeleton rows in tables, not spinners

---

## Critical implementation notes

1. **INR formatting with lakh/crore** — in `lib/currency.ts`:
   ```ts
   export function formatINR(n: number): string {
     return new Intl.NumberFormat('en-IN', {
       style: 'currency', currency: 'INR', maximumFractionDigits: 0
     }).format(n);
   }
   // For compact: ₹1.2L, ₹3.4Cr
   export function formatINRCompact(n: number): string { ... }
   ```
2. **Timezone** — store everything UTC in DB. Always display in IST using `formatInTimeZone(date, 'Asia/Kolkata', 'dd MMM yyyy')`.

3. **Multi-tenancy (forward-looking)** — every Prisma query in server components must filter by `firmId` from the session. Create a `withFirm()` helper in `lib/session.ts` that wraps Prisma calls with this filter automatically.

4. **Ageing bucket computation** — in `lib/ageing.ts`, pure function `(dueDate: Date, today: Date) => AgeBucket`. Unit-testable.

5. **Server Actions over API routes for UI mutations** — use Next.js Server Actions for form submissions (reminder config, pause/resume client, etc.). Reserve `/api/*` for the connector and cron jobs.

6. **Cron auth** — Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Verify in every cron route or return 401.

7. **Idempotency** — the `/api/sync` endpoint will be hit many times a day. Every upsert must be idempotent (use the `@@unique` indexes in the schema).

8. **Error toasts** — never expose raw errors to users. In Server Actions, catch and return `{ ok: false, error: 'Friendly message' }`, toast it client-side.

9. **Never log PII** — don't log debtor phone/email/address in any server log. Log counts and IDs only.

---

## `vercel.json` (cron schedules)

```json
{
  "crons": [
    { "path": "/api/cron/compute-ageing", "schedule": "30 3 * * *" },
    { "path": "/api/cron/send-reminders", "schedule": "30 4 * * *" }
  ]
}
```
(Times in UTC. 03:30 UTC = 09:00 IST, 04:30 UTC = 10:00 IST.)

---

## Build order (follow this sequence)

1. Scaffold Next.js + install deps + shadcn init
2. Drop in `schema.prisma`, run `npx prisma migrate dev --name init`
3. `lib/prisma.ts` singleton
4. `lib/auth.ts` + `app/api/auth/[...nextauth]/route.ts` + `middleware.ts`
5. Seed script: create Firm "DPS & Co" + demo FirmStaff user
6. `/login` page → verify signin works end-to-end
7. `(dashboard)/layout.tsx` with sidebar nav
8. Overview page with **mocked data** → then swap to real Prisma queries
9. `/clients` list page
10. `/clients/[id]` detail page (Debtors tab first, then Invoices, then Reminders)
11. `POST /api/sync` route → test with the Python connector
12. `lib/ageing.ts` + `/api/cron/compute-ageing`
13. `/clients/[id]/reminders` config page (Server Action)
14. `lib/email.ts` + Resend integration
15. `/api/cron/send-reminders`
16. WhatsApp integration (last — uses Meta Cloud API test number)
17. Deploy to Vercel, wire up crons, set env vars

---

## Out of scope for this week (do not build)

- Mobile responsive polish (desktop-first is fine)
- Two-way Tally sync
- Payment gateway / UPI collection
- Client-facing logins
- Multi-firm support (stays single-tenant)
- Advanced reports / CSV exports
- SMS integration (mock with console.log for V1 demo — wait for DLT)

---

## Demo criteria (end of week)

The manager should be able to:
1. Log in at a live Vercel URL
2. See real debtor data synced from a live Tally instance
3. View ageing across 300+ companies (or however many the backup contains)
4. Drill into any client and see outstanding invoices
5. Configure a reminder rule and trigger a test send to his own email + WhatsApp
6. Verify the reminder arrived on his phone

If all six work end-to-end, the assignment is done.
