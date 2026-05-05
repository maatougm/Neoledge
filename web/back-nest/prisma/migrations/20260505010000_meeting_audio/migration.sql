-- Store audio recording metadata for live meetings so the validation team
-- can re-listen to the conversation. The actual file lives on disk under
-- uploads/meetings/<projectId>/<filename>.
ALTER TABLE "MeetingTranscripts" ADD COLUMN IF NOT EXISTS "audioPath"     VARCHAR(500);
ALTER TABLE "MeetingTranscripts" ADD COLUMN IF NOT EXISTS "audioMimeType" VARCHAR(80);
ALTER TABLE "MeetingTranscripts" ADD COLUMN IF NOT EXISTS "audioSize"     INTEGER;
