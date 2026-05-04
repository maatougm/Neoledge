import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service.js';
import { REQUIRED_TEAM_KEY } from '../decorators/require-team.decorator.js';

/**
 * TeamGuard enforces the @RequireTeam() decorator.
 *
 * It reads the user's teamId from the database (via PrismaService) and
 * compares the Team.code value against the code declared in @RequireTeam().
 *
 * Apply AFTER JwtAuthGuard so req.user is already populated:
 *   @UseGuards(JwtAuthGuard, TeamGuard)
 */
@Injectable()
export class TeamGuard implements CanActivate {
  private readonly logger = new Logger(TeamGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredTeam = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_TEAM_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequireTeam() on the handler — pass through.
    if (!requiredTeam) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      user?: { userId?: string; role?: string };
    }>();

    const userId = req.user?.userId;
    if (!userId) {
      return false;
    }

    // Admin users bypass team restrictions.
    if (req.user?.role === 'Admin') {
      return true;
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { team: { select: { code: true } } },
    });

    if (!user?.team) {
      this.logger.debug(
        `TeamGuard denied user ${userId} — not in any team (required: ${requiredTeam})`,
      );
      return false;
    }

    if (user.team.code !== requiredTeam) {
      this.logger.debug(
        `TeamGuard denied user ${userId} — team ${user.team.code} ≠ required ${requiredTeam}`,
      );
      return false;
    }

    return true;
  }
}
