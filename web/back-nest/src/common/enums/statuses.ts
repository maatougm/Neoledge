/** @file src/common/enums/statuses.ts — Cross-service constants.
 *
 *  Note: the WP / Sprint / Board / Outcome status enums that used to live
 *  here were stale duplicates of the canonical constants in the per-feature
 *  DTOs (`work-packages/dto/work-package.dto.ts`, `work-packages/wp-status.constants.ts`).
 *  Removed to prevent future drift — see commit removing them.
 */

/** Days of 8h each for team-planner capacity calculation. Configurable via TEAM_DAILY_CAPACITY env. */
export const DEFAULT_DAILY_CAPACITY_HOURS = Number(process.env.TEAM_DAILY_CAPACITY ?? 8);
