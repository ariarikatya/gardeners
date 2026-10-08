-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientPushLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "event" TEXT NOT NULL,
    "clientVersion" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientPushLog_userId_idx" ON "ClientPushLog"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClientPushLog_createdAt_idx" ON "ClientPushLog"("createdAt");
