-- Drop the sharePin column — PIN-gated share was a misread ask; never
-- used by any code path. Keeping schema and DB aligned.

ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "sharePin";
