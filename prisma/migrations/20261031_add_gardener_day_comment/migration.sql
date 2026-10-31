-- CreateTable
CREATE TABLE IF NOT EXISTS "GardenerDayComment" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "gardenerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GardenerDayComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GardenerDayComment_date_gardenerId_key" ON "GardenerDayComment"("date", "gardenerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GardenerDayComment_gardenerId_idx" ON "GardenerDayComment"("gardenerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GardenerDayComment_date_idx" ON "GardenerDayComment"("date");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'GardenerDayComment_gardenerId_fkey'
    ) THEN
        ALTER TABLE "GardenerDayComment" ADD CONSTRAINT "GardenerDayComment_gardenerId_fkey" FOREIGN KEY ("gardenerId") REFERENCES "Gardener"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
