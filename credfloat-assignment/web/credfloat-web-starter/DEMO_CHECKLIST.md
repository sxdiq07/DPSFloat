# Demo checklist — 2026-04-22

Run this in order the morning of the demo. ~10 minutes.

## 1. Prep the codebase (one-time)

```powershell
cd "C:\Users\Mohamed Sadiq\Downloads\credfloat-assignment (1)"
git pull

cd credfloat-assignment\web\credfloat-web-starter
# Make sure the npm run dev terminal is stopped (Ctrl+C) before this.
npm install
npx prisma migrate deploy
npx prisma generate
```

You should see:
- `npm install` → installs `@react-pdf/renderer` and siblings
- `prisma migrate deploy` → either "No pending migrations" or "Applied: 20260421190000_ledger_pdf"
- `prisma generate` → "Generated Prisma Client"

## 2. Seed your demo debtor

Open Prisma Studio (new terminal):

```powershell
npx prisma studio
```

At `localhost:5555`:
1. **Firm** table → set `frn`, `partnerName`, `partnerMno` on the DPS & Co row. These appear on every ledger PDF.
2. **Party** table → filter `tallyLedgerName contains "VIP"` (or whichever debtor has the most invoices) → set `email` = the address you registered with Resend, `whatsappNumber` = your own phone with country code (e.g. `919876543210`, no `+`). This is the debtor you'll demo live sends on.

## 3. Start the app

Terminal 1 (keep running):
```powershell
cd "C:\Users\Mohamed Sadiq\Downloads\credfloat-assignment (1)\credfloat-assignment\web\credfloat-web-starter"
npm run dev
```

Wait for `✓ Ready`.

## 4. Sync fresh data from Tally (if Tally is reachable)

Terminal 2:
```powershell
cd "C:\Users\Mohamed Sadiq\Downloads\credfloat-assignment (1)\credfloat-assignment\connector"
python tally_connector.py
```

If Tally isn't loaded, Prisma Studio and the app will still show last sync's data. Fine for the demo.

## 5. Sanity check against Tally truth

```powershell
cd "C:\Users\Mohamed Sadiq\Downloads\credfloat-assignment (1)\credfloat-assignment\web\credfloat-web-starter"
npx tsx prisma/reconcile-check.ts
```

Expect: ledger view ≈ ₹36.17L, advance ≈ ₹0. If advance blew up past ₹10k, run:
```powershell
npx tsx prisma/reset-receipts.ts
python ..\..\connector\tally_connector.py
```
to rebuild from scratch.

---

## Demo script (≈ 10 minutes)

1. **Login** at `localhost:3000` → `demo@dpsandco.in` / `dps2026`.

2. **Overview page** — walk the manager through:
   - Hero total (₹36L) — say "this is ledger-balance-based, matches Tally's Outstandings report"
   - Ageing distribution bar — point out the 90+ slice
   - "Where the book is concentrated" — top clients
   - Duplicate exposure card — cross-client same debtor

3. **Clients → M-TRADING** (or whatever client shows first).
   - **Debtors tab**: ledger balance as primary number. On rows where bills don't match ledger, a muted `bills ₹X` sub-line flags the reconciliation gap (explain: Tally journal/opening-balance entries we don't sync).
   - Click the 📖 book icon → opens the per-debtor **ledger drill-down** with running balance, period chips. Point out the "Download PDF" button (top right).

4. **Invoices tab** on the client detail → on the debtor you seeded in step 2:
   - Click **Send → Preview message** → modal shows the exact email HTML and WhatsApp text. Manager sees what the debtor would receive.
   - Click **Send → Send email** → attachment is the ledger PDF. Open your inbox; it arrived.
   - Click **Send → Send WhatsApp** → opens WhatsApp Web with message pre-filled + signed ledger link. Hit send. Message + link arrives on your phone.

5. **Reminders config** (top-right on client detail → "Reminder settings")
   - Trigger days (-3, 0, 7, 14, 30) — when reminders auto-fire
   - Channels (email + WhatsApp)
   - **Ledger attachment** section — toggle, period selector (FY-to-date by default)

6. **Settings page** → show the **Firm letterhead** section (FRN, partner name, M.No. — these drive every PDF).

7. **Wrap**: "The 9:30 IST cron fires all this automatically every morning. Today was a manual walk-through. Regulatory follow-ups — DLT for SMS, Meta WhatsApp template approval — are 2-3 weeks of paperwork, not engineering."

---

## If something breaks mid-demo

| Symptom | Cause | Quick recovery |
|---|---|---|
| 500 on `/api/ledger/[token]` | `@react-pdf/renderer` not installed | Route now returns JSON with hint. Pivot to Preview modal instead. |
| Preview modal shows dark overlay only | Browser cached stale chunk | Ctrl+Shift+R. |
| Send → Email shows "stubbed" | `RESEND_API_KEY` missing | Use Preview modal for the demo path. |
| Send → WhatsApp opens but text is empty | Click-to-chat URL too long for browser | Try a shorter debtor name. |
| Numbers look wrong everywhere | Tally sync didn't run / stale DB | Accept it, demo what's there. Don't try to fix live. |

**The most important rule: don't try to fix anything live in front of the manager.** If something breaks, pivot to what works.
