-- Real-time meeting copilot — suggestion cards proposed during a live
-- meeting. `liveSessionId` is a frontend-generated UUID for the active
-- session; `meetingTranscriptId` is null until the live session is saved
-- as a `MeetingTranscript`. `forNextMeeting` flags cards produced
-- post-hoc against an uploaded audio (they live as follow-ups, not as
-- recommendations for the analyzed meeting itself).

CREATE TABLE "LiveMeetingSuggestions" (
    "id"                  TEXT NOT NULL,
    "projectId"           TEXT NOT NULL,
    "liveSessionId"       VARCHAR(80) NOT NULL,
    "meetingTranscriptId" TEXT,
    "question"            TEXT NOT NULL,
    "rationale"           TEXT NOT NULL,
    "urgency"             VARCHAR(10) NOT NULL DEFAULT 'medium',
    "section"             VARCHAR(50) NOT NULL,
    "status"              VARCHAR(20) NOT NULL DEFAULT 'pending',
    "forNextMeeting"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveMeetingSuggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveMeetingSuggestions_projectId_liveSessionId_status_idx"
    ON "LiveMeetingSuggestions"("projectId", "liveSessionId", "status");

CREATE INDEX "LiveMeetingSuggestions_meetingTranscriptId_idx"
    ON "LiveMeetingSuggestions"("meetingTranscriptId");

ALTER TABLE "LiveMeetingSuggestions"
    ADD CONSTRAINT "LiveMeetingSuggestions_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LiveMeetingSuggestions"
    ADD CONSTRAINT "LiveMeetingSuggestions_meetingTranscriptId_fkey"
    FOREIGN KEY ("meetingTranscriptId") REFERENCES "MeetingTranscripts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
