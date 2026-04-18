# CredFloat Starter — Architecture Review v1

**Reference architecture:** `credfloat-assignment/architecture/CredFloat_Architecture_v1.md` (treated as read-only source of truth).
**Scope audited:** `credfloat-assignment/web/credfloat-web-starter/` — NextAuth split, `/api/sync`, two cron routes, ageing lib, reminder dispatch, multi-tenancy, schema completeness.
**Verdict:** The starter follows the reference architecture closely. Four real defects block the end-to-end reminder flow (three of them on the Fix list, one a top-clients correctness bug). A few important-but-deferrable performance issues are called out for Phase 2.

---

## Blockers — ship-stoppers for the demo

1. **WhatsApp channel is dead code.**
   - `src/app/api/cron/send-reminders/route.ts:88-95` reads `inv.party.whatsappNumber` only, with no fallback to `party.phone`.
   - `src/app/api/sync/route.ts:7-16` Zod `partySchema` has no `whatsapp_number` field, and the create/update branches at lines 104-123 never touch the `whatsappNumber` Prisma column.
   - `credfloat-assignment/connector/tally_connector.py:58-69` `PartyRecord` dataclass has no `whatsapp_number` attribute.
   - Result: the `Party.whatsappNumber` column (schema.prisma:103) is always `NULL`, so the WhatsApp branch in the cron is unreachable. → **Fix 1.**

2. **Ageing and "today" computed in UTC, not IST.**
   - `src/lib/ageing.ts:9, 25` — default `today = new Date()` returns UTC on Vercel.
   - `src/app/api/cron/compute-ageing/route.ts:15` — same.
   - `src/app/api/cron/send-reminders/route.ts:16-18` — `new Date()` + `setHours(0,0,0,0)` produces UTC midnight, then drives both the `daysOverdue` compare and the idempotency window.
   - Vercel crons fire at 03:30 UTC / 04:30 UTC (09:00 / 10:00 IST per `vercel.json`). Between 00:00 IST and 05:30 IST the UTC day is still yesterday — so an invoice dated `2026-04-18 00:00 IST` (`2026-04-17 18:30 UTC`) gets `daysOverdue = -1` under UTC math when the cron is meant to treat it as "due today". Reminders scheduled for `triggerDays: [0]` silently miss. → **Fix 2.**

3. **"Top 10 clients by outstanding" returns arbitrary clients at scale.**
   - `src/app/(dashboard)/page.tsx:47-58` does `prisma.clientCompany.findMany({ take: 10 })` then sums invoices in JS and re-sorts (lines 76-94). Prisma returns ten clients in `id`/insertion order, not by outstanding. For 300 clients the list is meaningless. → **Fix 3.**

4. **The "final" email template is unreachable under default rules.**
   - `src/lib/email.ts:25-29` `selectTemplate` returns `"final"` only when `daysOverdue > 45`.
   - `ReminderRule.triggerDays` default is `[-3, 0, 7, 14, 30]` — max is 30, so the selector lands on `"followup"` forever. → **Fix 4.**

---

## Important — correctness or scale concerns, not demo blockers

- **N+1 upsert loop in `/api/sync`** (`src/app/api/sync/route.ts:69-85, 90-126`). 300 companies × ~50 parties = ~15k sequential round-trips every 10-15 min. Will time-out on Vercel at real scale. Batch via `prisma.$transaction([...])` or raw SQL `ON CONFLICT`. **Deferred (out of Phase 2 scope).**
- **N+1 update loop in `compute-ageing`** (`src/app/api/cron/compute-ageing/route.ts:25-35`). `CURSOR_BRIEF.md §API routes` explicitly called for a single `prisma.$executeRaw` CASE expression. **Deferred.**
- **Firm resolved by name in sync** (`src/app/api/sync/route.ts:57-59`). Rename "DPS & Co" → sync breaks silently with 500. Pin via `SEED_FIRM_ID` env var. **Deferred.**
- **Idempotency window for reminders uses UTC midnight** (`src/app/api/cron/send-reminders/route.ts:17-18, 70-77`). Covered by the IST fix above — once `startOfToday` becomes IST midnight, the dedup window aligns with the cron fire time.
- **Clients-list page loads every invoice into memory** (`src/app/(dashboard)/clients/page.tsx:12-22`) then aggregates in JS. Same class of issue as Fix 3 — aggregate in SQL with `invoice.groupBy`. **Deferred — noted for Phase 2.**
- **No `ReminderSent` dedup at the DB layer.** Only the app-layer `findFirst` guards against double-sends. A partial unique index on `(invoiceId, channel, date_trunc('day', sentAt))` would make it idempotent if a cron run overlaps with a manual trigger. **Deferred.**

---

## Nice-to-have

- `Decimal → Number` coercions throughout dashboard pages lose precision above 2^53; fine for INR but worth a helper.
- `email.ts:25-29` could expose thresholds as constants instead of magic numbers.
- `middleware.ts:13` matcher runs on `/api/sync` + `/api/cron`; `auth.config.ts:33-39` short-circuits correctly, but the matcher could exclude them for a small perf win.
- `src/app/api/sync/route.ts:82` sets `updatedAt: new Date()` explicitly — redundant with Prisma `@updatedAt`.
- `src/lib/ageing.ts` header comment says "easy to unit test" — no tests exist. Add a minimal Vitest suite for bucket boundaries after the IST fix.
- Connector at `tally_connector.py:212` emits `datetime.utcnow()` (deprecated in 3.12) — switch to `datetime.now(timezone.utc)` eventually.

---

## Areas that passed cleanly

- **NextAuth v5 edge split.** `middleware.ts` imports only `authConfig`; `auth.config.ts` holds JWT/session callbacks + route gating with zero DB deps; `auth.ts` layers on the Credentials provider + Prisma + bcryptjs and exports handlers. `app/api/auth/[...nextauth]/route.ts` correctly pins `runtime = "nodejs"`. `src/types/next-auth.d.ts` extends `Session`/`User`/`JWT` consistently. Textbook.
- **Multi-tenancy.** Every dashboard query filters on `firmId` — overview (`page.tsx:17, 21, 28, 38, 44, 48`), clients list (`page.tsx:12`), client detail (`page.tsx:20-21` guards with `findFirst({ where: { id, firmId } })` so `notFound()` fires cross-firm). `requireAuth`/`requireFirmId` gate both the layout and every page.
- **Schema.** Every field the sync and cron routes expect exists on the models. `Party.whatsappNumber` is present; the only gap is the sync-side wiring (Blocker #1), not the schema.
- **Bearer auth on sync and crons.** Constant-time-ish comparison is missing, but timing-attack risk on a shared secret sent over TLS is negligible here.
- **Opt-out honoring.** `send-reminders/route.ts:45` filters `party.optedOut: false` in the invoice query — one place, hard to forget.

---

## Recommendation

Proceed to Phase 2 with the four listed fixes. The Important-bucket items (N+1 upserts, sync-firm-by-name, clients-list aggregation) should be tracked as Phase 2 work but are not on the critical path for the demo.
