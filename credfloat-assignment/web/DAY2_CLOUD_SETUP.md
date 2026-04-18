# Day 2 — Cloud Foundation Setup

By end of Day 2: Next.js + Supabase running, database migrated, Python connector successfully posting real Tally data to the cloud.

Budget: 3–5 hours if things go smoothly.

---

## Part A — Supabase (20 minutes)

1. Go to https://supabase.com → Sign up (use your work email for later team access)
2. Create a new project:
   - **Name:** `credfloat-dev`
   - **Database password:** generate a strong one — save it to a password manager immediately
   - **Region:** `Mumbai (ap-south-1)` ← important for latency to your firm's users
   - **Plan:** Free tier
3. Wait ~2 minutes for provisioning
4. Once ready, go to **Project Settings → Database**
5. Under "Connection string" → select **URI** tab
6. Copy two connection strings:
   - **Transaction pooler** (port 6543) → this goes into `DATABASE_URL`
   - **Direct connection** (port 5432) → this goes into `DIRECT_URL` (for migrations)
7. Replace `[YOUR-PASSWORD]` in both strings with the password you saved

These go into your Next.js `.env.local` file.

---

## Part B — Next.js project (30 minutes with Cursor)

Open Cursor. Create a new folder called `credfloat-web`. Drop `CURSOR_BRIEF.md` and `schema.prisma` into it.

In Cursor, open `CURSOR_BRIEF.md` and send this message:

> Read CURSOR_BRIEF.md carefully — this is the complete spec for the project. Execute the "Project setup" section step by step. After it's scaffolded, drop the schema.prisma file at prisma/schema.prisma and run the Prisma migration. Don't move forward past that — stop and let me verify it works before starting page scaffolding.

Cursor will:
1. Run `create-next-app` with the right flags
2. Install shadcn/ui
3. Install all the deps from the brief
4. Set up Prisma
5. Wait for you to review

**Verification:** `npm run dev` should open a working localhost:3000 with the default Next.js page.

---

## Part C — Configure environment (10 minutes)

In `credfloat-web/.env.local`:

```
# Database (from Supabase Settings → Database → URI)
DATABASE_URL="postgresql://postgres.xxxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.xxxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# Auth secrets — generate each with: openssl rand -base64 32
NEXTAUTH_SECRET="...paste random 32-char base64..."
NEXTAUTH_URL="http://localhost:3000"

# Shared with Python connector — any long random string
SYNC_API_KEY="dps-credfloat-sync-7x9p2q8r4y1m6n3v"

# For cron auth (used Day 4)
CRON_SECRET="dps-credfloat-cron-8h4k2l7j9m5n6b3c"

# Email — leave blank for now, added Day 4
RESEND_API_KEY=""
RESEND_FROM="onboarding@resend.dev"
```

Then in Cursor:

> Now run the Prisma migration: `npx prisma migrate dev --name init`. Verify all tables were created in Supabase. Then scaffold a minimal seed script at prisma/seed.ts that creates one Firm record named "DPS & Co" and one FirmStaff user with email "demo@dpsandco.in" and password "dps2026" (bcrypt-hashed). Register the seed script in package.json under "prisma": { "seed": "tsx prisma/seed.ts" }.

---

## Part D — Build auth + `/api/sync` endpoint (60–90 minutes with Cursor)

Next Cursor prompt:

> Now follow Build order step 3 onwards from CURSOR_BRIEF.md. Priority: get authentication working and /api/sync receiving payloads. Skip page building for now — I just want the backend plumbing done. Order:
> 1. lib/prisma.ts singleton
> 2. lib/auth.ts with NextAuth v5 credentials provider, bcrypt password check
> 3. app/api/auth/[...nextauth]/route.ts
> 4. middleware.ts protecting dashboard routes
> 5. A minimal /login page that can actually sign in
> 6. app/api/sync/route.ts with Zod validation, bearer auth (SYNC_API_KEY), upsert logic for ClientCompany + Party as specified in the brief

Review each file Cursor generates. Push back if it over-engineers or strays from the brief.

**Verification milestones:**
- ✓ Can log in with demo credentials at `/login`
- ✓ Authenticated session redirects to `/` (even if the page is empty)
- ✓ Unauthenticated users are redirected to `/login`
- ✓ `curl` test of `/api/sync` with correct bearer token returns 200
- ✓ `curl` test with wrong bearer token returns 401

### curl smoke test for /api/sync

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Authorization: Bearer dps-credfloat-sync-7x9p2q8r4y1m6n3v" \
  -H "Content-Type: application/json" \
  -d '{
    "synced_at": "2026-04-18T10:00:00Z",
    "companies": [{"tally_name": "Test Co Pvt Ltd"}],
    "parties": [{
      "company": "Test Co Pvt Ltd",
      "tally_ledger_name": "Acme Corp",
      "parent_group": "Sundry Debtors",
      "closing_balance": 150000
    }]
  }'
```

Should return `200` with the sync count. Then check Supabase → Table Editor → `ClientCompany` and `Party` tables should contain the test data.

---

## Part E — Wire Python connector to cloud (15 minutes)

Back in `credfloat-connector/.env`:

```
CREDFLOAT_API_URL=http://localhost:3000/api/sync
CREDFLOAT_API_KEY=dps-credfloat-sync-7x9p2q8r4y1m6n3v
DRY_RUN=false
```

Run:
```bash
python tally_connector.py
```

Expected:
- Connector connects to Tally via ODBC
- Extracts debtors
- POSTs to `localhost:3000/api/sync`
- Next.js logs the request
- Supabase now has the firm's real debtor data

Go to Supabase → Table Editor → `Party` — you should see real client debtors with real closing balances.

**Screenshot this**. That's your Day 2 deliverable for the manager.

---

## Day 2 message to manager

> Day 2 done. Cloud backend scaffolded on Supabase (Mumbai), Next.js API live, auth working, /api/sync receiving real data from the connector. [N] debtors from [Company Name] now in cloud DB. Tomorrow: dashboard UI for ageing buckets and client drilldown. Attaching Supabase screenshot.

---

## If something breaks

**Prisma migration fails:**  `DIRECT_URL` is probably wrong — migrations must use the 5432 port, not 6543. The pooler port blocks DDL.

**NextAuth session not persisting:** `NEXTAUTH_SECRET` is missing or `NEXTAUTH_URL` doesn't exactly match `http://localhost:3000`.

**/api/sync returns 500 with "firm not found":**  you haven't run the seed script yet. `npx prisma db seed`.

**Python connector gets `connection refused` on /api/sync:** Next.js dev server isn't running, or you're posting to `https://` instead of `http://` locally.

**CORS errors in browser console:** irrelevant for the connector (server-to-server), but if they show up in dashboard queries, confirm the request is same-origin.

---

## What gets deferred to Day 3

Everything UI-related. Overview page, client list, debtor drilldown, ageing charts — all Day 3. Day 2 is about plumbing.
