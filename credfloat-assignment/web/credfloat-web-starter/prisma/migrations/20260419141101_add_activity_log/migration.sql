-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_firmId_createdAt_idx" ON "ActivityLog"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_targetType_targetId_idx" ON "ActivityLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_idx" ON "ActivityLog"("actorId");
