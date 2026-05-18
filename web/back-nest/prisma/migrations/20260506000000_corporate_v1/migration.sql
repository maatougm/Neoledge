-- Corporate-readiness Tier 1: cahier versioning, AI usage tracking,
-- audio retention preserve flag.

-- ── Cahier versions ──────────────────────────────────────────────────────
CREATE TABLE "CahierVersions" (
    "id"          TEXT          NOT NULL,
    "projectId"   TEXT          NOT NULL,
    "version"     INTEGER       NOT NULL,
    "kind"        VARCHAR(20)   NOT NULL,
    "aiContent"   TEXT          NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "CahierVersions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CahierVersions_projectId_version_key"
    ON "CahierVersions"("projectId", "version");
CREATE INDEX "CahierVersions_projectId_createdAt_idx"
    ON "CahierVersions"("projectId", "createdAt");
ALTER TABLE "CahierVersions"
    ADD CONSTRAINT "CahierVersions_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CahierVersions"
    ADD CONSTRAINT "CahierVersions_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "AppUsers"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── AI usage ─────────────────────────────────────────────────────────────
CREATE TABLE "AiUsages" (
    "id"               TEXT          NOT NULL,
    "projectId"        TEXT,
    "userId"           TEXT,
    "provider"         VARCHAR(40)   NOT NULL,
    "model"            VARCHAR(80)   NOT NULL,
    "feature"          VARCHAR(40)   NOT NULL,
    "promptTokens"     INTEGER       NOT NULL DEFAULT 0,
    "completionTokens" INTEGER       NOT NULL DEFAULT 0,
    "totalTokens"      INTEGER       NOT NULL DEFAULT 0,
    "audioSeconds"     INTEGER       NOT NULL DEFAULT 0,
    "costEstimateUsd"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs"       INTEGER       NOT NULL DEFAULT 0,
    "success"          BOOLEAN       NOT NULL DEFAULT true,
    "errorMessage"     VARCHAR(500),
    "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiUsages_projectId_createdAt_idx" ON "AiUsages"("projectId", "createdAt");
CREATE INDEX "AiUsages_feature_createdAt_idx"   ON "AiUsages"("feature", "createdAt");
CREATE INDEX "AiUsages_createdAt_idx"            ON "AiUsages"("createdAt");
ALTER TABLE "AiUsages"
    ADD CONSTRAINT "AiUsages_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Projects"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "AiUsages"
    ADD CONSTRAINT "AiUsages_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AppUsers"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

-- ── Audio retention preserve flag ────────────────────────────────────────
ALTER TABLE "MeetingTranscripts"
    ADD COLUMN IF NOT EXISTS "audioPreserved" BOOLEAN NOT NULL DEFAULT false;
