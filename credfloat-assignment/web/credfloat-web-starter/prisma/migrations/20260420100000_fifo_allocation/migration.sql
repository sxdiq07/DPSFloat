-- FIFO/bill-wise allocation engine support.
-- Adds: Party.advanceAmount, AllocationSource enum, ReceiptAllocation table.
-- Safe to run while traffic is live — only ADD COLUMN / CREATE TABLE.

-- 1. Party.advanceAmount — net unallocated receipts (excess payments).
ALTER TABLE "Party"
  ADD COLUMN IF NOT EXISTS "advanceAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- 2. Allocation source enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AllocationSource') THEN
    CREATE TYPE "AllocationSource" AS ENUM (
      'TALLY_BILLWISE',
      'FIFO_DERIVED',
      'MANUAL'
    );
  END IF;
END
$$;

-- 3. ReceiptAllocation — one row per (receipt, invoice) pair.
CREATE TABLE IF NOT EXISTS "ReceiptAllocation" (
  "id"          TEXT PRIMARY KEY,
  "receiptId"   TEXT NOT NULL,
  "invoiceId"   TEXT NOT NULL,
  "amount"      DECIMAL(15,2) NOT NULL,
  "source"      "AllocationSource" NOT NULL,
  "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReceiptAllocation_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE,
  CONSTRAINT "ReceiptAllocation_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReceiptAllocation_receiptId_invoiceId_key"
  ON "ReceiptAllocation" ("receiptId", "invoiceId");

CREATE INDEX IF NOT EXISTS "ReceiptAllocation_receiptId_idx"
  ON "ReceiptAllocation" ("receiptId");

CREATE INDEX IF NOT EXISTS "ReceiptAllocation_invoiceId_idx"
  ON "ReceiptAllocation" ("invoiceId");

CREATE INDEX IF NOT EXISTS "ReceiptAllocation_source_idx"
  ON "ReceiptAllocation" ("source");
