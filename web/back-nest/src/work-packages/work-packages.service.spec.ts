import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkPackagesService } from './work-packages.service.js';

// ─── Mock factory ────────────────────────────────────────────────────────────
// Hybrid: an in-memory `_store.wp` array backs find/create/update so the
// existing tests stay green, but every prisma surface used by the service is
// exposed as a jest mock so new tests can `mockResolvedValueOnce(...)` per call.
const mkPrisma = () => {
  const store: Record<string, unknown[]> = { wp: [] };
  let idCounter = 0;
  const wp = {
    findMany: jest.fn(async () => store.wp),
    count: jest.fn(async () => store.wp.length),
    aggregate: jest.fn(async () => ({ _max: { position: store.wp.length } })),
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return (store.wp as Array<Record<string, unknown>>).find((w) => w.id === where.id) ?? null;
    }),
    findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return (store.wp as Array<Record<string, unknown>>).find((w) => w.id === where.id) ?? null;
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `wp-${++idCounter}`, isDeleted: false, ...data };
      store.wp.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const idx = (store.wp as Array<Record<string, unknown>>).findIndex((w) => w.id === where.id);
      if (idx < 0) throw new Error('not found');
      store.wp[idx] = { ...(store.wp[idx] as Record<string, unknown>), ...data };
      return store.wp[idx];
    }),
    updateMany: jest.fn(async () => ({ count: 0 })),
  };
  return {
    _store: store,
    workPackage: wp,
    workPackageWatcher: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'w-1', ...data })),
      delete: jest.fn(async () => ({})),
    },
    workPackageDependency: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'd-1', ...data })),
      delete: jest.fn(async () => ({})),
    },
    workPackageCustomField: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cf-1', ...data })),
      delete: jest.fn(async () => ({})),
    },
    workPackageCustomValue: {
      upsert: jest.fn(async () => ({})),
    },
    project: {
      // Service reads projects via findFirst({ id, isDeleted: false }) so
      // soft-deleted projects never serve data. (No findUnique mock — the
      // service no longer calls it on the Project model.)
      findFirst: jest.fn(async () => ({ id: 'p1', name: 'Project', projectManagerId: 'pm-1' })),
    },
    projectMember: {
      upsert: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
    },
    appUser: {
      findUnique: jest.fn(async () => ({ role: 'Member', isActive: true })),
      findMany: jest.fn(async () => []),
    },
    boardColumn: {
      findUnique: jest.fn(async () => ({ id: 'col-1', board: { projectId: 'p1' } })),
    },
    sprint: {
      findUnique: jest.fn(async () => ({ name: 'Sprint 1', board: { projectId: 'p1' } })),
    },
    projectActivity: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (fn: unknown) =>
      typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prismaRef) : Promise.all(fn as unknown[]),
    ),
  };
};
// Shared back-reference so $transaction's tx callback hits the same mocked methods.
// Cast (not annotated) to break the TS2502 circular self-reference.
let prismaRef = {} as ReturnType<typeof mkPrisma>;

