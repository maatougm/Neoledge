-- ============================================================================
-- NeoLeadge DB coherence audit (pluralised table names via Prisma @@map)
-- Run: docker exec -i neoleadge_postgres psql -U neoleadge -d neoleadge < db-audit.sql
-- All queries READ-ONLY. Positive row count = problem to investigate.
-- ============================================================================

\echo '── [1] Orphan foreign keys ─────────────────────────────────────────────'

SELECT 'WorkPackage.assigneeId -> AppUser' AS issue, COUNT(*) AS orphans
  FROM "WorkPackages" w LEFT JOIN "AppUsers" u ON u.id = w."assigneeId"
 WHERE w."assigneeId" IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'WorkPackage.authorId -> AppUser', COUNT(*)
  FROM "WorkPackages" w LEFT JOIN "AppUsers" u ON u.id = w."authorId"
 WHERE w."authorId" IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'WorkPackage.parentId -> WorkPackage', COUNT(*)
  FROM "WorkPackages" w LEFT JOIN "WorkPackages" p ON p.id = w."parentId"
 WHERE w."parentId" IS NOT NULL AND p.id IS NULL
UNION ALL SELECT 'WorkPackage.projectId -> Project', COUNT(*)
  FROM "WorkPackages" w LEFT JOIN "Projects" p ON p.id = w."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'WorkPackage.sprintId -> Sprint', COUNT(*)
  FROM "WorkPackages" w LEFT JOIN "Sprints" s ON s.id = w."sprintId"
 WHERE w."sprintId" IS NOT NULL AND s.id IS NULL
UNION ALL SELECT 'WorkPackage.versionId -> Version', COUNT(*)
  FROM "WorkPackages" w LEFT JOIN "Versions" v ON v.id = w."versionId"
 WHERE w."versionId" IS NOT NULL AND v.id IS NULL
UNION ALL SELECT 'ProjectValidation.validatedByUserId -> AppUser', COUNT(*)
  FROM "ProjectValidations" pv LEFT JOIN "AppUsers" u ON u.id = pv."validatedByUserId"
 WHERE u.id IS NULL
UNION ALL SELECT 'ProjectValidation.projectId -> Project', COUNT(*)
  FROM "ProjectValidations" pv LEFT JOIN "Projects" p ON p.id = pv."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'ProjectFieldValue.projectId -> Project', COUNT(*)
  FROM "ProjectFieldValues" fv LEFT JOIN "Projects" p ON p.id = fv."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'ProjectComment.projectId -> Project', COUNT(*)
  FROM "ProjectComments" c LEFT JOIN "Projects" p ON p.id = c."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'ProjectComment.userId -> AppUser', COUNT(*)
  FROM "ProjectComments" c LEFT JOIN "AppUsers" u ON u.id = c."userId"
 WHERE c."userId" IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'ProjectActivity.projectId -> Project', COUNT(*)
  FROM "ProjectActivities" a LEFT JOIN "Projects" p ON p.id = a."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'Notification.userId -> AppUser', COUNT(*)
  FROM "Notifications" n LEFT JOIN "AppUsers" u ON u.id = n."userId"
 WHERE u.id IS NULL
UNION ALL SELECT 'Notification.actorId -> AppUser', COUNT(*)
  FROM "Notifications" n LEFT JOIN "AppUsers" u ON u.id = n."actorId"
 WHERE n."actorId" IS NOT NULL AND u.id IS NULL
UNION ALL SELECT 'TimeEntry.userId -> AppUser', COUNT(*)
  FROM "TimeEntries" t LEFT JOIN "AppUsers" u ON u.id = t."userId"
 WHERE u.id IS NULL
UNION ALL SELECT 'TimeEntry.projectId -> Project', COUNT(*)
  FROM "TimeEntries" t LEFT JOIN "Projects" p ON p.id = t."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'WikiRevision.wikiPageId -> WikiPage', COUNT(*)
  FROM "WikiRevisions" r LEFT JOIN "WikiPages" p ON p.id = r."wikiPageId"
 WHERE p.id IS NULL
