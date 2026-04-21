-- Ledger-statement PDF attached to reminders.
-- Adds letterhead fields on Firm, period-selection fields on ReminderRule,
-- and a LedgerPeriodType enum. All additive, safe on live traffic.

-- 1. Firm letterhead fields.
ALTER TABLE "Firm"
  ADD COLUMN IF NOT EXISTS "frn" TEXT,
  ADD COLUMN IF NOT EXISTS "partnerName" TEXT,
  ADD COLUMN IF NOT EXISTS "partnerMno" TEXT;

-- 2. LedgerPeriodType enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LedgerPeriodType') THEN
    CREATE TYPE "LedgerPeriodType" AS ENUM (
      'FY_TO_DATE',
      'LAST_12_MONTHS',
      'OPEN_ITEMS_ONLY',
      'ALL_HISTORY',
      'CUSTOM'
    );
  END IF;
END
$$;

-- 3. ReminderRule: attach-ledger toggle + period config.
ALTER TABLE "ReminderRule"
  ADD COLUMN IF NOT EXISTS "attachLedger" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "ledgerPeriodType" "LedgerPeriodType" NOT NULL DEFAULT 'FY_TO_DATE',
  ADD COLUMN IF NOT EXISTS "ledgerPeriodStart" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ledgerPeriodEnd" TIMESTAMP(3);
