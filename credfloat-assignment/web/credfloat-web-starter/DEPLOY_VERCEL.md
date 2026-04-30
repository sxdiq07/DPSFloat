# Deploying CredFloat Web to Vercel

End-to-end deploy checklist. Stop at any step that needs an account/credential
you haven't created yet — every input here ties to something you must create
on a third-party service first.

## 1. Pre-flight (do these before running `vercel`)

- [ ] **GitHub** — push the repo to GitHub (Vercel imports best from there).
- [ ] **Vercel account** — sign up at <https://vercel.com>, install Vercel CLI:
      `npm i -g vercel`. Log in: `vercel login`.
- [ ] **Postgres** — pick one:
      - **Supabase** (Mumbai region recommended for India): create a new
        project, grab the *Transaction pooler* (port 6543) URL for
        `DATABASE_URL` and the *Direct* (port 5432) URL for `DIRECT_URL`.
      - **Vercel Postgres**: easier integration but no Mumbai region as of
        this writing — adds latency for an India-based firm.
      - **Neon**: works fine; pooler URL goes in `DATABASE_URL`.
- [ ] **Resend** — sign up, verify a domain (or stick with `onboarding@resend.dev`
      sandbox until DNS for `dpsca.in` is set up). Generate an API key.
      Resend sandbox can only send to the email that owns the account.
- [ ] **Domain** — book a CNAME or A record. For first cut, just use the
      `*.vercel.app` URL Vercel assigns; switch to a custom domain after
      smoke-testing.
- [ ] (Optional) **Twilio + WhatsApp** — only needed if you're demoing IVR
      or WhatsApp reminders. Leave blank to stub those code paths.

## 2. First deploy

From `credfloat-assignment/web/credfloat-web-starter/`:

```bash
vercel link               # one-time: pick or create the project
vercel env pull .env.vercel.preview   # optional: pull existing env vars
```

Set every required env var in the Vercel dashboard (Settings → Environment
Variables). Use the table below.

```bash
vercel --prod             # first production deploy
```

## 3. Initial DB setup (once, after first deploy)

```bash
# Local shell with the production DATABASE_URL exported:
DATABASE_URL="<prod-pooler-url>" \
DIRECT_URL="<prod-direct-url>" \
npx prisma migrate deploy

# Then seed the firm + demo user:
DATABASE_URL="<prod-pooler-url>" \
DIRECT_URL="<prod-direct-url>" \
npm run db:seed
```

Capture the seeded firm ID from the seed script's output and set it as
`SEED_FIRM_ID` in Vercel — that's what `/api/sync` uses to attach incoming
Tally data to the right tenant.

## 4. Required env vars

| Name | Value | Where to get it | Required |
|---|---|---|---|
| `DATABASE_URL` | Postgres pooler URL (port 6543 on Supabase) | Postgres provider | Yes |
| `DIRECT_URL` | Postgres direct URL (port 5432) | Postgres provider | Yes (for migrations) |
| `AUTH_SECRET` | 32-byte random string | `openssl rand -base64 32` | Yes |
| `NEXTAUTH_SECRET` | Same as `AUTH_SECRET` | duplicate | Yes (NextAuth v5 reads both) |
| `NEXTAUTH_URL` | `https://<your-vercel-domain>` | Vercel dashboard | Yes |
| `APP_URL` | Same as `NEXTAUTH_URL` | — | Yes |
| `SYNC_API_KEY` | 32-byte random | `openssl rand -base64 32` | Yes — paste into every connector .exe install |
| `CRON_SECRET` | 32-byte random | `openssl rand -base64 32` | Yes (Vercel Cron uses this) |
| `LEDGER_TOKEN_SECRET` | 32-byte random | `openssl rand -base64 32` | Yes (signs public ledger links) |
| `RESEND_API_KEY` | `re_…` | Resend dashboard | Yes (for email reminders) |
| `RESEND_FROM` | `noreply@yourdomain` | once domain is verified | Yes |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` | Resend → Webhooks | Yes (else webhook 401s) |
| `SEED_FIRM_ID` | UUID from `db:seed` output | seed run | Yes |
| `SEED_FIRM_NAME` | `DPS & Co` | constant | Yes (fallback) |
| `TWILIO_ACCOUNT_SID` etc. | Twilio | Twilio console | Optional (IVR only) |
| `WHATSAPP_PHONE_NUMBER_ID` etc. | Meta Cloud API | Meta dashboard | Optional |

Set every required var in **Production**, **Preview**, and **Development**
scopes unless you have a reason not to. Easy mistake: setting only Production
and then having Preview deploys 500 because they can't reach the DB.

## 5. After deploy — smoke test

1. Hit `https://<your-domain>/login` → log in with the seeded demo user.
2. Run the connector .exe locally pointed at the prod URL — verify a sync
   round-trip lands data in the dashboard.
3. Trigger a reminder send manually; confirm Resend receives it.
4. Visit `/api/connector/status` with `Authorization: Bearer $SYNC_API_KEY`
   to confirm the connector ping endpoint works.

## 6. After smoke test — connector ↔ prod

In every client's `CredFloatSetup.exe` install, the setup dialog asks for:
- **API URL** — set the default in `connector/app/setup_dialog.py` (`DEFAULT_API_URL`)
  to `https://<your-vercel-domain>/api/sync` and rebuild.
- **API Key** — paste the same `SYNC_API_KEY` value.

For per-client tokens (each firm's connector with a unique key), evolve the
single `SYNC_API_KEY` env var into a `ConnectorToken` table keyed to a Firm.
Out of scope for the MVP demo — single shared token works for one firm.

## 7. Things that will trip you up

- **Pooler vs direct URL.** Prisma migrations need the *direct* URL. Runtime
  queries use the *pooler*. Mixing them up causes "prepared statement already
  exists" or migrations that hang.
- **`postinstall: prisma generate`** is already in `package.json` — Vercel
  runs it automatically. Don't override the build command.
- **`@react-pdf/renderer`** is declared in `serverExternalPackages` in
  `next.config.ts` already; if you add another native-leaning package, expect
  to do the same.
- **Cron schedules** in `vercel.json` use UTC. The two existing entries
  (`30 2 * * *`, `30 4 * * *`) are 08:00 IST and 10:00 IST — adjust for IST
  by subtracting 5h30 from the desired Indian time.
- **Function timeouts.** `/api/sync` does heavy work; if the ODBC sync
  pushes >1k parties you may need `export const maxDuration = 60` on the
  route or an upgrade off Vercel's free tier (60s cap).
