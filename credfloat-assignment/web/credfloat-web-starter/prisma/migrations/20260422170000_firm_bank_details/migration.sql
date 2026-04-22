-- Firm bank + UPI fields for in-email "pay us" section.
ALTER TABLE "Firm"
  ADD COLUMN IF NOT EXISTS "bankName"            TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountName"     TEXT,
  ADD COLUMN IF NOT EXISTS "bankAccountNumber"   TEXT,
  ADD COLUMN IF NOT EXISTS "bankIfsc"            TEXT,
  ADD COLUMN IF NOT EXISTS "upiId"               TEXT;