UNION ALL SELECT 'WorkPackageWatcher.userId -> AppUser', COUNT(*)
  FROM "WorkPackageWatchers" w LEFT JOIN "AppUsers" u ON u.id = w."userId"
 WHERE u.id IS NULL
UNION ALL SELECT 'PortfolioProject.projectId -> Project', COUNT(*)
  FROM "PortfolioProjects" pp LEFT JOIN "Projects" p ON p.id = pp."projectId"
 WHERE p.id IS NULL
UNION ALL SELECT 'BudgetLineItem.budgetId -> ProjectBudget', COUNT(*)
  FROM "BudgetLineItems" bli LEFT JOIN "ProjectBudgets" b ON b.id = bli."budgetId"
 WHERE b.id IS NULL;

\echo '── [2] Enum drift ───────────────────────────────────────────────────────'

SELECT 'Project bad status' AS issue, id, status FROM "Projects"
 WHERE status NOT IN ('Draft','InProgress','SpecificationValidation','Realization','DeploymentValidation','Completed','Archived');

SELECT 'Project bad priority' AS issue, id, priority FROM "Projects"
 WHERE priority IS NOT NULL AND priority NOT IN ('Low','Medium','High','Critical');

SELECT 'AppUser bad role' AS issue, id, role FROM "AppUsers"
 WHERE role NOT IN ('Admin','ProjectManager','SpecificationTeam','RealizationTeam','DeploymentTeam','Viewer');

SELECT 'WorkPackage bad status' AS issue, id, status FROM "WorkPackages"
 WHERE status NOT IN ('New','InProgress','Resolved','Closed','OnHold','Blocked','Rejected');

SELECT 'WorkPackage bad priority' AS issue, id, priority FROM "WorkPackages"
 WHERE priority NOT IN ('Low','Normal','High','Urgent','Immediate','Critical');

SELECT 'WorkPackage bad type' AS issue, id, type FROM "WorkPackages"
 WHERE type NOT IN ('Task','Bug','Feature','Epic','Milestone','Story');

\echo '── [3] Soft-delete (informational) ─────────────────────────────────────'

SELECT 'Soft-deleted projects' AS issue, COUNT(*) AS n FROM "Projects" WHERE "isDeleted" = true
UNION ALL SELECT 'Soft-deleted WPs', COUNT(*) FROM "WorkPackages" WHERE "isDeleted" = true;

\echo '── [4] Duplicate unique constraints ────────────────────────────────────'

SELECT 'Dup AppUser.email' AS issue, email, COUNT(*) FROM "AppUsers"
 GROUP BY email HAVING COUNT(*) > 1;

SELECT 'Dup ProjectValidation(project,user,phase)' AS issue,
       "projectId", "validatedByUserId", phase, COUNT(*)
  FROM "ProjectValidations"
 GROUP BY "projectId", "validatedByUserId", phase HAVING COUNT(*) > 1;

\echo '── [5] WP parent-tree cycles ──────────────────────────────────────────'

WITH RECURSIVE tree AS (
  SELECT id, "parentId", ARRAY[id] AS path, false AS cycle
    FROM "WorkPackages" WHERE "parentId" IS NULL
  UNION ALL
  SELECT w.id, w."parentId", t.path || w.id, w.id = ANY(t.path)
    FROM "WorkPackages" w JOIN tree t ON w."parentId" = t.id
   WHERE NOT t.cycle AND array_length(t.path, 1) < 20
)
SELECT 'WP tree cycle detected' AS issue, id FROM tree WHERE cycle;

\echo '── [6] Budget overspend (sum(lines) > budget cap) ──────────────────────'

SELECT 'OVERSPEND' AS issue,
       b."projectId" AS project, b.id AS budget_id,
       (COALESCE(b."laborBudget"::numeric, 0) + COALESCE(b."materialBudget"::numeric, 0)) AS declared_total,
       SUM(bli.total::numeric) AS sum_lines
  FROM "ProjectBudgets" b JOIN "BudgetLineItems" bli ON bli."budgetId" = b.id
 GROUP BY b.id, b."projectId", b."laborBudget", b."materialBudget"
