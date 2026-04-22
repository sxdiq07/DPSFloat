-- Lock down Supabase PostgREST exposure.
--
-- Supabase exposes every public-schema table via PostgREST (the anon /
-- service_role REST API). Our app never uses that path — all queries
-- flow through Prisma against the direct Postgres connection as the
-- DB owner role, which BYPASSES RLS by default.
--
-- Enabling RLS with no policies:
--   * blocks anon / authenticated PostgREST reads and writes completely
--   * does NOT affect our Prisma app traffic (owner role bypasses RLS)
--
-- This clears all 17 "rls_disabled_in_public" ERROR lints from Supabase
-- and is the recommended hardening when PostgREST is not in use.

ALTER TABLE "Firm"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FirmStaff"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientCompany"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Party"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Receipt"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReceiptAllocation"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderRule"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReminderSent"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromiseToPay"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedView"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortalToken"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LedgerEntry"        ENABLE ROW LEVEL SECURITY;
