/** @file src/common/enums/statuses.ts — Status / type string constants used across services */

export const WP_STATUS = {
  NEW: 'New',
  IN_PROGRESS: 'InProgress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  ON_HOLD: 'OnHold',
  REJECTED: 'Rejected',
} as const;
export type WpStatus = (typeof WP_STATUS)[keyof typeof WP_STATUS];

export const WP_TYPE = {
  TASK: 'Task',
  BUG: 'Bug',
  FEATURE: 'Feature',
  MILESTONE: 'Milestone',
  EPIC: 'Epic',
} as const;
export type WpType = (typeof WP_TYPE)[keyof typeof WP_TYPE];

export const WP_PRIORITY = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
  IMMEDIATE: 'Immediate',
} as const;
export type WpPriority = (typeof WP_PRIORITY)[keyof typeof WP_PRIORITY];

export const SPRINT_STATUS = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
} as const;
export type SprintStatus = (typeof SPRINT_STATUS)[keyof typeof SPRINT_STATUS];

export const VERSION_STATUS = {
  OPEN: 'Open',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
} as const;
export type VersionStatus = (typeof VERSION_STATUS)[keyof typeof VERSION_STATUS];

export const BOARD_TYPE = {
  KANBAN: 'Kanban',
  SCRUM: 'Scrum',
} as const;
export type BoardType = (typeof BOARD_TYPE)[keyof typeof BOARD_TYPE];

export const OUTCOME_TYPE = {
  DECISION: 'Decision',
  ACTION: 'Action',
  NOTE: 'Note',
  RISK: 'Risk',
} as const;
export type OutcomeType = (typeof OUTCOME_TYPE)[keyof typeof OUTCOME_TYPE];

export const NOTIFICATION_REASON = {
  MENTION: 'Mention',
  ASSIGNEE: 'Assignee',
  WATCHER: 'Watcher',
  DEADLINE: 'Deadline',
  STATUS_CHANGE: 'StatusChange',
  COMMENT: 'Comment',
  SYSTEM: 'System',
} as const;
export type NotificationReason = (typeof NOTIFICATION_REASON)[keyof typeof NOTIFICATION_REASON];

/** Days of 8h each for team-planner capacity calculation. Configurable via TEAM_DAILY_CAPACITY env. */
export const DEFAULT_DAILY_CAPACITY_HOURS = Number(process.env.TEAM_DAILY_CAPACITY ?? 8);
