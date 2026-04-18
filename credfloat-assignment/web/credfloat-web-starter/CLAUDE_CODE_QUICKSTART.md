# CredFloat — Claude Code Quickstart

**Read this first, paste sections into Claude Code in order.** This takes you from zero to a running web app with real Tally data flowing through it.

---

## Context for Claude Code

You are helping build **CredFloat**, an internal web app for DPS & Co (a Chartered Accountancy firm) that automates debtor payment reminders across 300+ client companies. Data is read from Tally Prime via a Python connector (separate, already built) and synced to this Next.js app over HTTPS. The app sends reminders via Email (Resend) and WhatsApp (Meta Cloud API).

Architecture, full spec, and all code files are in this `credfloat-web-starter/` folder. **Your job is to scaffold a Next.js project, copy these files in, install dependencies, configure environment, migrate the database, seed it, and run the dev server.**

---

## Step 1 — Scaffold the project

```bash
npx create-next-app@15 credfloat-web --typescript --tailwind --app --src-dir --no-eslint --import-alias "@/*"
cd credfloat-web
```

When prompted, answer:
- ESLint? **No**
- Use Turbopack for dev? **Yes** (or No, doesn't matter)
- Customize import alias? **No** (keep `@/*`)

## Step 2 — Copy all files from `credfloat-web-starter/` into the project root

Overwrite any files that conflict (e.g. `package.json`, `tsconfig.json`, `src/app/layout.tsx`, `src/app/globals.css`). Files to copy verbatim:

```
package.json
tsconfig.json
tailwind.config.ts
postcss.config.js
next.config.ts
vercel.json
middleware.ts
.env.example           (rename the copy to .env.local)
prisma/schema.prisma
prisma/seed.ts
src/types/next-auth.d.ts
src/lib/utils.ts
src/lib/prisma.ts
src/lib/currency.ts
src/lib/ageing.ts
src/lib/auth.config.ts
src/lib/auth.ts
src/lib/session.ts
src/lib/email.ts
src/lib/whatsapp.ts
src/app/layout.tsx
src/app/globals.css
src/app/(auth)/login/page.tsx
src/app/(auth)/login/actions.ts
src/app/(dashboard)/layout.tsx
src/app/(dashboard)/page.tsx
src/app/(dashboard)/clients/page.tsx
src/app/(dashboard)/clients/[id]/page.tsx
src/app/api/auth/[...nextauth]/route.ts
src/app/api/sync/route.ts
src/app/api/cron/compute-ageing/route.ts
src/app/api/cron/send-reminders/route.ts
```

Delete the default `src/app/page.tsx` that `create-next-app` generates — it's replaced by the `(dashboard)/page.tsx`.

## Step 3 — Install dependencies

The provided `package.json` has every dep pinned. Run:

```bash
npm install
```

## Step 4 — Set up Supabase

1. Go to https://supabase.com and create a new project:
   - Name: `credfloat-dev`
   - Region: `Mumbai (ap-south-1)` ← important for the firm's latency
   - Save the database password to a password manager immediately
2. Once provisioned (~2 min), go to **Project Settings → Database → Connection string**
3. Copy **two** URIs:
   - **Transaction pooler** (port 6543) — becomes `DATABASE_URL`
   - **Direct connection** (port 5432) — becomes `DIRECT_URL` (migrations need this)

Replace `[YOUR-PASSWORD]` in both strings.

## Step 5 — Fill in `.env.local`

Open `.env.local` (renamed from `.env.example`) and fill in:

- `DATABASE_URL` — Supabase transaction pooler URI
- `DIRECT_URL` — Supabase direct connection URI
- `AUTH_SECRET` — run `openssl rand -base64 32` in terminal, paste output
- `SYNC_API_KEY` — any long random string (share with Python connector)
- `CRON_SECRET` — any long random string
- `RESEND_API_KEY` — leave blank for now, add later when setting up email

## Step 6 — Migrate and seed the database

```bash
npx prisma migrate dev --name init
npx prisma db seed
```

The seed script creates:
- Firm: `DPS & Co`
- User: `demo@dpsandco.in` / `dps2026`

If migration fails with "prepared statement" errors, the `DIRECT_URL` is wrong — make sure it points to port 5432, not 6543.

## Step 7 — Run the dev server

```bash
npm run dev
```

Open http://localhost:3000 — you should be redirected to `/login`.
Log in with `demo@dpsandco.in` / `dps2026` → you land on the Overview page (empty state, since no data synced yet).

## Step 8 — Smoke test `/api/sync`

In a new terminal, fire a test payload at the sync endpoint:

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Authorization: Bearer <YOUR_SYNC_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "synced_at": "2026-04-18T10:00:00Z",
    "companies": [{"tally_name": "Test Co Pvt Ltd"}],
    "parties": [{
      "company": "Test Co Pvt Ltd",
      "tally_ledger_name": "Acme Corp",
      "parent_group": "Sundry Debtors",
      "closing_balance": 150000,
      "email": "test@example.com"
    }]
  }'
