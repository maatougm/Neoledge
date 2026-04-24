/**
 * Canonical permission keys. Every @RequirePermission() in the codebase
 * must reference a key defined here. Keys are grouped by resource (the
 * substring before the first dot) so the admin UI can render them in
 * sections without parsing.
 */

export interface PermissionDef {
  key: string;
  resource: string;
  description: string;
  /** true = permission only meaningful when scoped to a project */
  projectScoped?: boolean;
}

export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // system
  { key: 'system.view', resource: 'system', description: 'View system status page' },
  { key: 'system.logs', resource: 'system', description: 'View application logs' },

  // users / roles
  { key: 'user.view', resource: 'user', description: 'List and view users' },
  { key: 'user.manage', resource: 'user', description: 'Create, edit, deactivate users' },
  { key: 'role.view', resource: 'role', description: 'View roles and permissions' },
  { key: 'role.manage', resource: 'role', description: 'Create, edit, assign roles' },

  // audit
  { key: 'audit.view', resource: 'audit', description: 'View audit logs' },

  // dashboard / analytics / export
  { key: 'dashboard.view', resource: 'dashboard', description: 'View admin dashboard' },
  { key: 'analytics.view', resource: 'analytics', description: 'View analytics metrics' },
  { key: 'export.run', resource: 'export', description: 'Export data (CSV/XLSX)' },

  // templates
  { key: 'template.view', resource: 'template', description: 'View project templates' },
  { key: 'template.manage', resource: 'template', description: 'Manage project templates' },

  // projects
  { key: 'project.view_all', resource: 'project', description: 'View all projects' },
  { key: 'project.view', resource: 'project', description: 'View assigned projects', projectScoped: true },
  { key: 'project.create', resource: 'project', description: 'Create projects' },
  { key: 'project.edit', resource: 'project', description: 'Edit project metadata', projectScoped: true },
  { key: 'project.delete', resource: 'project', description: 'Delete projects' },
  { key: 'project.manage_fields', resource: 'project', description: 'Manage project fields', projectScoped: true },
  { key: 'project.validate', resource: 'project', description: 'Submit phase validations', projectScoped: true },

  // work packages
  { key: 'wp.view', resource: 'wp', description: 'View work packages', projectScoped: true },
  { key: 'wp.create', resource: 'wp', description: 'Create work packages', projectScoped: true },
  { key: 'wp.edit', resource: 'wp', description: 'Edit work packages', projectScoped: true },
  { key: 'wp.delete', resource: 'wp', description: 'Delete work packages', projectScoped: true },
  { key: 'wp.comment', resource: 'wp', description: 'Comment on work packages', projectScoped: true },
  { key: 'wp.assign', resource: 'wp', description: 'Assign work packages to users', projectScoped: true },
  { key: 'wp.manage_custom_fields', resource: 'wp', description: 'Manage WP custom fields', projectScoped: true },

  // gantt
  { key: 'gantt.view', resource: 'gantt', description: 'View Gantt chart', projectScoped: true },
  { key: 'gantt.manage_milestones', resource: 'gantt', description: 'Manage milestones', projectScoped: true },
  { key: 'gantt.manage_baselines', resource: 'gantt', description: 'Capture/delete baselines', projectScoped: true },

  // agile
  { key: 'agile.view', resource: 'agile', description: 'View boards/sprints', projectScoped: true },
  { key: 'agile.manage_board', resource: 'agile', description: 'Edit board columns/cards', projectScoped: true },
  { key: 'agile.manage_sprint', resource: 'agile', description: 'Create/close sprints', projectScoped: true },

  // wiki
  { key: 'wiki.view', resource: 'wiki', description: 'View wiki pages', projectScoped: true },
  { key: 'wiki.edit', resource: 'wiki', description: 'Create/edit wiki pages', projectScoped: true },
  { key: 'wiki.delete', resource: 'wiki', description: 'Delete wiki pages', projectScoped: true },

  // budget
  { key: 'budget.view', resource: 'budget', description: 'View project budget', projectScoped: true },
  { key: 'budget.edit', resource: 'budget', description: 'Edit project budget', projectScoped: true },
  { key: 'budget.view_all', resource: 'budget', description: 'View cross-project budgets' },

  // time
  { key: 'time.log', resource: 'time', description: 'Log own time entries' },
  { key: 'time.view_all', resource: 'time', description: 'View all time entries' },
  { key: 'time.admin', resource: 'time', description: 'Lock timesheets, manage rates' },

  // portfolio
  { key: 'portfolio.view', resource: 'portfolio', description: 'View portfolios' },
  { key: 'portfolio.manage', resource: 'portfolio', description: 'Manage portfolios' },

  // team planner
  { key: 'team_planner.view', resource: 'team_planner', description: 'View team planner' },
  { key: 'team_planner.edit', resource: 'team_planner', description: 'Reassign work on planner' },
  { key: 'team_planner.admin', resource: 'team_planner', description: 'Cross-project utilization' },

  // meetings
  { key: 'meeting.view', resource: 'meeting', description: 'View meeting transcripts', projectScoped: true },
  { key: 'meeting.upload', resource: 'meeting', description: 'Upload meeting audio', projectScoped: true },
  { key: 'meeting.manage', resource: 'meeting', description: 'Edit/delete meetings', projectScoped: true },
  { key: 'meeting.ai_analyze', resource: 'meeting', description: 'Trigger AI analysis', projectScoped: true },

  // automation
  { key: 'automation.view', resource: 'automation', description: 'View automation rules', projectScoped: true },
  { key: 'automation.manage', resource: 'automation', description: 'Manage automation rules', projectScoped: true },

  // attachments
  { key: 'attachment.upload', resource: 'attachment', description: 'Upload attachments', projectScoped: true },
  { key: 'attachment.admin', resource: 'attachment', description: 'Delete any attachment' },
];

