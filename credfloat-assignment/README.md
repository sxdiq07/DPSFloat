# CredFloat Assignment — Complete Deliverables

Everything you need to build CredFloat for DPS & Co, organized into three folders.

> **Total scope of this package:** architecture doc ready to send the manager, a tested Python Tally connector, and a near-complete Next.js web app that Claude Code drops in and runs.

---

## 🚀 The fastest path (1 day target)

1. **Send the architecture** — email/WhatsApp `architecture/CredFloat_Architecture_v1.pdf` to your manager now.
2. **Install Tally** — follow `connector/DAY1_TALLY_SETUP.md` while waiting for manager's backup.
3. **Test the connector** — once backup arrives: `python connector/test_tally_connection.py` → screenshot all ✓.
4. **Hand to Claude Code** — open `web/credfloat-web-starter/` and paste the last section of `CLAUDE_CODE_QUICKSTART.md` as your prompt. It'll scaffold, install, migrate, and run.
5. **Wire them together** — point the Python connector at your deployed `/api/sync` URL, run it, watch real Tally data appear in the dashboard.
6. **Demo** — login → overview → clients → send one test reminder to your manager's email. Done.

---

## What's in each folder

### `architecture/`

- **`CredFloat_Architecture_v1.pdf`** ← **Send this to your manager.** 4-page polished PDF covering overview, components, data flow, technical decisions, security/DPDP, and V1 scope.
- `CredFloat_Architecture_v1.md` — Markdown source if he asks for changes.

### `connector/`

The Python program that reads Tally via ODBC and pushes to the cloud.

- **`DAY1_TALLY_SETUP.md`** — **Start here.** Windows-specific step-by-step setup with troubleshooting for the top 8 issues that trip people up.
- **`test_tally_connection.py`** — Run **before** the main connector. 5-step sanity check with clear error messages. Saves an hour of debugging.
- `tally_connector.py` — Main connector.
- `requirements.txt`, `.env.example` — Config and deps.

### `web/`

The Next.js web app.

- **`credfloat-web-starter/`** ← **The pre-built codebase.** 30+ files of working code. Auth, database, sync endpoint, reminder engine, email templates, WhatsApp wrapper, dashboard pages — all done. Just drop into a fresh Next.js project.
- **`credfloat-web-starter/CLAUDE_CODE_QUICKSTART.md`** — 11-step execution guide for Claude Code. The last section has a one-paste prompt to hand off the whole build.
- `CURSOR_BRIEF.md` — Original detailed spec (for reference / extension).
- `DAY2_CLOUD_SETUP.md` — Supabase + Next.js setup walkthrough.
- `schema.prisma` — Database schema (also inside the starter).

---

## What the starter gives you out of the box

**Backend:**
- NextAuth v5 credentials auth (email + password, bcrypt, JWT sessions)
- Prisma ORM with complete multi-tenant schema
- `POST /api/sync` — receives and upserts Tally data from Python connector
- `GET /api/cron/compute-ageing` — daily ageing bucket recompute
- `GET /api/cron/send-reminders` — daily reminder dispatch across channels
- Edge-safe middleware protecting dashboard routes
- Resend email integration with 3 pre-written templates (gentle, follow-up, final notice)
- Meta WhatsApp Cloud API wrapper (with safe stub mode for demos)

**Frontend:**
- Login page with server action auth
- Dashboard sidebar + layout
- Overview page (KPIs, ageing distribution, top clients)
- Clients list page
- Client detail page (debtors, invoices with ageing badges)
- Reports + Settings pages
- INR formatting with lakh/crore, IST timezone handling

**Infrastructure:**
- Vercel cron schedules pre-configured in `vercel.json`
- `.env.example` with every variable documented
- Seed script that creates demo firm + user
- TypeScript strict mode, Tailwind CSS, proper `.gitignore`

---

## What the starter intentionally does NOT include

Easily added by Claude Code if you have extra time:

- **shadcn/ui components** — pages use plain Tailwind. Run `npx shadcn@latest init` then `add button card input label table` to upgrade.
- **Reminder config UI** — `ReminderRule` exists in schema; page at `/clients/[id]/reminders` isn't built.
- **Bill-wise invoice sync** — Python connector reads parties only (Tally ODBC is good for this). Invoices require Tally XML HTTP (different integration). Seed a few invoices manually via Prisma Studio to demo the ageing buckets.
- **Charts on Reports page** — placeholder; wire up Recharts when useful.

---

## Demo criteria for the manager

End of day you should be able to:

1. ✅ Open a live Vercel URL
2. ✅ Log in with `demo@dpsandco.in` / `dps2026`
3. ✅ Show real Tally data on the overview page
4. ✅ Click into a client, see debtors with outstanding balances
5. ✅ Trigger a test reminder → email arrives in manager's inbox
6. ✅ Show the architecture PDF as the design doc

---

## Honest positioning for the manager

> "Demo is ready today. Live pilot with real debtors needs 2 more weeks for DLT SMS registration and WhatsApp template approval — those are regulatory, not build time."

This signals you understand the Indian regulatory layer (DLT, DPDP) that most candidates miss.

---

## Cost

- **Demo / development:** ₹0 (every service has a free tier that covers it)
- **Production (300 clients, full volume):** ~₹15,000–20,000/month operational + one-time ~₹6,000 DLT setup

---

## If you get stuck

- Tally ODBC issues → `connector/DAY1_TALLY_SETUP.md` troubleshooting section
- Prisma migration hangs → `DIRECT_URL` vs `DATABASE_URL` mix-up, see quickstart Step 6
- Login redirect loop → missing `AUTH_SECRET`, see quickstart Troubleshooting
- Anything else → come back and ask
