-- Invoice generation from inside CredFloat.
-- Extends Invoice with origin + GST fields; adds InvoiceLineItem +
-- InvoiceItemTemplate. Existing rows keep origin='TALLY' (default).
-- Also adds GSTIN + address fields to ClientCompany and Party for
-- auto-fill during invoice creation.

CREATE TYPE "InvoiceOrigin" AS ENUM ('TALLY', 'CREDFLOAT');

ALTER TABLE "ClientCompany"
  ADD COLUMN "gstin"                 TEXT,
  ADD COLUMN "defaultPlaceOfSupply"  TEXT,
  ADD COLUMN "addressLine1"          TEXT,
  ADD COLUMN "addressLine2"          TEXT,
  ADD COLUMN "city"                  TEXT,
  ADD COLUMN "stateName"             TEXT,
  ADD COLUMN "pincode"               TEXT;

ALTER TABLE "Party"
  ADD COLUMN "gstin"     TEXT,
  ADD COLUMN "stateName" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN "origin"         "InvoiceOrigin" NOT NULL DEFAULT 'TALLY',
  ADD COLUMN "supplierGstin"  TEXT,
  ADD COLUMN "recipientGstin" TEXT,
  ADD COLUMN "placeOfSupply"  TEXT,
  ADD COLUMN "taxableAmount"  DECIMAL(15,2),
  ADD COLUMN "cgstAmount"     DECIMAL(15,2),
  ADD COLUMN "sgstAmount"     DECIMAL(15,2),
  ADD COLUMN "igstAmount"     DECIMAL(15,2),
  ADD COLUMN "notes"          TEXT;

CREATE INDEX "Invoice_origin_idx" ON "Invoice"("origin");

-- Line items on generated invoices
CREATE TABLE "InvoiceLineItem" (
  "id"             TEXT NOT NULL,
  "invoiceId"      TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "hsnSac"         TEXT,
  "quantity"       DECIMAL(12,2) NOT NULL DEFAULT 1,
  "rate"           DECIMAL(15,2) NOT NULL,
  "gstRate"        DECIMAL(5,2)  NOT NULL DEFAULT 18,
  "taxableAmount"  DECIMAL(15,2) NOT NULL,
  "taxAmount"      DECIMAL(15,2) NOT NULL,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

ALTER TABLE "InvoiceLineItem"
  ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Saved line-item presets per client
CREATE TABLE "InvoiceItemTemplate" (
  "id"              TEXT NOT NULL,
  "clientCompanyId" TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "hsnSac"          TEXT,
  "rate"            DECIMAL(15,2) NOT NULL,
  "gstRate"         DECIMAL(5,2)  NOT NULL DEFAULT 18,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceItemTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceItemTemplate_clientCompanyId_idx"
  ON "InvoiceItemTemplate"("clientCompanyId");

ALTER TABLE "InvoiceItemTemplate"
  ADD CONSTRAINT "InvoiceItemTemplate_clientCompanyId_fkey"
  FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceItemTemplate" ENABLE ROW LEVEL SECURITY;
