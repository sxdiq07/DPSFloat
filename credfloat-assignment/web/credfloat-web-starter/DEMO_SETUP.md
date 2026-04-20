# Demo setup — zero-cost email + WhatsApp

Goal: get real emails and real WhatsApp messages flowing through the app
without paying anything or waiting on business verifications.

---

## Email — Resend free tier (2 min)

Resend's free tier is 3,000 emails/month, no card required. Their sandbox
sender `onboarding@resend.dev` works instantly — no domain setup needed.

One constraint: in sandbox mode, you can only send to the email address you
signed up with. For a demo that's fine — put your own email on one of the
debtor parties and hit the Send button.

1. Sign up at https://resend.com with the address you want reminders to land in.
2. API Keys → Create API Key → copy the value.
3. In `.env`, set:

   ```
   RESEND_API_KEY="re_xxxxxxxx..."
   RESEND_FROM="onboarding@resend.dev"
   ```

4. Restart `next dev`.

To demo: open a debtor in the dashboard, edit their email to your own
address in Prisma Studio (`npm run db:studio`), click **Send → Email**
on any open invoice. The email arrives in ~10 seconds.

Once the demo is over and you want to send from your real domain, verify
the domain in Resend → change `RESEND_FROM` to `reminders@yourdomain.com` →
done. No code change needed.

---

## WhatsApp — click-to-chat (0 min, zero setup)

No API setup at all. The app generates a `wa.me` link with the reminder
text pre-filled. Click **Send → WhatsApp** on any invoice and a new tab
opens in WhatsApp Web (or the desktop app) with the message ready to send —
staff just hits the send button. Real WhatsApp message delivered from the
staff member's own number.

This is the default when `WHATSAPP_ACCESS_TOKEN` is empty in `.env`. Leave
the env var unset and click-to-chat is on automatically. The 9:30 IST cron
skips WhatsApp in this mode (can't click on a human's behalf) — only the
manual "Send" button fires it.

Trade-off vs. full automation: staff has to click once per reminder. Fine
for small firms (< 30 WhatsApp sends/day). For full automation, proceed to
the Meta API path below.

### Using your own number as the sender

`wa.me` links don't specify a sender — they open whichever account is
signed into your WhatsApp Web. Sign into Web with the account you want
reminders to come from, then click Send.

### Demo script for WhatsApp

1. Open a debtor, put **your own** phone number in the `whatsappNumber`
   field (via Prisma Studio or the portal). Include country code, no `+`:
   e.g. `919876543210`.
2. In the dashboard, go to the client → Invoices tab.
3. Click **Send → WhatsApp** next to any open invoice.
4. A new tab opens to `wa.me/919876543210?text=...` — your WhatsApp message
   is pre-filled with the reminder body.
5. Hit send. Message arrives on your phone.

---

## WhatsApp — full API (optional, ~20 min + 24-48h template approval)

Skip this for the initial demo. Revisit when you need unattended dispatch.

1. Go to https://developers.facebook.com, create an app (type: Business).
2. Add the **WhatsApp** product. Meta gives you a free test number that
   can send to up to 5 pre-verified recipient numbers without business
   verification.
3. From the WhatsApp → API Setup page, copy the **Phone number ID** and
   a temporary **Access token**.
4. Create a template named `payment_reminder` in Meta Business Manager
   with body text:
   ```
   Dear {{1}}, a payment reminder for invoice {{2}} of amount {{3}}. Please settle at the earliest.
   ```
   Submit for approval. Turnaround is usually same-day to 48 hours.
5. Once approved, set in `.env`:

   ```
   WHATSAPP_PHONE_NUMBER_ID="..."
   WHATSAPP_ACCESS_TOKEN="..."
   ```

6. Restart. Now the cron dispatches WhatsApp automatically, and the Send
   button uses the API instead of opening a tab.

The temporary Meta access token expires every 24 hours. For a pilot,
generate a **permanent system-user token** in Business Manager → Users →
System Users → assign the WhatsApp Business Account.

---

## SMS — deferred

SMS requires DLT (Distributed Ledger Technology) registration with an
Indian telecom operator plus per-template approval. Can take weeks and
costs ₹0 only at negligible volumes. Not in the 0-rupee demo path — the
app has a stub in `src/app/api/cron/send-reminders/route.ts` that logs
instead of sending.

When ready, wire any Indian SMS gateway (Gupshup, MSG91, Textlocal) into
the `SMS` branch of the cron. Their APIs are near-identical to the
WhatsApp Cloud API shape.

---

## Summary

| Channel | Setup | Cost | Automation |
|---|---|---|---|
| Email | 2 min Resend signup | ₹0 up to 3k/mo | Fully automated via cron |
| WhatsApp (click-to-chat) | 0 min | ₹0 unlimited | Staff clicks once per send |
| WhatsApp (Meta API) | 20 min + template approval | ₹0 up to 1k conv/mo | Fully automated |
| SMS | DLT registration + weeks | Near-₹0 at low volume | Stubbed; wire when ready |
