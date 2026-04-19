-- Partial unique index: one successful reminder per (invoice, channel, day).
-- FAILED and BOUNCED statuses excluded so a failed attempt can legitimately
-- be retried. sentAt is TIMESTAMP (not timestamptz), so the ::date cast is
-- IMMUTABLE — allowed in an index expression.
CREATE UNIQUE INDEX IF NOT EXISTS "ReminderSent_invoice_channel_day_success_unique"
ON "ReminderSent" ("invoiceId", "channel", (("sentAt")::date))
WHERE "status" IN ('SENT', 'DELIVERED', 'READ');

-- Helper index for the app-level dedup read path
CREATE INDEX IF NOT EXISTS "ReminderSent_invoiceId_channel_sentAt_idx"
ON "ReminderSent" ("invoiceId", "channel", "sentAt" DESC);
