-- Soft-delete: Party and Invoice keep a deletedAt timestamp instead
-- of being hard-removed. Tally reconciliation paths still see the
-- rows; app-facing read queries filter deletedAt IS NULL.

ALTER TABLE "Party"   ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Party_deletedAt_idx"   ON "Party"("deletedAt");
CREATE INDEX "Invoice_deletedAt_idx" ON "Invoice"("deletedAt");
