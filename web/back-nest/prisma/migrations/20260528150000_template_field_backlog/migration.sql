-- Add backlog-driver support to project template fields so templates can flag
-- which fields feed the AI cahier/backlog generation (mirrors ProjectField).
ALTER TABLE "ProjectTemplateFields" ADD COLUMN "isBacklogDriver" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectTemplateFields" ADD COLUMN "backlogHint" VARCHAR(500);
