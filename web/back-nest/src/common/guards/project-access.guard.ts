import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PROJECT_ACCESS_PARAM_KEY } from '../decorators/project-access.decorator.js';
import { ALLOW_SPEC_REVIEWER_KEY } from '../decorators/allow-spec-reviewer.decorator.js';

@Injectable()
export class ProjectAccessGuard implements CanActivate {
  private readonly logger = new Logger(ProjectAccessGuard.name);
  // Per-user per-project ACL cache, 30s TTL.
  private readonly cache = new Map<string, number>(); // key = `${userId}:${projectId}`, value = expiresAt

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const param = this.reflector.getAllAndOverride<string | undefined>(
      PROJECT_ACCESS_PARAM_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!param) return true; // guard not applied to this route

    const req = ctx.switchToHttp().getRequest<{
      user?: { userId?: string; role?: string };
      params?: Record<string, string>;
      method?: string;
    }>();
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    const projectId = req.params?.[param];
    if (!userId) throw new ForbiddenException('Not authenticated');
    if (!projectId) throw new ForbiddenException('Missing project param');

    // Admins have system-wide access by design — fast-path them.
    if (userRole === 'Admin') return true;

    const cacheKey = `${userId}:${projectId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached > Date.now()) return true;

    // Project access requires ONE of:
    //   1. Being the assigned ProjectManager of the project
    //   2. Being listed in ProjectMember (the per-project team table)
    //
    // Admins are fast-pathed above. Custom-role per-project assignments
    // were dropped together with the dynamic RBAC stack — every team
    // member is now onboarded explicitly via /pm/projects/:id/members.
    const [asPm, memberHit] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: projectId, isDeleted: false, projectManagerId: userId },
        select: { id: true },
      }),
      this.prisma.projectMember.findFirst({
        where: { userId, projectId },
        select: { id: true },
      }),
    ]);
    if (asPm || memberHit) {
      this.cache.set(cacheKey, Date.now() + 30_000);
      this.evictIfNeeded();
      return true;
    }

    // Global SpecificationTeam reviewer access. The spec team validates cahiers
    // across EVERY project without being a ProjectMember, so:
    //   • READS (GET/HEAD) are allowed on any project that has a saved cahier
    //     (aiOutput != null) — this covers the whole review UI (project detail,
    //     validations, cahier + context tabs).
    //   • WRITES stay blocked here by default (keeps sprints/meetings/progress/etc.
    //     PM-only). The single write the spec team needs — submitting cahier
    //     feedback — opts in with @AllowSpecReviewer and is re-authorized in the
    //     service (active SpecificationTeam or Admin).
    // NOT cached: this grant is method-dependent, and the shared cache is
    // method-agnostic — caching it could leak a read-grant into a later write.
    if (userRole === 'SpecificationTeam') {
      const method = (req.method ?? 'GET').toUpperCase();
      const isRead = method === 'GET' || method === 'HEAD';
      const allowSpecWrite = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_SPEC_REVIEWER_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      if (isRead || allowSpecWrite) {
        const reviewable = await this.prisma.project.findFirst({
          where: { id: projectId, isDeleted: false, aiOutput: { not: null } },
          select: { id: true },
        });
        if (reviewable) return true;
      }
    }

    this.logger.debug(`ProjectAccessGuard denied ${userId} (${userRole}) -> ${projectId}`);
    throw new NotFoundException(); // use 404 to avoid leaking project existence
  }

  private evictIfNeeded(): void {
    // Opportunistic eviction — cap cache size.
    if (this.cache.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.cache) if (v <= now) this.cache.delete(k);
    }
  }

  /** Invalidate cached entries — call when a user's role assignments change. */
  invalidate(userId?: string): void {
    if (!userId) {
      this.cache.clear();
      return;
    }
    for (const k of this.cache.keys()) {
      if (k.startsWith(userId + ':')) this.cache.delete(k);
    }
  }
}