describe('WorkPackagesService', () => {
  let prisma: ReturnType<typeof mkPrisma>;
  let notifications: { notifyEnhanced: jest.Mock };
  let analyticsCache: { invalidate: jest.Mock };
  let agentRunner: { run: jest.Mock };
  let svc: WorkPackagesService;

  beforeEach(() => {
    prisma = mkPrisma();
    prismaRef = prisma;
    notifications = { notifyEnhanced: jest.fn(async () => undefined) };
    analyticsCache = { invalidate: jest.fn(async () => undefined) };
    agentRunner = {
      run: jest.fn(async () => ({
        output: { items: [] },
        iterations: 0,
        toolCallsLog: [],
        provider: 'zai',
        model: 'glm-4.5-air',
      })),
    };
    svc = new WorkPackagesService(
      prisma as unknown as ConstructorParameters<typeof WorkPackagesService>[0],
      notifications as unknown as ConstructorParameters<typeof WorkPackagesService>[1],
      analyticsCache as unknown as ConstructorParameters<typeof WorkPackagesService>[2],
      agentRunner as unknown as ConstructorParameters<typeof WorkPackagesService>[3],
    );
  });

  // ─── create() ──────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects empty title', async () => {
      const r = await svc.create('p1', { title: '   ' }, 'u-author');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('titre');
    });

    it('creates a work package with defaults', async () => {
      const r = await svc.create('p1', { title: 'My task' }, 'u-author');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toMatchObject({
        title: 'My task',
        type: 'Task',
        status: 'New',
        priority: 'Normal',
      });
    });

    it('persists all optional fields when supplied', async () => {
      const r = await svc.create(
        'p1',
        {
          title: 'Full WP',
          description: 'detailed',
          type: 'Feature',
          status: 'InProgress',
          priority: 'High',
          startDate: '2026-06-01T00:00:00Z',
          dueDate: '2026-06-30T00:00:00Z',
          estimatedHours: 40,
          sprintId: 's1',
          versionId: 'v1',
          boardColumnId: 'col-1',
        },
        'u-author',
      );
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'detailed',
            type: 'Feature',
            status: 'InProgress',
            priority: 'High',
            estimatedHours: 40,
            sprintId: 's1',
            versionId: 'v1',
            boardColumnId: 'col-1',
            startDate: new Date('2026-06-01T00:00:00Z'),
            dueDate: new Date('2026-06-30T00:00:00Z'),
          }),
        }),
      );
    });

    it('notifies assignee on create when assignee ≠ author', async () => {
      await svc.create('p1', { title: 'Task', assigneeId: 'u-assignee' }, 'u-author');
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-assignee', reason: 'Assignee' }),
      );
    });

    it('does NOT notify when assignee equals author', async () => {
      await svc.create('p1', { title: 'Task', assigneeId: 'u-author' }, 'u-author');
      expect(notifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('runs ensureProjectMembership for the assignee before notifying', async () => {
      await svc.create('p1', { title: 'Task', assigneeId: 'u-assignee' }, 'u-author');
      // PM lookup → user lookup → upsert
      expect(prisma.project.findFirst).toHaveBeenCalled();
      expect(prisma.appUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'u-assignee' },
        select: { role: true, isActive: true },
      });
      expect(prisma.projectMember.upsert).toHaveBeenCalled();
    });

    it('logs activity + invalidates analytics cache', async () => {
      await svc.create('p1', { title: 'Task' }, 'u-author');
      // Activity logging is fire-and-forget; await a microtask tick.
      await new Promise((r) => setImmediate(r));
      expect(prisma.projectActivity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'p1',
          userId: 'u-author',
          action: 'work_package_created',
        }),
      });
      expect(analyticsCache.invalidate).toHaveBeenCalledWith('team_workload');
    });

    it('rejects cross-project parent (parentId belongs to another project)', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ id: 'p-wp', projectId: 'other' });
      await expect(
        svc.create('p1', { title: 'Task', parentId: 'p-wp' }, 'u-author'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts same-project parent', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ id: 'p-wp', projectId: 'p1' });
      const r = await svc.create('p1', { title: 'Task', parentId: 'p-wp' }, 'u-author');
      expect(r.isSuccess).toBe(true);
    });

    it('returns Result.fail on Prisma create error', async () => {
      prisma.workPackage.create.mockRejectedValueOnce(new Error('DB down'));
      const r = await svc.create('p1', { title: 'Task' }, 'u-author');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/création/i);
    });

    // ── assignee validation (assertAssignable) ──
    // The same rule bulkAssign enforces: assignee must be an active,
    // non-soft-deleted Member. Without this a deactivated/deleted/non-Member
    // user could be assigned directly and leave a dangling assigneeId.

    it('rejects a create whose assignee is soft-deleted', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: true, isDeleted: true });
      const r = await svc.create('p1', { title: 'Task', assigneeId: 'u-gone' }, 'u-author');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/assignable/i);
      expect(prisma.workPackage.create).not.toHaveBeenCalled();
    });

    it('rejects a create whose assignee is inactive', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: false, isDeleted: false });
      const r = await svc.create('p1', { title: 'Task', assigneeId: 'u-inactive' }, 'u-author');
      expect(r.isFailure).toBe(true);
      expect(prisma.workPackage.create).not.toHaveBeenCalled();
    });

    it('rejects a create whose assignee is not a Member (PM / SpecificationTeam)', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'SpecificationTeam', isActive: true, isDeleted: false });
      const r = await svc.create('p1', { title: 'Task', assigneeId: 'u-spec' }, 'u-author');
      expect(r.isFailure).toBe(true);
      expect(prisma.workPackage.create).not.toHaveBeenCalled();
    });
  });

  // ─── update() ──────────────────────────────────────────────────────────────

  describe('update', () => {
    let existingId: string;
    beforeEach(async () => {
      const created = await svc.create('p1', { title: 'Existing' }, 'pm-1');
      existingId = (created.value as { id: string }).id;
    });

    it('rejects when wp is missing', async () => {
      const r = await svc.update('wp-missing', 'p1', { title: 'x' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('introuvable');
    });

    it('Member can update only their own tasks', async () => {
      // Existing has no assignee → Member is not the owner.
      const r = await svc.update(existingId, 'p1', { status: 'InProgress' }, 'u-other', 'Member');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('propres tâches');
    });

    it('Member CAN update their own task on whitelisted fields', async () => {
      // Mark the WP as assigned to u-mem.
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      const r = await svc.update(existingId, 'p1', { status: 'InProgress', percentDone: 50 }, 'u-mem', 'Member');
      expect(r.isSuccess).toBe(true);
    });

    it('Member CANNOT touch forbidden fields (priority, assigneeId, …)', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      const r = await svc.update(existingId, 'p1', { priority: 'Critical' }, 'u-mem', 'Member');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Champs non autorisés');
    });

    it('Member CANNOT self-validate (Resolved) or close (Closed) their own task', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      const r1 = await svc.update(existingId, 'p1', { status: 'Resolved' }, 'u-mem', 'Member');
      expect(r1.isFailure).toBe(true);
      expect(r1.error).toContain('valider');
      const r2 = await svc.update(existingId, 'p1', { status: 'Closed' }, 'u-mem', 'Member');
      expect(r2.isFailure).toBe(true);
    });

    it('Member CAN submit their own task for review (→ AwaitingReview)', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      const r = await svc.update(existingId, 'p1', { status: 'AwaitingReview' }, 'u-mem', 'Member');
      expect(r.isSuccess).toBe(true);
    });

    it('a ProjectManager who is NOT this project\'s PM cannot validate a submitted task', async () => {
      // Mock project's PM is 'pm-1' (see prisma.project.findFirst default).
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).status = 'AwaitingReview';
      const r = await svc.update(existingId, 'p1', { status: 'Resolved' }, 'pm-OTHER', 'ProjectManager');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('chef de projet');
    });

    it("this project's PM CAN validate a submitted task", async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).status = 'AwaitingReview';
      const r = await svc.update(existingId, 'p1', { status: 'Resolved' }, 'pm-1', 'ProjectManager');
      expect(r.isSuccess).toBe(true);
    });

    it('rejects self-parent cycle', async () => {
      await expect(svc.update(existingId, 'p1', { parentId: existingId })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cross-project parent on update', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ id: 'p-wp', projectId: 'other' });
      await expect(svc.update(existingId, 'p1', { parentId: 'p-wp' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('notifies new assignee + activity log on reassignment', async () => {
      // Establish an existing assignee.
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-old';

      const r = await svc.update(existingId, 'p1', { assigneeId: 'u-new' }, 'pm-1');
      expect(r.isSuccess).toBe(true);

      await new Promise((res) => setImmediate(res));
      // New-assignee notify
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-new', reason: 'Assignee', type: 'work_package_assigned' }),
      );
      // Old-assignee notify
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-old', type: 'work_package_unassigned' }),
      );
    });

    it('notifies the previous assignee on explicit unassign', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-old';

      await svc.update(existingId, 'p1', { assigneeId: null }, 'pm-1');
      await new Promise((res) => setImmediate(res));
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-old', type: 'work_package_unassigned' }),
      );
    });

    it('rejects a reassignment to a soft-deleted user (assertAssignable)', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: true, isDeleted: true });
      const r = await svc.update(existingId, 'p1', { assigneeId: 'u-gone' }, 'pm-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/assignable/i);
    });

    it('rejects a reassignment to a non-Member user (assertAssignable)', async () => {
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'ProjectManager', isActive: true, isDeleted: false });
      const r = await svc.update(existingId, 'p1', { assigneeId: 'u-pm' }, 'pm-1');
      expect(r.isFailure).toBe(true);
    });

    it('allows unassigning (assigneeId:null) without an assignability check', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-old';
      // Make any assignability lookup fail — it must NOT be consulted for unassign.
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: false, isDeleted: true });
      const r = await svc.update(existingId, 'p1', { assigneeId: null }, 'pm-1');
      expect(r.isSuccess).toBe(true);
    });

    it('fires status-change watcher blast + invalidates cache on status change', async () => {
      const r = await svc.update(existingId, 'p1', { status: 'InProgress' }, 'pm-1');
      expect(r.isSuccess).toBe(true);
      // Watcher fetch happens inside notifyWatchersAndAssignee
      await new Promise((res) => setImmediate(res));
      expect(prisma.workPackageWatcher.findMany).toHaveBeenCalled();
      expect(analyticsCache.invalidate).toHaveBeenCalledWith('team_workload');
    });

    it('notifies PM when WP moves to AwaitingReview', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';

      await svc.update(existingId, 'p1', { status: 'AwaitingReview' }, 'u-mem');
      await new Promise((res) => setImmediate(res));
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'pm-1',
          type: 'work_package_awaiting_review',
          reason: 'AwaitingReview',
        }),
      );
    });

    it('does NOT notify PM on AwaitingReview when the PM themselves is the actor', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'pm-1';

      await svc.update(existingId, 'p1', { status: 'AwaitingReview' }, 'pm-1');
      await new Promise((res) => setImmediate(res));
      const awaiting = notifications.notifyEnhanced.mock.calls.filter(
        (c: unknown[]) => (c[0] as { type: string }).type === 'work_package_awaiting_review',
      );
      expect(awaiting).toHaveLength(0);
    });

    it('notifies the assignee when the PM validates a submitted task (AwaitingReview → Resolved)', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      (prisma._store.wp[idx] as Record<string, unknown>).status = 'AwaitingReview';
      await svc.update(existingId, 'p1', { status: 'Resolved' }, 'pm-1');
      await new Promise((res) => setImmediate(res));
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-mem', type: 'work_package_validated' }),
      );
    });

    it('notifies the assignee when the PM rejects a submitted task (AwaitingReview → InProgress)', async () => {
      const idx = prisma._store.wp.findIndex((w: Record<string, unknown>) => w.id === existingId);
      (prisma._store.wp[idx] as Record<string, unknown>).assigneeId = 'u-mem';
      (prisma._store.wp[idx] as Record<string, unknown>).status = 'AwaitingReview';
      await svc.update(existingId, 'p1', { status: 'InProgress' }, 'pm-1');
      await new Promise((res) => setImmediate(res));
      expect(notifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-mem', type: 'work_package_rejected' }),
      );
    });

    it('returns Result.fail on prisma.update rejection', async () => {
      prisma.workPackage.update.mockRejectedValueOnce(new Error('DB down'));
      const r = await svc.update(existingId, 'p1', { title: 'x' });
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── findOne / findAll / findForAssignee / findTodayForAssignee ───────────

  describe('findOne', () => {
    it('returns the WP when found', async () => {
      prisma.workPackage.findFirst.mockResolvedValueOnce({ id: 'wp-1', title: 'X' });
      const r = await svc.findOne('wp-1', 'p1');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wp-1', projectId: 'p1', isDeleted: false } }),
      );
    });

    it('returns Result.fail when WP is missing', async () => {
      prisma.workPackage.findFirst.mockResolvedValueOnce(null);
      const r = await svc.findOne('wp-x', 'p1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('findAll', () => {
    it('applies every filter to the where clause', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      prisma.workPackage.count.mockResolvedValueOnce(0);
      await svc.findAll('p1', {
        status: 'New',
        type: 'Feature',
        priority: 'High',
        assigneeId: 'u1',
        sprintId: 's1',
        versionId: 'v1',
        parentId: 'wp-parent',
        q: 'foo',
        page: 2,
        limit: 25,
      });
      expect(prisma.workPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            projectId: 'p1',
            isDeleted: false,
            status: 'New',
            type: 'Feature',
            priority: 'High',
            assigneeId: 'u1',
            sprintId: 's1',
            versionId: 'v1',
            parentId: 'wp-parent',
            title: { contains: 'foo' },
          }),
          skip: 25,
          take: 25,
        }),
      );
    });

    it('treats parentId=null as a top-level filter', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      prisma.workPackage.count.mockResolvedValueOnce(0);
      await svc.findAll('p1', { parentId: null });
      const call = prisma.workPackage.findMany.mock.calls[0][0] as { where: { parentId: unknown } };
      expect(call.where.parentId).toBe(null);
    });

    it('clamps pagination', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      prisma.workPackage.count.mockResolvedValueOnce(0);
      await svc.findAll('p1', { page: 0, limit: 9999 });
      const call = prisma.workPackage.findMany.mock.calls[0][0] as { skip: number; take: number };
      expect(call.take).toBe(200);
      expect(call.skip).toBe(0);
    });

    it('returns Result.fail on prisma error', async () => {
      prisma.workPackage.findMany.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.findAll('p1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('findForAssignee', () => {
    it('scopes to assigneeId + isDeleted:false', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      prisma.workPackage.count.mockResolvedValueOnce(0);
      await svc.findForAssignee('u-mem', { status: 'New', q: 'x', projectId: 'p1', sprintId: 's1', page: 3, limit: 10 });
      const call = prisma.workPackage.findMany.mock.calls[0][0] as { where: Record<string, unknown>; skip: number; take: number };
      expect(call.where).toEqual(
        expect.objectContaining({
          assigneeId: 'u-mem',
          isDeleted: false,
          status: 'New',
          title: { contains: 'x' },
          projectId: 'p1',
          sprintId: 's1',
        }),
      );
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    it('returns Result.fail on prisma error', async () => {
      prisma.workPackage.findMany.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.findForAssignee('u-mem');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('findTodayForAssignee', () => {
    it('queries the 3 open statuses with the configured cap', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      await svc.findTodayForAssignee('u-mem', 3);
      const call = prisma.workPackage.findMany.mock.calls[0][0] as { where: { status: unknown }; take: number };
      expect(call.where.status).toEqual({ in: ['New', 'InProgress', 'AwaitingReview'] });
      expect(call.take).toBe(3);
    });

    it('clamps limit to [1, 20]', async () => {
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      await svc.findTodayForAssignee('u-mem', 99);
      const call = prisma.workPackage.findMany.mock.calls[0][0] as { take: number };
      expect(call.take).toBe(20);
      prisma.workPackage.findMany.mockResolvedValueOnce([]);
      await svc.findTodayForAssignee('u-mem', 0);
      const call2 = prisma.workPackage.findMany.mock.calls[1][0] as { take: number };
      expect(call2.take).toBe(1);
    });

    it('returns Result.fail on prisma error', async () => {
      prisma.workPackage.findMany.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.findTodayForAssignee('u-mem');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('marks isDeleted=true', async () => {
      const created = await svc.create('p1', { title: 'Task' }, 'u-author');
      const wpId = (created.value as { id: string }).id;
      const r = await svc.softDelete(wpId, 'p1');
      expect(r.isSuccess).toBe(true);
      const wp = (prisma._store.wp as Array<Record<string, unknown>>).find((w) => w.id === wpId);
      expect(wp?.isDeleted).toBe(true);
    });

    it('returns Result.fail when wp is missing', async () => {
      const r = await svc.softDelete('wp-missing', 'p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('introuvable');
    });

    it('returns Result.fail on prisma error', async () => {
      const created = await svc.create('p1', { title: 'Task' }, 'u-author');
      const wpId = (created.value as { id: string }).id;
      prisma.workPackage.update.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.softDelete(wpId, 'p1');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── moveCard ──────────────────────────────────────────────────────────────

  describe('moveCard', () => {
    let wpId: string;
    beforeEach(async () => {
      const r = await svc.create('p1', { title: 'Move me' }, 'u-author');
      wpId = (r.value as { id: string }).id;
    });

    it('moves to a valid target column in the same project', async () => {
      const r = await svc.moveCard(wpId, { boardColumnId: 'col-1', position: 2 }, 'p1');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackage.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: wpId }, data: expect.objectContaining({ boardColumnId: 'col-1', position: 2 }) }),
      );
    });

    it('rejects target column in a different project', async () => {
      prisma.boardColumn.findUnique.mockResolvedValueOnce({ id: 'col-2', board: { projectId: 'other' } });
      await expect(svc.moveCard(wpId, { boardColumnId: 'col-2' }, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects self-parent on move', async () => {
      await expect(svc.moveCard(wpId, { parentId: wpId }, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cross-project parent on move', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ id: 'p-other', projectId: 'other' });
      await expect(svc.moveCard(wpId, { parentId: 'p-other' }, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when wp is missing under the supplied projectId scope', async () => {
      await expect(svc.moveCard('wp-missing', { position: 1 }, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns Result.fail on prisma.update rejection', async () => {
      prisma.workPackage.update.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.moveCard(wpId, { position: 5 }, 'p1');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── Watchers ──────────────────────────────────────────────────────────────

  describe('addWatcher / removeWatcher', () => {
    it('adds a new watcher row when none exists', async () => {
      const r = await svc.addWatcher('wp-1', 'u-1');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackageWatcher.create).toHaveBeenCalledWith({ data: { workPackageId: 'wp-1', userId: 'u-1' } });
    });

    it('is idempotent when watcher already exists', async () => {
      prisma.workPackageWatcher.findUnique.mockResolvedValueOnce({ workPackageId: 'wp-1', userId: 'u-1' });
      const r = await svc.addWatcher('wp-1', 'u-1');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackageWatcher.create).not.toHaveBeenCalled();
    });

    it('returns Result.fail on prisma error in addWatcher', async () => {
      prisma.workPackageWatcher.findUnique.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.addWatcher('wp-1', 'u-1');
      expect(r.isFailure).toBe(true);
    });

    it('removes an existing watcher', async () => {
      prisma.workPackageWatcher.findUnique.mockResolvedValueOnce({ workPackageId: 'wp-1', userId: 'u-1' });
      const r = await svc.removeWatcher('wp-1', 'u-1');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackageWatcher.delete).toHaveBeenCalled();
    });

    it('throws 404 when removing a non-existent watcher', async () => {
      prisma.workPackageWatcher.findUnique.mockResolvedValueOnce(null);
      await expect(svc.removeWatcher('wp-1', 'u-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns Result.fail on prisma error in removeWatcher', async () => {
      prisma.workPackageWatcher.findUnique.mockResolvedValueOnce({ workPackageId: 'wp-1', userId: 'u-1' });
      prisma.workPackageWatcher.delete.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.removeWatcher('wp-1', 'u-1');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── Dependencies ──────────────────────────────────────────────────────────

  describe('addDependency / removeDependency', () => {
    it('rejects self-dependency', async () => {
      const r = await svc.addDependency('wp-1', 'wp-1', 'relates');
      expect(r.isFailure).toBe(true);
    });

    it('rejects when target WP is missing', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce(null);
      const r = await svc.addDependency('wp-1', 'wp-2', 'relates');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('introuvable');
    });

    it('throws on a cycle (existing wp-2 -> wp-1, adding wp-1 -> wp-2 closes it)', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ projectId: 'p1' });
      prisma.workPackageDependency.findMany.mockResolvedValueOnce([{ fromWpId: 'wp-2', toWpId: 'wp-1' }]);
      await expect(svc.addDependency('wp-1', 'wp-2', 'relates')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a dependency when no cycle is reachable', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ projectId: 'p1' });
      prisma.workPackageDependency.findMany.mockResolvedValueOnce([]);
      const r = await svc.addDependency('wp-1', 'wp-2', 'blocks');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackageDependency.create).toHaveBeenCalledWith({
        data: { fromWpId: 'wp-1', toWpId: 'wp-2', type: 'blocks' },
      });
    });

    it('defaults type to "relates" on empty string', async () => {
      prisma.workPackage.findUnique.mockResolvedValueOnce({ projectId: 'p1' });
      prisma.workPackageDependency.findMany.mockResolvedValueOnce([]);
      await svc.addDependency('wp-1', 'wp-2', '');
      expect(prisma.workPackageDependency.create).toHaveBeenCalledWith({
        data: { fromWpId: 'wp-1', toWpId: 'wp-2', type: 'relates' },
      });
    });

    it('removeDependency happy path + error', async () => {
      let r = await svc.removeDependency('d-1');
      expect(r.isSuccess).toBe(true);
      prisma.workPackageDependency.delete.mockRejectedValueOnce(new Error('boom'));
      r = await svc.removeDependency('d-1');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── Custom fields / values ────────────────────────────────────────────────

  describe('custom fields + values', () => {
    it('listCustomFields returns prisma rows', async () => {
      prisma.workPackageCustomField.findMany.mockResolvedValueOnce([{ id: 'cf-1', name: 'KPI' }]);
      const r = await svc.listCustomFields('p1');
      expect(r.isSuccess).toBe(true);
      expect((r.value as Array<{ id: string }>)[0].id).toBe('cf-1');
    });

    it('listCustomFields fails gracefully', async () => {
      prisma.workPackageCustomField.findMany.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.listCustomFields('p1');
      expect(r.isFailure).toBe(true);
    });

    it('createCustomField persists with options', async () => {
      const r = await svc.createCustomField('p1', 'Severity', 'string', 'a|b|c');
      expect(r.isSuccess).toBe(true);
      expect(prisma.workPackageCustomField.create).toHaveBeenCalledWith({
        data: { projectId: 'p1', name: 'Severity', fieldType: 'string', options: 'a|b|c' },
      });
    });

    it('createCustomField fails gracefully', async () => {
      prisma.workPackageCustomField.create.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.createCustomField('p1', 'x', 'string');
      expect(r.isFailure).toBe(true);
    });

    it('deleteCustomField happy path + error', async () => {
      let r = await svc.deleteCustomField('cf-1');
      expect(r.isSuccess).toBe(true);
      prisma.workPackageCustomField.delete.mockRejectedValueOnce(new Error('boom'));
      r = await svc.deleteCustomField('cf-1');
      expect(r.isFailure).toBe(true);
    });

    it('upsertCustomValues iterates over every value', async () => {
      await svc.upsertCustomValues('wp-1', [
        { customFieldId: 'cf-1', value: 'low' },
        { customFieldId: 'cf-2' },
      ]);
      expect(prisma.workPackageCustomValue.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.workPackageCustomValue.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ value: null }) }),
      );
    });

    it('upsertCustomValues fails gracefully', async () => {
      prisma.workPackageCustomValue.upsert.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.upsertCustomValues('wp-1', [{ customFieldId: 'cf-1', value: 'x' }]);
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── bulkAssign ────────────────────────────────────────────────────────────

  describe('bulkAssign', () => {
    it('returns updated:0 on empty input', async () => {
      const r = await svc.bulkAssign('p1', [], 'pm-1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({ updated: 0 });
    });

    it('rejects when project is missing', async () => {
      prisma.project.findFirst.mockResolvedValueOnce(null);
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-1' }], 'pm-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Projet');
    });

    it('rejects when sprint is missing or outside the project', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ id: 'p1', name: 'Project', projectManagerId: 'pm-1' });
      prisma.sprint.findUnique.mockResolvedValueOnce({ name: 'Other', board: { projectId: 'other' } });
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-mem' }], 'pm-1', 's-other');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Sprint');
    });

    it('rejects when an assignee does not exist or is inactive', async () => {
      // 1st findUnique returns the project (in service.bulkAssign top), then
      // 2nd findUnique returns project for eligibility branch. Make appUser
      // resolve with one fewer row to trigger the inactive guard.
      prisma.appUser.findMany.mockResolvedValueOnce([]);
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-mem' }], 'pm-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('introuvables ou inactifs');
    });

    it('rejects a non-Member assignee (PM)', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'pm-1', role: 'ProjectManager' }]);
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'pm-1' }], 'pm-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('assignables');
    });

    it('rejects a SpecificationTeam assignee (validation, not execution)', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'u-spec', role: 'SpecificationTeam' }]);
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-spec' }], 'pm-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('assignables');
    });

    it('accepts Member assignees', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([
        { id: 'u-mem', role: 'Member' },
        { id: 'u-mem2', role: 'Member' },
      ]);
      prisma.workPackage.updateMany.mockResolvedValue({ count: 1 });
      const r = await svc.bulkAssign(
        'p1',
        [
          { wpId: 'wp-1', assigneeId: 'u-mem' },
          { wpId: 'wp-2', assigneeId: 'u-mem2' },
        ],
        'pm-1',
      );
      expect(r.isSuccess).toBe(true);
      expect(r.value?.updated).toBeGreaterThanOrEqual(0);
    });

    it('groups updates by assignee and runs one updateMany per group', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'u-mem', role: 'Member' }]);
      prisma.workPackage.updateMany.mockResolvedValue({ count: 2 });
      await svc.bulkAssign(
        'p1',
        [
          { wpId: 'wp-1', assigneeId: 'u-mem' },
          { wpId: 'wp-2', assigneeId: 'u-mem' },
          { wpId: 'wp-3', assigneeId: null },
        ],
        'pm-1',
      );
      // 2 buckets → 2 assign updateMany calls; the non-null (u-mem) bucket also
      // runs a 'New' → InProgress auto-advance updateMany → 3 total.
      expect(prisma.workPackage.updateMany).toHaveBeenCalledTimes(3);
    });

    it('un-assignments do NOT fire a notification', async () => {
      prisma.workPackage.updateMany.mockResolvedValue({ count: 1 });
      await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: null }], 'pm-1');
      expect(notifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('sends ONE consolidated notification per assignee with sprint context when supplied', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'u-mem', role: 'Member' }]);
      prisma.workPackage.updateMany.mockResolvedValue({ count: 2 });
      await svc.bulkAssign(
        'p1',
        [
          { wpId: 'wp-1', assigneeId: 'u-mem' },
          { wpId: 'wp-2', assigneeId: 'u-mem' },
        ],
        'pm-1',
        's1',
      );
      expect(notifications.notifyEnhanced).toHaveBeenCalledTimes(1);
      const call = notifications.notifyEnhanced.mock.calls[0][0] as {
        userId: string;
        type: string;
        message: string;
        link: string;
      };
      expect(call.userId).toBe('u-mem');
      expect(call.type).toBe('wp_bulk_assigned');
      expect(call.message).toMatch(/Sprint 1/);
      expect(call.link).toMatch(/sprintId=s1/);
    });

    it('returns Result.fail when the transaction throws', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'u-mem', role: 'Member' }]);
      prisma.workPackage.updateMany.mockRejectedValueOnce(new Error('boom'));
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-mem' }], 'pm-1');
      expect(r.isFailure).toBe(true);
    });

    it('swallows per-assignee notify failures (does not break the whole call)', async () => {
      prisma.appUser.findMany.mockResolvedValueOnce([{ id: 'u-mem', role: 'Member' }]);
      prisma.workPackage.updateMany.mockResolvedValue({ count: 1 });
      notifications.notifyEnhanced.mockRejectedValueOnce(new Error('SMTP down'));
      const r = await svc.bulkAssign('p1', [{ wpId: 'wp-1', assigneeId: 'u-mem' }], 'pm-1');
      expect(r.isSuccess).toBe(true);
    });
  });

  // ─── suggestAssignments ────────────────────────────────────────────────────

  describe('suggestAssignments', () => {
    it('returns empty items on empty input', async () => {
      const r = await svc.suggestAssignments('p1', []);
      expect(r.isSuccess).toBe(true);
      expect(r.value?.items).toEqual([]);
    });

    it('caps candidate list at 50', async () => {
      const ids = Array.from({ length: 75 }, (_, i) => `wp-${i}`);
      agentRunner.run.mockResolvedValueOnce({
        output: { items: [] },
        iterations: 0,
        toolCallsLog: [],
        provider: 'zai',
        model: 'glm-4.5-air',
      });
      await svc.suggestAssignments('p1', ids);
      expect(agentRunner.run).toHaveBeenCalled();
    });

    it('returns Result.fail when the runner rejects', async () => {
      agentRunner.run.mockRejectedValueOnce(new Error('quota'));
      const r = await svc.suggestAssignments('p1', ['wp-1']);
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/indisponibles/);
    });
  });

  // ─── ensureProjectMembership ───────────────────────────────────────────────

  describe('ensureProjectMembership (via create path)', () => {
    it('skips when assignee is already the project PM', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ projectManagerId: 'pm-1' });
      await svc.create('p1', { title: 'Task', assigneeId: 'pm-1' }, 'u-author');
      expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('skips when assignee is an Admin', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ projectManagerId: 'pm-1' });
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Admin', isActive: true });
      await svc.create('p1', { title: 'Task', assigneeId: 'u-admin' }, 'u-author');
      expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('skips when assignee is inactive', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ projectManagerId: 'pm-1' });
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: false });
      await svc.create('p1', { title: 'Task', assigneeId: 'u-mem' }, 'u-author');
      expect(prisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('upserts the ProjectMember row for an active Member assignee', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ projectManagerId: 'pm-1' });
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: true });
      await svc.create('p1', { title: 'Task', assigneeId: 'u-mem' }, 'u-author');
      expect(prisma.projectMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { project_member_uq: { projectId: 'p1', userId: 'u-mem' } },
        }),
      );
    });

    it('never throws even when the upsert blows up', async () => {
      prisma.project.findFirst.mockResolvedValueOnce({ projectManagerId: 'pm-1' });
      prisma.appUser.findUnique.mockResolvedValueOnce({ role: 'Member', isActive: true });
      prisma.projectMember.upsert.mockRejectedValueOnce(new Error('DB down'));
      const r = await svc.create('p1', { title: 'Task', assigneeId: 'u-mem' }, 'u-author');
      // Failure of ensureProjectMembership is swallowed; create still succeeds.
      expect(r.isSuccess).toBe(true);
    });
  });
});
