-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "relevanceScore" INTEGER;

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "topicPreference" TEXT DEFAULT 'Cualquier mensaje respetuoso.';
