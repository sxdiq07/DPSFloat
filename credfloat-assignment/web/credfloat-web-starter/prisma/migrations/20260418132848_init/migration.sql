-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PARTNER', 'STAFF');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'DISPUTED');

-- CreateEnum
CREATE TYPE "AgeBucket" AS ENUM ('CURRENT', 'DAYS_0_30', 'DAYS_30_60', 'DAYS_60_90', 'DAYS_90_PLUS');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED', 'BOUNCED');

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirmStaff" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientCompany" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "tallyCompanyName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "tallyLedgerName" TEXT NOT NULL,
    "parentGroup" TEXT NOT NULL,
    "mailingName" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsappNumber" TEXT,
    "contactVerified" BOOLEAN NOT NULL DEFAULT false,
    "closingBalance" DECIMAL(15,2) NOT NULL,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optedOutReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "billRef" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "originalAmount" DECIMAL(15,2) NOT NULL,
    "outstandingAmount" DECIMAL(15,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "ageBucket" "AgeBucket" NOT NULL DEFAULT 'CURRENT',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "voucherRef" TEXT NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "clientCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerDays" INTEGER[],
    "channels" "Channel"[],
    "emailTemplate" TEXT,
    "smsTemplate" TEXT,
    "whatsappTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderSent" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerId" TEXT,
    "status" "SendStatus" NOT NULL DEFAULT 'SENT',
    "error" TEXT,

    CONSTRAINT "ReminderSent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FirmStaff_email_key" ON "FirmStaff"("email");

-- CreateIndex
CREATE INDEX "FirmStaff_firmId_idx" ON "FirmStaff"("firmId");

-- CreateIndex
CREATE INDEX "ClientCompany_firmId_idx" ON "ClientCompany"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCompany_firmId_tallyCompanyName_key" ON "ClientCompany"("firmId", "tallyCompanyName");

-- CreateIndex
CREATE INDEX "Party_clientCompanyId_idx" ON "Party"("clientCompanyId");

-- CreateIndex
CREATE INDEX "Party_optedOut_idx" ON "Party"("optedOut");

-- CreateIndex
CREATE UNIQUE INDEX "Party_clientCompanyId_tallyLedgerName_key" ON "Party"("clientCompanyId", "tallyLedgerName");

-- CreateIndex
CREATE INDEX "Invoice_clientCompanyId_status_idx" ON "Invoice"("clientCompanyId", "status");

-- CreateIndex
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");

-- CreateIndex
CREATE INDEX "Invoice_ageBucket_idx" ON "Invoice"("ageBucket");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clientCompanyId_partyId_billRef_key" ON "Invoice"("clientCompanyId", "partyId", "billRef");

-- CreateIndex
CREATE INDEX "Receipt_partyId_idx" ON "Receipt"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_clientCompanyId_voucherRef_key" ON "Receipt"("clientCompanyId", "voucherRef");

-- CreateIndex
CREATE INDEX "ReminderRule_clientCompanyId_idx" ON "ReminderRule"("clientCompanyId");

-- CreateIndex
CREATE INDEX "ReminderSent_partyId_idx" ON "ReminderSent"("partyId");

-- CreateIndex
CREATE INDEX "ReminderSent_invoiceId_idx" ON "ReminderSent"("invoiceId");

-- CreateIndex
CREATE INDEX "ReminderSent_sentAt_idx" ON "ReminderSent"("sentAt");

-- AddForeignKey
ALTER TABLE "FirmStaff" ADD CONSTRAINT "FirmStaff_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCompany" ADD CONSTRAINT "ClientCompany_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_clientCompanyId_fkey" FOREIGN KEY ("clientCompanyId") REFERENCES "ClientCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderSent" ADD CONSTRAINT "ReminderSent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
