import { SetMetadata } from '@nestjs/common';

export const REQUIRED_TEAM_KEY = 'requiredTeam';

export type TeamCode = 'Cloud' | 'PS' | 'Integration' | 'Delivery';

/**
 * Decorator that restricts access to users who belong to a specific RACI team.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, TeamGuard)
 *   @RequireTeam('Cloud')
 *   @Get('some-route')
 *   async handler() { ... }
 */
export const RequireTeam = (team: TeamCode) =>
  SetMetadata(REQUIRED_TEAM_KEY, team);
