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
