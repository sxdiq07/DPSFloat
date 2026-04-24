-- Tally-style Tax Invoice extras + PIN-gated share links.
-- All fields optional so existing rows stay valid.

ALTER TABLE "Invoice"
  ADD COLUMN "supplierPan"       TEXT,
  ADD COLUMN "consigneeName"     TEXT,
  ADD COLUMN "consigneeAddress"  TEXT,
  ADD COLUMN "deliveryNote"      TEXT,
  ADD COLUMN "modeOfPayment"     TEXT,
  ADD COLUMN "buyerOrderRef"     TEXT,
  ADD COLUMN "buyerOrderDate"    TIMESTAMP(3),
  ADD COLUMN "dispatchDocNo"     TEXT,
  ADD COLUMN "dispatchThrough"   TEXT,
  ADD COLUMN "destination"       TEXT,
  ADD COLUMN "termsOfDelivery"   TEXT;

ALTER TABLE "InvoiceLineItem" ADD COLUMN "unit" TEXT;