```

Expect HTTP 200 with `{"synced": {"companies": 1, "parties": 1, "skipped": 0}, ...}`.

Reload the dashboard — "Test Co Pvt Ltd" should appear in the Clients list.

## Step 9 — Wire up the Python connector

Go to the `connector/` folder. In its `.env`:

```
CREDFLOAT_API_URL=http://localhost:3000/api/sync
CREDFLOAT_API_KEY=<same SYNC_API_KEY as in web app>
DRY_RUN=false
```

Ensure Tally Prime is running, then:

```bash
cd ../connector
python tally_connector.py
```

Real debtor data from the Tally backup should now populate the dashboard. Screenshot this — it's the key demo moment.

## Step 10 — Set up Resend (email)

1. Sign up at https://resend.com
2. Create an API key → paste into `.env.local` as `RESEND_API_KEY`
3. For the demo, `RESEND_FROM=onboarding@resend.dev` works (3k emails/month free)
4. Restart `npm run dev` to pick up the new env var

Test the email flow: manually create a `ReminderRule` in Prisma Studio (`npx prisma studio`) for one client company, set `triggerDays: [0]`, `channels: [EMAIL]`, then trigger the cron endpoint manually:

```bash
curl http://localhost:3000/api/cron/send-reminders \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>"
```

(For a real test, seed an invoice with `dueDate = today` so the trigger fires.)

## Step 11 — Deploy to Vercel

```bash
# Install Vercel CLI if you don't have it
npm i -g vercel

# From the credfloat-web/ directory:
vercel
```

Follow prompts. After first deploy:
1. Go to Vercel dashboard → your project → Settings → Environment Variables
2. Add all vars from `.env.local` (use production Supabase connection strings)
3. Settings → Crons → verify the two crons are registered (they're in `vercel.json`)
4. Redeploy: `vercel --prod`

Your live URL is now the demo URL you show the manager.

---

## What's intentionally NOT in this starter

These are easy enough for Claude Code to add if needed:

- **shadcn/ui components** — the login/dashboard pages use plain Tailwind. To add shadcn: `npx shadcn@latest init` then `npx shadcn@latest add button card input label table badge`. Then refactor pages to use them — optional for V1.
- **Reminder config UI** — the page at `/clients/[id]/reminders` isn't built. Claude Code can add it; the `ReminderRule` table is already in the schema.
- **Invoices sync** — the V1 Python connector reads parties (debtors) only. Bill-wise invoice sync requires Tally XML HTTP (not ODBC) and is Phase 2. For the demo, seed a few invoices manually via Prisma Studio to show the ageing buckets working.
- **Reports page** — left as an empty route. Build with Recharts when needed.
- **Settings page** — same, low priority for demo.

---

## Demo flow to walk the manager through

1. Open the live Vercel URL on your laptop
2. Log in with demo credentials
3. Overview page — highlight the KPIs (total receivables, overdue 90+)
4. Click into Clients → show the list
5. Click into one client → show debtors + invoices with ageing badges
6. Open email inbox → show the reminder email arriving
7. Show Supabase Table Editor briefly — real data, real schema
8. Architecture PDF on second screen/tab — "and here's the full system design I built this from"

---

## Troubleshooting

**"Cannot find module '@/lib/prisma'"** → `npx prisma generate` didn't run. Run it.

**Login redirects in a loop** → `AUTH_SECRET` is missing from `.env.local`. Set it and restart the dev server.

**Prisma migration hangs** → you're using `DATABASE_URL` (port 6543 pooler) for migrations. Migrations must use `DIRECT_URL` (port 5432). Prisma automatically does this when both are in the schema's datasource block.

**"Firm not found" from /api/sync** → seed script didn't run. `npx prisma db seed`.

**Reminder emails not sending** → `RESEND_API_KEY` is blank. In that state, `email.ts` falls back to a console log (look for `[EMAIL STUB]`). Not a bug — intentional for safe local dev.

**WhatsApp not sending** → `WHATSAPP_PHONE_NUMBER_ID` or `WHATSAPP_ACCESS_TOKEN` blank. Same stub behavior — look for `[WHATSAPP STUB]` in console.

---

## One paste to give Claude Code

If you want to hand this all off in a single prompt, paste this after opening the `credfloat-web-starter` folder in Claude Code:

> Read `CLAUDE_CODE_QUICKSTART.md` in this folder. Execute it step by step. After each step, stop and verify the step worked before proceeding. Pay special attention to Steps 4-6 (Supabase + Prisma) — if any env var or connection string is missing, stop and ask me. Do not skip the smoke test in Step 8.
