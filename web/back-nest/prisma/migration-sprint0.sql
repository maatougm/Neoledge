-- ─── Sprint 0 migration: 12 new tables + Notifications ALTER ──────────────
-- All tables use utf8mb4_unicode_ci to match existing Projects/AppUsers charset

SET FOREIGN_KEY_CHECKS=1;

-- BoardColumns (depends on Boards - created second)
CREATE TABLE IF NOT EXISTS BoardColumns (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  boardId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(80) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  wipLimit INT NULL,
  mapStatus VARCHAR(32) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_col_board_pos (boardId, position),
  CONSTRAINT fk_col_board FOREIGN KEY (boardId) REFERENCES Boards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Sprints (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  boardId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(120) NOT NULL,
  goal TEXT NULL,
  startDate DATE NOT NULL,
  endDate DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Planning',
  capacity DECIMAL(8,2) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_sprint_board_status (boardId, status),
  CONSTRAINT fk_sprint_board FOREIGN KEY (boardId) REFERENCES Boards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Versions (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  startDate DATE NULL,
  endDate DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Open',
  position INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ver (projectId, name),
  INDEX idx_ver_proj_status (projectId, status),
  CONSTRAINT fk_ver_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS WorkPackages (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'Task',
  status VARCHAR(20) NOT NULL DEFAULT 'New',
  priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
  assigneeId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  authorId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  parentId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  sprintId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  versionId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  boardColumnId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  startDate DATE NULL,
  dueDate DATE NULL,
  estimatedHours DECIMAL(8,2) NULL,
  spentHours DECIMAL(8,2) NOT NULL DEFAULT 0,
  percentDone INT NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  isDeleted TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_wp_project_status (projectId, status),
  INDEX idx_wp_assignee (assigneeId),
  INDEX idx_wp_parent (parentId),
  INDEX idx_wp_sprint (sprintId),
  INDEX idx_wp_version (versionId),
  INDEX idx_wp_column (boardColumnId),
  CONSTRAINT fk_wp_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_wp_assignee FOREIGN KEY (assigneeId) REFERENCES AppUsers(id) ON DELETE SET NULL,
  CONSTRAINT fk_wp_author FOREIGN KEY (authorId) REFERENCES AppUsers(id) ON DELETE NO ACTION,
  CONSTRAINT fk_wp_sprint FOREIGN KEY (sprintId) REFERENCES Sprints(id) ON DELETE SET NULL,
  CONSTRAINT fk_wp_version FOREIGN KEY (versionId) REFERENCES Versions(id) ON DELETE SET NULL,
  CONSTRAINT fk_wp_column FOREIGN KEY (boardColumnId) REFERENCES BoardColumns(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Self-referencing FK for WorkPackages.parentId
ALTER TABLE WorkPackages ADD CONSTRAINT fk_wp_parent FOREIGN KEY (parentId) REFERENCES WorkPackages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS WorkPackageDependencies (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  fromWpId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  toWpId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'relates',
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_dep (fromWpId, toWpId, type),
  INDEX idx_dep_to (toWpId),
  CONSTRAINT fk_dep_from FOREIGN KEY (fromWpId) REFERENCES WorkPackages(id) ON DELETE CASCADE,
  CONSTRAINT fk_dep_to FOREIGN KEY (toWpId) REFERENCES WorkPackages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS WorkPackageWatchers (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  userId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_watcher (workPackageId, userId),
  INDEX idx_watcher_user (userId),
  CONSTRAINT fk_watcher_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE CASCADE,
  CONSTRAINT fk_watcher_user FOREIGN KEY (userId) REFERENCES AppUsers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS WorkPackageCustomFields (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  name VARCHAR(120) NOT NULL,
  fieldType VARCHAR(32) NOT NULL DEFAULT 'text',
  options TEXT NULL,
  isRequired TINYINT(1) NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_wpcf_project (projectId),
  CONSTRAINT fk_wpcf_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS WorkPackageCustomValues (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  customFieldId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  value TEXT NULL,
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wpcv (workPackageId, customFieldId),
  CONSTRAINT fk_wpcv_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE CASCADE,
  CONSTRAINT fk_wpcv_cf FOREIGN KEY (customFieldId) REFERENCES WorkPackageCustomFields(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Milestones (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  date DATE NOT NULL,
  isReached TINYINT(1) NOT NULL DEFAULT 0,
  color VARCHAR(16) NULL,
  position INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_ms_project_date (projectId, date),
  CONSTRAINT fk_ms_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS GanttBaselines (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  snapshotDate DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  snapshotName VARCHAR(120) NOT NULL,
  startDate DATE NULL,
  dueDate DATE NULL,
  estimatedHours DECIMAL(8,2) NULL,
  percentDone INT NOT NULL DEFAULT 0,
  createdById VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  INDEX idx_gb_project_snap (projectId, snapshotName),
  INDEX idx_gb_wp (workPackageId),
  CONSTRAINT fk_gb_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_gb_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE CASCADE,
  CONSTRAINT fk_gb_user FOREIGN KEY (createdById) REFERENCES AppUsers(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TimeEntries (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  userId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  hours DECIMAL(6,2) NOT NULL,
  spentOn DATE NOT NULL,
  activity VARCHAR(32) NOT NULL DEFAULT 'development',
  comment TEXT NULL,
  isBillable TINYINT(1) NOT NULL DEFAULT 1,
  lockedAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_te_user_date (userId, spentOn),
  INDEX idx_te_project_date (projectId, spentOn),
  INDEX idx_te_wp (workPackageId),
  CONSTRAINT fk_te_user FOREIGN KEY (userId) REFERENCES AppUsers(id) ON DELETE NO ACTION,
  CONSTRAINT fk_te_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_te_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS HourlyRates (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  userId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  rate DECIMAL(10,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  validFrom DATE NOT NULL,
  validTo DATE NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_hr_lookup (userId, projectId, validFrom),
  CONSTRAINT fk_hr_user FOREIGN KEY (userId) REFERENCES AppUsers(id) ON DELETE CASCADE,
  CONSTRAINT fk_hr_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ProjectBudgets (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL UNIQUE,
  laborBudget DECIMAL(14,2) NOT NULL DEFAULT 0,
  materialBudget DECIMAL(14,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'EUR',
  notes TEXT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pb_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BudgetLineItems (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  budgetId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  description VARCHAR(255) NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'material',
  unitCost DECIMAL(14,2) NOT NULL,
  units DECIMAL(10,2) NOT NULL,
  total DECIMAL(14,2) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_bli_budget_pos (budgetId, position),
  CONSTRAINT fk_bli_budget FOREIGN KEY (budgetId) REFERENCES ProjectBudgets(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS WikiPages (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  authorId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  parentId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  version INT NOT NULL DEFAULT 1,
  isDeleted TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wiki_slug (projectId, slug),
  INDEX idx_wiki_parent (parentId),
  CONSTRAINT fk_wiki_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_wiki_author FOREIGN KEY (authorId) REFERENCES AppUsers(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE WikiPages ADD CONSTRAINT fk_wiki_parent FOREIGN KEY (parentId) REFERENCES WikiPages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS WikiRevisions (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  wikiPageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  version INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content LONGTEXT NOT NULL,
  authorId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  comment VARCHAR(500) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wikirev (wikiPageId, version),
  INDEX idx_wikirev_page (wikiPageId),
  CONSTRAINT fk_wikirev_page FOREIGN KEY (wikiPageId) REFERENCES WikiPages(id) ON DELETE CASCADE,
  CONSTRAINT fk_wikirev_author FOREIGN KEY (authorId) REFERENCES AppUsers(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Portfolios (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  createdById VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_pf_user FOREIGN KEY (createdById) REFERENCES AppUsers(id) ON DELETE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PortfolioProjects (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  portfolioId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  projectId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  position INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pfp (portfolioId, projectId),
  INDEX idx_pfp_pos (portfolioId, position),
  CONSTRAINT fk_pfp_portfolio FOREIGN KEY (portfolioId) REFERENCES Portfolios(id) ON DELETE CASCADE,
  CONSTRAINT fk_pfp_project FOREIGN KEY (projectId) REFERENCES Projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MeetingAgendaItems (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  meetingId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  title VARCHAR(255) NOT NULL,
  duration INT NULL,
  responsibleId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  position INT NOT NULL DEFAULT 0,
  notes TEXT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_mai_meeting_pos (meetingId, position),
  CONSTRAINT fk_mai_meeting FOREIGN KEY (meetingId) REFERENCES MeetingTranscripts(id) ON DELETE CASCADE,
  CONSTRAINT fk_mai_user FOREIGN KEY (responsibleId) REFERENCES AppUsers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MeetingAttendees (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  meetingId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  userId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  externalName VARCHAR(200) NULL,
  externalEmail VARCHAR(200) NULL,
  isPresent TINYINT(1) NOT NULL DEFAULT 0,
  role VARCHAR(80) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_matt_meeting (meetingId),
  INDEX idx_matt_user (userId),
  CONSTRAINT fk_matt_meeting FOREIGN KEY (meetingId) REFERENCES MeetingTranscripts(id) ON DELETE CASCADE,
  CONSTRAINT fk_matt_user FOREIGN KEY (userId) REFERENCES AppUsers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MeetingOutcomes (
  id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  meetingId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'Note',
  description TEXT NOT NULL,
  ownerId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  dueDate DATE NULL,
  workPackageId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_mo_meeting_type (meetingId, type),
  CONSTRAINT fk_mo_meeting FOREIGN KEY (meetingId) REFERENCES MeetingTranscripts(id) ON DELETE CASCADE,
  CONSTRAINT fk_mo_owner FOREIGN KEY (ownerId) REFERENCES AppUsers(id) ON DELETE SET NULL,
  CONSTRAINT fk_mo_wp FOREIGN KEY (workPackageId) REFERENCES WorkPackages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend Notifications table (one column at a time; IF NOT EXISTS not supported for ADD COLUMN on MariaDB 10.x)
ALTER TABLE Notifications ADD COLUMN reason VARCHAR(40) NOT NULL DEFAULT 'system';
ALTER TABLE Notifications ADD COLUMN entityType VARCHAR(40) NULL;
ALTER TABLE Notifications ADD COLUMN entityId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE Notifications ADD COLUMN actorId VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL;
ALTER TABLE Notifications ADD COLUMN link VARCHAR(500) NULL;
ALTER TABLE Notifications ADD CONSTRAINT fk_notif_actor FOREIGN KEY (actorId) REFERENCES AppUsers(id) ON DELETE SET NULL;