HAVING SUM(bli.total::numeric) > (COALESCE(b."laborBudget"::numeric, 0) + COALESCE(b."materialBudget"::numeric, 0));

\echo '── [7] Notification entityId integrity ─────────────────────────────────'

SELECT 'Notif entity=work_package not found' AS issue, id, "entityId" FROM "Notifications"
 WHERE "entityType" = 'work_package' AND "entityId" IS NOT NULL
   AND "entityId" NOT IN (SELECT id FROM "WorkPackages");

SELECT 'Notif entity=project not found' AS issue, id, "entityId" FROM "Notifications"
 WHERE "entityType" = 'project' AND "entityId" IS NOT NULL
   AND "entityId" NOT IN (SELECT id FROM "Projects");

\echo '── [8] Role-phase coherence on ProjectValidations ──────────────────────'

SELECT 'Validation role mismatch' AS issue, id, phase, "validatedByRole" FROM "ProjectValidations"
 WHERE (phase = 'Specification' AND "validatedByRole" NOT IN ('Admin','SpecificationTeam'))
    OR (phase = 'Realization'   AND "validatedByRole" NOT IN ('Admin','RealizationTeam'))
    OR (phase = 'Deployment'    AND "validatedByRole" NOT IN ('Admin','DeploymentTeam'));

\echo '── [9] Date sanity ─────────────────────────────────────────────────────'

SELECT 'Sprint end<start' AS issue, id, name, "startDate", "endDate" FROM "Sprints"
 WHERE "endDate" < "startDate";

SELECT 'Project end<start' AS issue, id, name, "startDate", "endDate" FROM "Projects"
 WHERE "endDate" IS NOT NULL AND "startDate" IS NOT NULL AND "endDate" < "startDate";

SELECT 'WorkPackage dueDate<startDate' AS issue, id, title FROM "WorkPackages"
 WHERE "dueDate" IS NOT NULL AND "startDate" IS NOT NULL AND "dueDate" < "startDate";

\echo '── [10] Row counts ─────────────────────────────────────────────────────'

SELECT 'AppUsers'            AS table_name, COUNT(*) AS rows FROM "AppUsers"
UNION ALL SELECT 'Projects',               COUNT(*) FROM "Projects"
UNION ALL SELECT 'WorkPackages',           COUNT(*) FROM "WorkPackages"
UNION ALL SELECT 'ProjectValidations',     COUNT(*) FROM "ProjectValidations"
UNION ALL SELECT 'ProjectFields',          COUNT(*) FROM "ProjectFields"
UNION ALL SELECT 'ProjectFieldValues',     COUNT(*) FROM "ProjectFieldValues"
UNION ALL SELECT 'Sprints',                COUNT(*) FROM "Sprints"
UNION ALL SELECT 'Milestones',             COUNT(*) FROM "Milestones"
UNION ALL SELECT 'ProjectBudgets',         COUNT(*) FROM "ProjectBudgets"
UNION ALL SELECT 'BudgetLineItems',        COUNT(*) FROM "BudgetLineItems"
UNION ALL SELECT 'TimeEntries',            COUNT(*) FROM "TimeEntries"
UNION ALL SELECT 'WikiPages',              COUNT(*) FROM "WikiPages"
UNION ALL SELECT 'Notifications',          COUNT(*) FROM "Notifications"
UNION ALL SELECT 'ProjectActivities',      COUNT(*) FROM "ProjectActivities"
UNION ALL SELECT 'Portfolios',             COUNT(*) FROM "Portfolios"
UNION ALL SELECT 'PortfolioProjects',      COUNT(*) FROM "PortfolioProjects"
UNION ALL SELECT 'Boards',                 COUNT(*) FROM "Boards"
UNION ALL SELECT 'BoardColumns',           COUNT(*) FROM "BoardColumns";

\echo '── Done ────────────────────────────────────────────────────────────────'