export const ALL_PERMISSION_KEYS: readonly string[] =
  PERMISSION_CATALOG.map((p) => p.key);

/**
 * Preset role → permission key map. Used by seed-permissions.ts and the
 * RolesGuard compat shim. Admin gets every permission; others get a tailored
 * subset matching the legacy role's responsibility.
 */
export const PRESET_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  Admin: ALL_PERMISSION_KEYS,

  ProjectManager: [
    'dashboard.view',
    'analytics.view',
    'export.run',
    'template.view',
    'project.view_all',
    'project.view',
    'project.create',
    'project.edit',
    'project.manage_fields',
    'project.validate',
    'wp.view',
    'wp.create',
    'wp.edit',
    'wp.delete',
    'wp.comment',
    'wp.assign',
    'wp.manage_custom_fields',
    'gantt.view',
    'gantt.manage_milestones',
    'gantt.manage_baselines',
    'agile.view',
    'agile.manage_board',
    'agile.manage_sprint',
    'wiki.view',
    'wiki.edit',
    'wiki.delete',
    'budget.view',
    'budget.edit',
    'time.log',
    'time.view_all',
    'portfolio.view',
    'team_planner.view',
    'team_planner.edit',
    'meeting.view',
    'meeting.upload',
    'meeting.manage',
    'meeting.ai_analyze',
    'automation.view',
    'automation.manage',
    'attachment.upload',
  ],

  SpecificationTeam: [
    'project.view',
    'project.validate',
    'wp.view',
    'wp.comment',
    'gantt.view',
    'wiki.view',
    'wiki.edit',
    'meeting.view',
    'meeting.upload',
    'time.log',
    'attachment.upload',
  ],

  Member: [
    'project.view',
    'project.validate',
    'wp.view',
    'wp.edit',
    'wp.comment',
    'wp.assign',
    'gantt.view',
    'agile.view',
    'agile.manage_board',
    'wiki.view',
    'wiki.edit',
    'meeting.view',
    'time.log',
    'attachment.upload',
  ],

  DeploymentTeam: [
    'project.view',
    'project.validate',
    'wp.view',
    'wp.edit',
    'wp.comment',
    'gantt.view',
    'wiki.view',
    'meeting.view',
    'meeting.upload',
    'time.log',
    'attachment.upload',
  ],

};
