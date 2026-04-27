-- CreateTable
CREATE TABLE "Teams" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "managerUserId" VARCHAR(36),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppUsers" (
    "id" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(256) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" VARCHAR(50) NOT NULL DEFAULT 'Member',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "avatarPath" VARCHAR(500),
    "jobTitle" VARCHAR(100),
    "phoneNumber" VARCHAR(50),
    "department" VARCHAR(100),
    "preferences" TEXT,
    "totpSecret" VARCHAR(100),
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpVerifiedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "teamId" VARCHAR(36),
    "passwordResetToken" VARCHAR(255),
    "passwordResetTokenExpiry" TIMESTAMP(3),

    CONSTRAINT "AppUsers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permissions" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roles" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissions" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRoleAssignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRoleAssignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projects" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "clientName" VARCHAR(200) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "projectManagerId" TEXT NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Draft',
    "priority" VARCHAR(50) NOT NULL DEFAULT 'Medium',
    "allowManagerCustomFields" BOOLEAN NOT NULL DEFAULT false,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aiOutput" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "tags" VARCHAR(500),
    "budget" DECIMAL(65,30),
    "currentPhaseEnteredAt" TIMESTAMP(3),

    CONSTRAINT "Projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFields" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "fieldType" VARCHAR(50) NOT NULL DEFAULT 'Text',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" VARCHAR(500),
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "fieldCategory" VARCHAR(50) NOT NULL DEFAULT 'Dynamic',
    "options" TEXT,
    "isBacklogDriver" BOOLEAN NOT NULL DEFAULT false,
    "backlogHint" VARCHAR(500),

    CONSTRAINT "ProjectFields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFieldValues" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectFieldId" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3),
    "updatedBy" VARCHAR(36),

    CONSTRAINT "ProjectFieldValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectValidations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "validatedByUserId" TEXT NOT NULL,
    "validatedByRole" VARCHAR(50) NOT NULL,
    "phase" VARCHAR(50) NOT NULL,
    "isApproved" BOOLEAN NOT NULL,
    "comment" TEXT,
    "validatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectValidations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectActivities" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "action" VARCHAR(100) NOT NULL,
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplateFields" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'Custom',
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "options" TEXT,

    CONSTRAINT "ProjectTemplateFields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectComments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "parentCommentId" TEXT,
    "mentions" VARCHAR(500),

    CONSTRAINT "ProjectComments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAttachments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileExtension" VARCHAR(20) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "storagePath" VARCHAR(500) NOT NULL,
    "description" VARCHAR(500),
    "category" VARCHAR(50) NOT NULL DEFAULT 'Document',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProjectAttachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingTranscripts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "originalFileName" VARCHAR(500),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "detectedLanguages" VARCHAR(50) NOT NULL DEFAULT '',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiSummary" TEXT,
    "aiStatus" VARCHAR(20) NOT NULL DEFAULT 'none',
    "aiStartedAt" TIMESTAMP(3),
    "aiProcessedAt" TIMESTAMP(3),
    "aiModel" VARCHAR(50),
    "aiError" VARCHAR(500),

    CONSTRAINT "MeetingTranscripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItems" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assigneeName" VARCHAR(200),
    "dueDate" TIMESTAMP(3),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingActionItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecisions" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" VARCHAR(50) NOT NULL DEFAULT 'decision',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingDecisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegments" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "speaker" VARCHAR(100) NOT NULL DEFAULT 'Unknown',
    "text" TEXT NOT NULL DEFAULT '',
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "TranscriptSegments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "projectId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(40) NOT NULL DEFAULT 'system',
    "entityType" VARCHAR(40),
    "entityId" TEXT,
    "actorId" TEXT,
    "link" VARCHAR(500),

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseChecklists" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phase" VARCHAR(50) NOT NULL,
    "label" VARCHAR(300) NOT NULL,
    "isChecked" BOOLEAN NOT NULL DEFAULT false,
    "checkedBy" TEXT,
    "checkedAt" TIMESTAMP(3),
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhaseChecklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogs" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" VARCHAR(36) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "userId" TEXT,
    "changes" TEXT,
    "metadata" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsCache" (
    "id" TEXT NOT NULL,
    "cacheKey" VARCHAR(100) NOT NULL,
    "data" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "triggerEvent" VARCHAR(100) NOT NULL,
    "triggerCondition" TEXT,
    "actionType" VARCHAR(100) NOT NULL,
    "actionConfig" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationLog" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "detail" VARCHAR(500),
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Boards" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'Kanban',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardColumns" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "wipLimit" INTEGER,
    "mapStatus" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardColumns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sprints" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "goal" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Planning',
    "capacity" DECIMAL(8,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Versions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "status" VARCHAR(20) NOT NULL DEFAULT 'Open',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(20) NOT NULL DEFAULT 'Task',
    "status" VARCHAR(20) NOT NULL DEFAULT 'New',
    "priority" VARCHAR(20) NOT NULL DEFAULT 'Normal',
    "assigneeId" TEXT,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "sprintId" TEXT,
    "versionId" TEXT,
    "boardColumnId" TEXT,
    "startDate" DATE,
    "dueDate" DATE,
    "estimatedHours" DECIMAL(8,2),
    "spentHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "percentDone" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ackedAt" TIMESTAMP(3),
    "ackedByUserId" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalatedToUserId" TEXT,
    "slaDeadline" TIMESTAMP(3),
    "slaKind" VARCHAR(20),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "aiGeneratedFrom" VARCHAR(100),

    CONSTRAINT "WorkPackages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageDependencies" (
    "id" TEXT NOT NULL,
    "fromWpId" TEXT NOT NULL,
    "toWpId" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'relates',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPackageDependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageWatchers" (
    "id" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPackageWatchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageCustomFields" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "fieldType" VARCHAR(32) NOT NULL DEFAULT 'text',
    "options" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPackageCustomFields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageCustomValues" (
    "id" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPackageCustomValues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "isReached" BOOLEAN NOT NULL DEFAULT false,
    "color" VARCHAR(16),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GanttBaselines" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotName" VARCHAR(120) NOT NULL,
    "startDate" DATE,
    "dueDate" DATE,
    "estimatedHours" DECIMAL(8,2),
    "percentDone" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "GanttBaselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workPackageId" TEXT,
    "hours" DECIMAL(6,2) NOT NULL,
    "spentOn" DATE NOT NULL,
    "activity" VARCHAR(32) NOT NULL DEFAULT 'development',
    "comment" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyRates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "rate" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'EUR',
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HourlyRates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBudgets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "laborBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "materialBudget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'EUR',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBudgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLineItems" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'material',
    "kind" VARCHAR(16) NOT NULL DEFAULT 'actual',
    "unitCost" DECIMAL(14,2) NOT NULL,
    "units" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLineItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiPages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WikiPages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WikiRevisions" (
    "id" TEXT NOT NULL,
    "wikiPageId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiRevisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolios" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioProjects" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioProjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAgendaItems" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "duration" INTEGER,
    "responsibleId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAgendaItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendees" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "externalName" VARCHAR(200),
    "externalEmail" VARCHAR(200),
    "isPresent" BOOLEAN NOT NULL DEFAULT false,
    "role" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAttendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingOutcomes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'Note',
    "description" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueDate" DATE,
    "workPackageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingOutcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageComments" (
    "id" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkPackageComments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPackageAttachments" (
    "id" TEXT NOT NULL,
    "workPackageId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "storagePath" VARCHAR(500) NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkPackageAttachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityRacis" (
    "id" SERIAL NOT NULL,
    "phase" VARCHAR(100) NOT NULL,
    "activityCode" VARCHAR(100) NOT NULL,
    "activityLabel" VARCHAR(500) NOT NULL,
    "responsibleTeamCode" VARCHAR(500) NOT NULL,
    "approverTeamCode" VARCHAR(500) NOT NULL,
    "consultedTeams" VARCHAR(500) NOT NULL DEFAULT '',
    "informedTeams" VARCHAR(500) NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ActivityRacis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Handovers" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromTeamCode" VARCHAR(50) NOT NULL,
    "toTeamCode" VARCHAR(50) NOT NULL,
    "phase" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'Draft',
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" VARCHAR(36),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CahierFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'rejected',
    "comment" TEXT NOT NULL,
    "section" VARCHAR(100),
    "aiModel" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CahierFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoverCriteria" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneByUserId" VARCHAR(36),
    "evidenceUrl" VARCHAR(1000),

    CONSTRAINT "HandoverCriteria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Teams_code_key" ON "Teams"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AppUsers_email_key" ON "AppUsers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Permissions_key_key" ON "Permissions"("key");

-- CreateIndex
CREATE INDEX "Permissions_resource_idx" ON "Permissions"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "Roles_name_key" ON "Roles"("name");

-- CreateIndex
CREATE INDEX "RolePermissions_permissionId_idx" ON "RolePermissions"("permissionId");

-- CreateIndex
CREATE INDEX "UserRoleAssignments_roleId_idx" ON "UserRoleAssignments"("roleId");

-- CreateIndex
CREATE INDEX "UserRoleAssignments_projectId_idx" ON "UserRoleAssignments"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRoleAssignments_userId_roleId_projectId_key" ON "UserRoleAssignments"("userId", "roleId", "projectId");

-- CreateIndex
CREATE INDEX "Projects_status_idx" ON "Projects"("status");

-- CreateIndex
CREATE INDEX "Projects_projectManagerId_idx" ON "Projects"("projectManagerId");

-- CreateIndex
CREATE INDEX "Projects_isDeleted_idx" ON "Projects"("isDeleted");

-- CreateIndex
CREATE INDEX "Projects_priority_idx" ON "Projects"("priority");

-- CreateIndex
CREATE INDEX "Projects_createdAt_idx" ON "Projects"("createdAt");

-- CreateIndex
CREATE INDEX "Projects_isDeleted_status_idx" ON "Projects"("isDeleted", "status");

-- CreateIndex
CREATE INDEX "ProjectFields_projectId_idx" ON "ProjectFields"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFieldValues_projectFieldId_idx" ON "ProjectFieldValues"("projectFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFieldValues_projectId_projectFieldId_key" ON "ProjectFieldValues"("projectId", "projectFieldId");

-- CreateIndex
CREATE INDEX "ProjectValidations_projectId_phase_idx" ON "ProjectValidations"("projectId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectValidations_projectId_validatedByUserId_phase_key" ON "ProjectValidations"("projectId", "validatedByUserId", "phase");

-- CreateIndex
CREATE INDEX "ProjectActivities_projectId_idx" ON "ProjectActivities"("projectId");

-- CreateIndex
CREATE INDEX "ProjectActivities_createdAt_idx" ON "ProjectActivities"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectTemplates_createdByAdminId_idx" ON "ProjectTemplates"("createdByAdminId");

-- CreateIndex
CREATE INDEX "ProjectTemplateFields_templateId_idx" ON "ProjectTemplateFields"("templateId");

-- CreateIndex
CREATE INDEX "ProjectComments_projectId_idx" ON "ProjectComments"("projectId");

-- CreateIndex
CREATE INDEX "ProjectComments_userId_idx" ON "ProjectComments"("userId");

-- CreateIndex
CREATE INDEX "ProjectComments_createdAt_idx" ON "ProjectComments"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectAttachments_projectId_idx" ON "ProjectAttachments"("projectId");

-- CreateIndex
CREATE INDEX "ProjectAttachments_uploadedByUserId_idx" ON "ProjectAttachments"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "ProjectAttachments_uploadedAt_idx" ON "ProjectAttachments"("uploadedAt");

-- CreateIndex
CREATE INDEX "ProjectAttachments_category_idx" ON "ProjectAttachments"("category");

-- CreateIndex
CREATE INDEX "MeetingTranscripts_projectId_idx" ON "MeetingTranscripts"("projectId");

-- CreateIndex
CREATE INDEX "MeetingTranscripts_createdAt_idx" ON "MeetingTranscripts"("createdAt");

-- CreateIndex
CREATE INDEX "MeetingTranscripts_aiStatus_idx" ON "MeetingTranscripts"("aiStatus");

-- CreateIndex
CREATE INDEX "MeetingActionItems_transcriptId_idx" ON "MeetingActionItems"("transcriptId");

-- CreateIndex
CREATE INDEX "MeetingDecisions_transcriptId_idx" ON "MeetingDecisions"("transcriptId");

-- CreateIndex
CREATE INDEX "TranscriptSegments_transcriptId_idx" ON "TranscriptSegments"("transcriptId");

-- CreateIndex
CREATE INDEX "Notifications_userId_isRead_createdAt_idx" ON "Notifications"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notifications_userId_isRead_idx" ON "Notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notifications_userId_createdAt_idx" ON "Notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notifications_entityType_entityId_idx" ON "Notifications"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Notifications_userId_reason_idx" ON "Notifications"("userId", "reason");

-- CreateIndex
CREATE INDEX "PhaseChecklists_projectId_phase_idx" ON "PhaseChecklists"("projectId", "phase");

-- CreateIndex
CREATE INDEX "AuditLogs_entityType_entityId_idx" ON "AuditLogs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLogs_userId_idx" ON "AuditLogs"("userId");

-- CreateIndex
CREATE INDEX "AuditLogs_createdAt_idx" ON "AuditLogs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsCache_cacheKey_key" ON "AnalyticsCache"("cacheKey");

-- CreateIndex
CREATE INDEX "AutomationRules_projectId_idx" ON "AutomationRules"("projectId");

-- CreateIndex
CREATE INDEX "AutomationRules_triggerEvent_idx" ON "AutomationRules"("triggerEvent");

-- CreateIndex
CREATE INDEX "AutomationLog_ruleId_idx" ON "AutomationLog"("ruleId");

-- CreateIndex
CREATE INDEX "AutomationLog_projectId_idx" ON "AutomationLog"("projectId");

-- CreateIndex
CREATE INDEX "AutomationLog_executedAt_idx" ON "AutomationLog"("executedAt");

-- CreateIndex
CREATE INDEX "Boards_projectId_idx" ON "Boards"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Boards_projectId_name_key" ON "Boards"("projectId", "name");

-- CreateIndex
CREATE INDEX "BoardColumns_boardId_position_idx" ON "BoardColumns"("boardId", "position");

-- CreateIndex
CREATE INDEX "Sprints_boardId_status_idx" ON "Sprints"("boardId", "status");

-- CreateIndex
CREATE INDEX "Versions_projectId_status_idx" ON "Versions"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Versions_projectId_name_key" ON "Versions"("projectId", "name");

-- CreateIndex
CREATE INDEX "WorkPackages_projectId_isDeleted_status_idx" ON "WorkPackages"("projectId", "isDeleted", "status");

-- CreateIndex
CREATE INDEX "WorkPackages_projectId_status_idx" ON "WorkPackages"("projectId", "status");

-- CreateIndex
CREATE INDEX "WorkPackages_assigneeId_isDeleted_idx" ON "WorkPackages"("assigneeId", "isDeleted");

-- CreateIndex
CREATE INDEX "WorkPackages_assigneeId_idx" ON "WorkPackages"("assigneeId");

-- CreateIndex
CREATE INDEX "WorkPackages_parentId_idx" ON "WorkPackages"("parentId");

-- CreateIndex
CREATE INDEX "WorkPackages_sprintId_idx" ON "WorkPackages"("sprintId");

-- CreateIndex
CREATE INDEX "WorkPackages_versionId_idx" ON "WorkPackages"("versionId");

-- CreateIndex
CREATE INDEX "WorkPackages_boardColumnId_idx" ON "WorkPackages"("boardColumnId");

-- CreateIndex
CREATE INDEX "WorkPackages_slaDeadline_slaBreached_idx" ON "WorkPackages"("slaDeadline", "slaBreached");

-- CreateIndex
CREATE INDEX "WorkPackageDependencies_toWpId_idx" ON "WorkPackageDependencies"("toWpId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackageDependencies_fromWpId_toWpId_type_key" ON "WorkPackageDependencies"("fromWpId", "toWpId", "type");

-- CreateIndex
CREATE INDEX "WorkPackageWatchers_userId_idx" ON "WorkPackageWatchers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackageWatchers_workPackageId_userId_key" ON "WorkPackageWatchers"("workPackageId", "userId");

-- CreateIndex
CREATE INDEX "WorkPackageCustomFields_projectId_idx" ON "WorkPackageCustomFields"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPackageCustomValues_workPackageId_customFieldId_key" ON "WorkPackageCustomValues"("workPackageId", "customFieldId");

-- CreateIndex
CREATE INDEX "Milestones_projectId_date_idx" ON "Milestones"("projectId", "date");

-- CreateIndex
CREATE INDEX "GanttBaselines_projectId_snapshotName_idx" ON "GanttBaselines"("projectId", "snapshotName");

-- CreateIndex
CREATE INDEX "GanttBaselines_workPackageId_idx" ON "GanttBaselines"("workPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "GanttBaselines_projectId_snapshotName_workPackageId_key" ON "GanttBaselines"("projectId", "snapshotName", "workPackageId");

-- CreateIndex
CREATE INDEX "TimeEntries_userId_spentOn_idx" ON "TimeEntries"("userId", "spentOn");

-- CreateIndex
CREATE INDEX "TimeEntries_projectId_spentOn_idx" ON "TimeEntries"("projectId", "spentOn");

-- CreateIndex
CREATE INDEX "TimeEntries_workPackageId_idx" ON "TimeEntries"("workPackageId");

-- CreateIndex
CREATE INDEX "HourlyRates_userId_projectId_validFrom_idx" ON "HourlyRates"("userId", "projectId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyRates_userId_projectId_validFrom_key" ON "HourlyRates"("userId", "projectId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBudgets_projectId_key" ON "ProjectBudgets"("projectId");

-- CreateIndex
CREATE INDEX "BudgetLineItems_budgetId_position_idx" ON "BudgetLineItems"("budgetId", "position");

-- CreateIndex
CREATE INDEX "BudgetLineItems_budgetId_kind_idx" ON "BudgetLineItems"("budgetId", "kind");

-- CreateIndex
CREATE INDEX "WikiPages_parentId_idx" ON "WikiPages"("parentId");

-- CreateIndex
CREATE INDEX "WikiPages_projectId_title_idx" ON "WikiPages"("projectId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "WikiPages_projectId_slug_key" ON "WikiPages"("projectId", "slug");

-- CreateIndex
CREATE INDEX "WikiRevisions_wikiPageId_idx" ON "WikiRevisions"("wikiPageId");

-- CreateIndex
CREATE UNIQUE INDEX "WikiRevisions_wikiPageId_version_key" ON "WikiRevisions"("wikiPageId", "version");

-- CreateIndex
CREATE INDEX "PortfolioProjects_portfolioId_position_idx" ON "PortfolioProjects"("portfolioId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioProjects_portfolioId_projectId_key" ON "PortfolioProjects"("portfolioId", "projectId");

-- CreateIndex
CREATE INDEX "MeetingAgendaItems_meetingId_position_idx" ON "MeetingAgendaItems"("meetingId", "position");

-- CreateIndex
CREATE INDEX "MeetingAttendees_meetingId_idx" ON "MeetingAttendees"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingAttendees_userId_idx" ON "MeetingAttendees"("userId");

-- CreateIndex
CREATE INDEX "MeetingOutcomes_meetingId_type_idx" ON "MeetingOutcomes"("meetingId", "type");

-- CreateIndex
CREATE INDEX "WorkPackageComments_workPackageId_idx" ON "WorkPackageComments"("workPackageId");

-- CreateIndex
CREATE INDEX "WorkPackageComments_userId_idx" ON "WorkPackageComments"("userId");

-- CreateIndex
CREATE INDEX "WorkPackageAttachments_workPackageId_idx" ON "WorkPackageAttachments"("workPackageId");

-- CreateIndex
CREATE INDEX "WorkPackageAttachments_uploadedByUserId_idx" ON "WorkPackageAttachments"("uploadedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRacis_activityCode_key" ON "ActivityRacis"("activityCode");

-- CreateIndex
CREATE INDEX "ActivityRacis_phase_idx" ON "ActivityRacis"("phase");

-- CreateIndex
CREATE INDEX "Handovers_projectId_idx" ON "Handovers"("projectId");

-- CreateIndex
CREATE INDEX "Handovers_status_idx" ON "Handovers"("status");

-- CreateIndex
CREATE INDEX "CahierFeedback_projectId_idx" ON "CahierFeedback"("projectId");

-- CreateIndex
CREATE INDEX "CahierFeedback_createdAt_idx" ON "CahierFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "HandoverCriteria_handoverId_idx" ON "HandoverCriteria"("handoverId");

-- AddForeignKey
ALTER TABLE "AppUsers" ADD CONSTRAINT "AppUsers_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Teams"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermissions" ADD CONSTRAINT "RolePermissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignments" ADD CONSTRAINT "UserRoleAssignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignments" ADD CONSTRAINT "UserRoleAssignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRoleAssignments" ADD CONSTRAINT "UserRoleAssignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectFields" ADD CONSTRAINT "ProjectFields_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFieldValues" ADD CONSTRAINT "ProjectFieldValues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFieldValues" ADD CONSTRAINT "ProjectFieldValues_projectFieldId_fkey" FOREIGN KEY ("projectFieldId") REFERENCES "ProjectFields"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectValidations" ADD CONSTRAINT "ProjectValidations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectValidations" ADD CONSTRAINT "ProjectValidations_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectActivities" ADD CONSTRAINT "ProjectActivities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectActivities" ADD CONSTRAINT "ProjectActivities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectTemplates" ADD CONSTRAINT "ProjectTemplates_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectTemplateFields" ADD CONSTRAINT "ProjectTemplateFields_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComments" ADD CONSTRAINT "ProjectComments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectComments" ADD CONSTRAINT "ProjectComments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectComments" ADD CONSTRAINT "ProjectComments_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "ProjectComments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProjectAttachments" ADD CONSTRAINT "ProjectAttachments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAttachments" ADD CONSTRAINT "ProjectAttachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingTranscripts" ADD CONSTRAINT "MeetingTranscripts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItems" ADD CONSTRAINT "MeetingActionItems_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecisions" ADD CONSTRAINT "MeetingDecisions_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegments" ADD CONSTRAINT "TranscriptSegments_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AppUsers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PhaseChecklists" ADD CONSTRAINT "PhaseChecklists_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseChecklists" ADD CONSTRAINT "PhaseChecklists_checkedBy_fkey" FOREIGN KEY ("checkedBy") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AuditLogs" ADD CONSTRAINT "AuditLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AutomationRules" ADD CONSTRAINT "AutomationRules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationLog" ADD CONSTRAINT "AutomationLog_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boards" ADD CONSTRAINT "Boards_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardColumns" ADD CONSTRAINT "BoardColumns_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprints" ADD CONSTRAINT "Sprints_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Versions" ADD CONSTRAINT "Versions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "AppUsers"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WorkPackages"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprints"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Versions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackages" ADD CONSTRAINT "WorkPackages_boardColumnId_fkey" FOREIGN KEY ("boardColumnId") REFERENCES "BoardColumns"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackageDependencies" ADD CONSTRAINT "WorkPackageDependencies_fromWpId_fkey" FOREIGN KEY ("fromWpId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageDependencies" ADD CONSTRAINT "WorkPackageDependencies_toWpId_fkey" FOREIGN KEY ("toWpId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageWatchers" ADD CONSTRAINT "WorkPackageWatchers_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageWatchers" ADD CONSTRAINT "WorkPackageWatchers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageCustomFields" ADD CONSTRAINT "WorkPackageCustomFields_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageCustomValues" ADD CONSTRAINT "WorkPackageCustomValues_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageCustomValues" ADD CONSTRAINT "WorkPackageCustomValues_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "WorkPackageCustomFields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestones" ADD CONSTRAINT "Milestones_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "GanttBaselines" ADD CONSTRAINT "GanttBaselines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GanttBaselines" ADD CONSTRAINT "GanttBaselines_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GanttBaselines" ADD CONSTRAINT "GanttBaselines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntries" ADD CONSTRAINT "TimeEntries_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HourlyRates" ADD CONSTRAINT "HourlyRates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HourlyRates" ADD CONSTRAINT "HourlyRates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBudgets" ADD CONSTRAINT "ProjectBudgets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineItems" ADD CONSTRAINT "BudgetLineItems_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "ProjectBudgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPages" ADD CONSTRAINT "WikiPages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiPages" ADD CONSTRAINT "WikiPages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WikiPages" ADD CONSTRAINT "WikiPages_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "WikiPages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WikiRevisions" ADD CONSTRAINT "WikiRevisions_wikiPageId_fkey" FOREIGN KEY ("wikiPageId") REFERENCES "WikiPages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiRevisions" ADD CONSTRAINT "WikiRevisions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Portfolios" ADD CONSTRAINT "Portfolios_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PortfolioProjects" ADD CONSTRAINT "PortfolioProjects_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioProjects" ADD CONSTRAINT "PortfolioProjects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItems" ADD CONSTRAINT "MeetingAgendaItems_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAgendaItems" ADD CONSTRAINT "MeetingAgendaItems_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingAttendees" ADD CONSTRAINT "MeetingAttendees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendees" ADD CONSTRAINT "MeetingAttendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingOutcomes" ADD CONSTRAINT "MeetingOutcomes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "MeetingTranscripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOutcomes" ADD CONSTRAINT "MeetingOutcomes_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MeetingOutcomes" ADD CONSTRAINT "MeetingOutcomes_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackageComments" ADD CONSTRAINT "WorkPackageComments_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageComments" ADD CONSTRAINT "WorkPackageComments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "WorkPackageAttachments" ADD CONSTRAINT "WorkPackageAttachments_workPackageId_fkey" FOREIGN KEY ("workPackageId") REFERENCES "WorkPackages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPackageAttachments" ADD CONSTRAINT "WorkPackageAttachments_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "AppUsers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Handovers" ADD CONSTRAINT "Handovers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CahierFeedback" ADD CONSTRAINT "CahierFeedback_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CahierFeedback" ADD CONSTRAINT "CahierFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverCriteria" ADD CONSTRAINT "HandoverCriteria_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "Handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
