ALTER TABLE "User"
ADD COLUMN "lastActive" TIMESTAMP(3);

ALTER TABLE "ChatMessage"
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "isDeleted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ChatMessage_isDeleted_idx" ON "ChatMessage"("isDeleted");

CREATE TABLE "ChatMessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessageRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatMessageRead_messageId_userId_key" ON "ChatMessageRead"("messageId", "userId");
CREATE INDEX "ChatMessageRead_messageId_readAt_idx" ON "ChatMessageRead"("messageId", "readAt");
CREATE INDEX "ChatMessageRead_userId_readAt_idx" ON "ChatMessageRead"("userId", "readAt");

ALTER TABLE "ChatMessageRead"
ADD CONSTRAINT "ChatMessageRead_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessageRead"
ADD CONSTRAINT "ChatMessageRead_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing cursors do not retain read timestamps; message creation is a conservative fallback.
INSERT INTO "ChatMessageRead" ("id", "messageId", "userId", "readAt")
SELECT
    md5(message."id" || ':' || participant."userId"),
    message."id",
    participant."userId",
    message."createdAt"
FROM "ChatMessage" AS message
JOIN "ChatParticipant" AS participant ON participant."chatId" = message."chatId"
WHERE participant."userId" <> message."senderId"
  AND participant."lastReadAt" IS NOT NULL
  AND participant."lastReadAt" >= message."createdAt";
