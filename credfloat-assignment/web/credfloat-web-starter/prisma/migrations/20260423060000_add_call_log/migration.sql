-- CallLog: one row per IVR call triggered via Twilio Studio.

CREATE TYPE "CallStatus" AS ENUM (
  'QUEUED', 'INITIATED', 'RINGING', 'IN_PROGRESS',
  'COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELLED'
);

CREATE TABLE "CallLog" (
  "id"            TEXT NOT NULL,
  "partyId"       TEXT NOT NULL,
  "invoiceId"     TEXT,
  "initiatedBy"   TEXT NOT NULL,
  "toNumber"      TEXT NOT NULL,
  "executionSid"  TEXT,
  "callSid"       TEXT,
  "status"        "CallStatus" NOT NULL DEFAULT 'QUEUED',
  "dtmfResponse"  TEXT,
  "durationSec"   INTEGER,
  "error"         TEXT,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "answeredAt"    TIMESTAMP(3),
  "endedAt"       TIMESTAMP(3),
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallLog_executionSid_key" ON "CallLog"("executionSid");
CREATE INDEX "CallLog_partyId_idx"    ON "CallLog"("partyId");
CREATE INDEX "CallLog_invoiceId_idx"  ON "CallLog"("invoiceId");
CREATE INDEX "CallLog_startedAt_idx" ON "CallLog"("startedAt");
CREATE INDEX "CallLog_status_idx"    ON "CallLog"("status");

ALTER TABLE "CallLog"
  ADD CONSTRAINT "CallLog_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallLog"
  ADD CONSTRAINT "CallLog_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CallLog"
  ADD CONSTRAINT "CallLog_initiatedBy_fkey"
  FOREIGN KEY ("initiatedBy") REFERENCES "FirmStaff"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CallLog" ENABLE ROW LEVEL SECURITY;
