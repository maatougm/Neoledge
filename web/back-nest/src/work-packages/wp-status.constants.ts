/**
 * @file wp-status.constants.ts
 * @desc Single source of truth for which Work Package statuses count as
 *       "terminal" (i.e. complete) — used for progress percentage and any
 *       filter that excludes finished work. Mirrored on the frontend at
 *       `web/Front/customapp/src/lib/wpStatus.ts` to keep both ends aligned.
 *
 * The full WP status set lives in
 * `web/back-nest/src/work-packages/dto/work-package.dto.ts` (`VALID_WP_STATUSES`).
 * Only `Resolved` and `Closed` count as terminal — every other state means
 * the work is still in progress (including `AwaitingReview` and the
 * `OnHold` parking lot).
 */

export const TERMINAL_WP_STATUSES = ['Resolved', 'Closed'] as const;

/**
 * Statuses a Member (the assignee) is allowed to set on their own task.
 * The lifecycle is: New → InProgress (start / auto on assign) → AwaitingReview
 * (submit for the PM to validate) — and AwaitingReview → InProgress (withdraw).
 * A Member may NOT set `Resolved`/`Closed`: only the project's PM validates or
 * closes a task. This is the server-side guard that prevents a Member from
 * self-approving and bypassing PM review (the UI hiding options is not a control).
 * Mirrored on the frontend at `web/Front/customapp/src/lib/wpStatus.ts`.
 */
export const MEMBER_SUBMITTABLE_STATUSES = ['New', 'InProgress', 'AwaitingReview'] as const;
