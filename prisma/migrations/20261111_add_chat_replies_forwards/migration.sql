ALTER TABLE "ChatMessage"
ADD COLUMN "replyToMessageId" TEXT,
ADD COLUMN "forwardedFromMessageId" TEXT,
ADD COLUMN "forwardedFromUserId" TEXT;

CREATE INDEX "ChatMessage_replyToMessageId_idx" ON "ChatMessage"("replyToMessageId");
CREATE INDEX "ChatMessage_forwardedFromMessageId_idx" ON "ChatMessage"("forwardedFromMessageId");
CREATE INDEX "ChatMessage_forwardedFromUserId_idx" ON "ChatMessage"("forwardedFromUserId");

ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_replyToMessageId_fkey"
FOREIGN KEY ("replyToMessageId") REFERENCES "ChatMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_forwardedFromMessageId_fkey"
FOREIGN KEY ("forwardedFromMessageId") REFERENCES "ChatMessage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ChatMessage"
ADD CONSTRAINT "ChatMessage_forwardedFromUserId_fkey"
FOREIGN KEY ("forwardedFromUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
