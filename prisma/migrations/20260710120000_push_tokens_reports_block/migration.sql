-- Push tokens de la app nativa (Expo)
CREATE TABLE "CreatorPushToken" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorPushToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreatorPushToken_token_key" ON "CreatorPushToken"("token");
CREATE INDEX "CreatorPushToken_creatorId_idx" ON "CreatorPushToken"("creatorId");
ALTER TABLE "CreatorPushToken" ADD CONSTRAINT "CreatorPushToken_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reportes de contenido (moderación)
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT,
    "creatorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Report_creatorId_idx" ON "Report"("creatorId");

-- Bloqueo del anónimo por chat
ALTER TABLE "Chat" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
