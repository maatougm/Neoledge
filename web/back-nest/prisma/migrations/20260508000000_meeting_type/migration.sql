-- Meeting type — drives copilot prompt selection and downstream
-- transcript-analysis tone. Nullable; existing rows stay null.

ALTER TABLE "MeetingTranscripts"
  ADD COLUMN "meetingType" VARCHAR(20);
