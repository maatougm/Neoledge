import { SetMetadata } from '@nestjs/common';

export const ALLOW_SPEC_REVIEWER_KEY = 'allowSpecReviewer';

/**
 * Opt-in: on a route already guarded by `ProjectAccessGuard`, also admit an
 * active SpecificationTeam user (when the project has a saved cahier) EVEN IF
 * the request is a write (non-GET).
 *
 * Background: the spec team is global — it reviews cahiers across every project
 * without being a ProjectMember. `ProjectAccessGuard` already lets SpecTeam READ
 * (GET/HEAD) any project that has a saved cahier, which covers the whole review
 * UI. The only WRITE the spec team performs is submitting cahier feedback
 * (approve/reject); mark that single endpoint with `@AllowSpecReviewer()` so it
 * passes the guard. The endpoint's own logic (`saveFeedback`) still re-authorizes
 * the caller (active SpecificationTeam or Admin) — this decorator only relaxes
 * the project-scope gate, never the role check.
 *
 * Do NOT add this to planning/mutation endpoints (sprints, meetings, progress,
 * etc.) — those must stay PM/Member-only.
 */
export const AllowSpecReviewer = () => SetMetadata(ALLOW_SPEC_REVIEWER_KEY, true);
