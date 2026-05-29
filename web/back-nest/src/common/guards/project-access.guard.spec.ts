import { NotFoundException } from '@nestjs/common';
import { ProjectAccessGuard } from './project-access.guard.js';
import { PROJECT_ACCESS_PARAM_KEY } from '../decorators/project-access.decorator.js';
import { ALLOW_SPEC_REVIEWER_KEY } from '../decorators/allow-spec-reviewer.decorator.js';

/**
 * Focus: the global-SpecificationTeam reviewer access added so the spec team can
 * read + validate cahiers across all projects without being a ProjectMember,
 * WITHOUT opening project write endpoints to them.
 */
describe('ProjectAccessGuard', () => {
  function makeCtx(opts: {
    role?: string;
    userId?: string;
    method?: string;
    projectId?: string;
    accessParam?: string | undefined; // PROJECT_ACCESS_PARAM_KEY value
    allowSpecReviewer?: boolean; // ALLOW_SPEC_REVIEWER_KEY value
  }) {
    const handler = () => undefined;
    const cls = class {};
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === PROJECT_ACCESS_PARAM_KEY) return 'accessParam' in opts ? opts.accessParam : 'projectId';
        if (key === ALLOW_SPEC_REVIEWER_KEY) return opts.allowSpecReviewer ?? undefined;
        return undefined;
      }),
    };
    const ctx = {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: opts.userId ?? 'u1', role: opts.role },
          params: { projectId: opts.projectId ?? 'p1' },
          method: opts.method ?? 'GET',
        }),
      }),
    };
    return { ctx, reflector };
  }

  function makePrisma(opts: { asPm?: boolean; member?: boolean; reviewable?: boolean } = {}) {
    return {
      project: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          // The PM check passes projectManagerId; the reviewer check passes aiOutput.
          if ('projectManagerId' in where) return opts.asPm ? { id: 'p1' } : null;
          if ('aiOutput' in where) return opts.reviewable ? { id: 'p1' } : null;
          return null;
        }),
      },
      projectMember: {
        findFirst: jest.fn(async () => (opts.member ? { id: 'm1' } : null)),
      },
    };
  }

  function build(ctxOpts: Parameters<typeof makeCtx>[0], prismaOpts: Parameters<typeof makePrisma>[0] = {}) {
    const { ctx, reflector } = makeCtx(ctxOpts);
    const prisma = makePrisma(prismaOpts);
    const guard = new ProjectAccessGuard(reflector as never, prisma as never);
    return { guard, ctx, prisma };
  }

  it('allows when the guard is not applied (no access param)', async () => {
    const { guard, ctx } = build({ accessParam: undefined });
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
  });

  it('fast-paths Admin', async () => {
    const { guard, ctx, prisma } = build({ role: 'Admin' });
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
    expect(prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it('allows the project PM', async () => {
    const { guard, ctx } = build({ role: 'ProjectManager' }, { asPm: true });
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
  });

  it('allows a ProjectMember', async () => {
    const { guard, ctx } = build({ role: 'Member' }, { member: true });
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
  });

  it('denies a Member who is not on the project (404)', async () => {
    const { guard, ctx } = build({ role: 'Member' }, { asPm: false, member: false });
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Global SpecificationTeam reviewer ──────────────────────────────────────
  it('allows SpecificationTeam to READ a project that has a saved cahier', async () => {
    const { guard, ctx } = build({ role: 'SpecificationTeam', method: 'GET' }, { reviewable: true });
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
  });

  it('denies SpecificationTeam reading a project with NO saved cahier', async () => {
    const { guard, ctx } = build({ role: 'SpecificationTeam', method: 'GET' }, { reviewable: false });
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies SpecificationTeam WRITES by default (no @AllowSpecReviewer) even on a cahier project', async () => {
    const { guard, ctx } = build(
      { role: 'SpecificationTeam', method: 'PATCH', allowSpecReviewer: false },
      { reviewable: true },
    );
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a SpecificationTeam WRITE when the route opts in via @AllowSpecReviewer (cahier feedback)', async () => {
    const { guard, ctx } = build(
      { role: 'SpecificationTeam', method: 'POST', allowSpecReviewer: true },
      { reviewable: true },
    );
    await expect(guard.canActivate(ctx as never)).resolves.toBe(true);
  });

  it('denies an opted-in SpecificationTeam write when the project has no cahier', async () => {
    const { guard, ctx } = build(
      { role: 'SpecificationTeam', method: 'POST', allowSpecReviewer: true },
      { reviewable: false },
    );
    await expect(guard.canActivate(ctx as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
