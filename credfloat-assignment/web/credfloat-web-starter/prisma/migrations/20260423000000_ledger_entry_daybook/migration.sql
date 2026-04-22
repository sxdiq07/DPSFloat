-- Full Tally Day Book sync: LedgerEntry table + opening balance on Party.
-- Additive. Safe on live traffic.

-- 1. Party.openingBalance (carried forward from prior FY per Tally).
ALTER TABLE "Party"
  ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- 2. VoucherType enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VoucherType') THEN
    CREATE TYPE "VoucherType" AS ENUM (
      'SALES',
      'PURCHASE',
      'RECEIPT',
      'PAYMENT',
      'JOURNAL',
      'CONTRA',
      'CREDIT_NOTE',
      'DEBIT_NOTE',
      'STOCK_JOURNAL',
      'OTHER'
    );
  END IF;
END
$$;

-- 3. LedgerEntry — one row per (voucher × debtor line).
CREATE TABLE IF NOT EXISTS "LedgerEntry" (
  "id"              TEXT PRIMARY KEY,
  "partyId"         TEXT NOT NULL,
  "clientCompanyId" TEXT NOT NULL,
  "voucherDate"     TIMESTAMP(3) NOT NULL,
  "voucherType"     "VoucherType" NOT NULL,
  "voucherRef"      TEXT NOT NULL,
  "counterparty"    TEXT NOT NULL DEFAULT '',
  "narration"       TEXT,
  "debit"           DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "credit"          DECIMAL(15, 2) NOT NULL DEFAULT 0,
  "lastSyncedAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_partyId_fkey"
    FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE,
  CONSTRAINT "LedgerEntry_clientCompanyId_fkey"
    FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE
);

-- `counterparty` is part of the uniqueness key because a single voucher
-- can touch the same debtor multiple times (split bills) with different
-- counterparty ledgers. counterparty is NOT NULL (default '') so the
-- composite key dedupes cleanly.
CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_dedup_key"
  ON "LedgerEntry" (
    "clientCompanyId",
    "voucherRef",
    "voucherType",
    "partyId",
    "counterparty"
  );

CREATE INDEX IF NOT EXISTS "LedgerEntry_partyId_voucherDate_idx"
  ON "LedgerEntry" ("partyId", "voucherDate");

CREATE INDEX IF NOT EXISTS "LedgerEntry_clientCompanyId_voucherDate_idx"
  ON "LedgerEntry" ("clientCompanyId", "voucherDate");

CREATE INDEX IF NOT EXISTS "LedgerEntry_voucherType_idx"
  ON "LedgerEntry" ("voucherType");
