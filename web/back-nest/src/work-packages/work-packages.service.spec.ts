import { WorkPackagesService } from './work-packages.service.js';

// Minimal mock of PrismaService surface used by WorkPackagesService.
const mkPrisma = () => {
  const store: Record<string, unknown[]> = { wp: [] };
  let idCounter = 0;
  return {
    _store: store,
    workPackage: {
      findMany: jest.fn(async () => store.wp),
      count: jest.fn(async () => store.wp.length),
      aggregate: jest.fn(async () => ({ _max: { position: store.wp.length } })),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return store.wp.find((w: Record<string, unknown>) => w.id === where.id) ?? null;
      }),
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return store.wp.find((w: Record<string, unknown>) => w.id === where.id) ?? null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const wp = { id: `wp-${++idCounter}`, isDeleted: false, ...data };
        store.wp.push(wp);
        return wp;
      }),
      update: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const idx = store.wp.findIndex((w: Record<string, unknown>) => w.id === where.id);
        if (idx < 0) throw new Error('not found');
        store.wp[idx] = { ...store.wp[idx], ...data };
        return store.wp[idx];
      }),
    },
    workPackageWatcher: {
      findMany: jest.fn(async () => []),
    },
  };
};

describe('WorkPackagesService', () => {
  let prisma: ReturnType<typeof mkPrisma>;
  let notifications: { notifyEnhanced: jest.Mock };
  let automation: { executeRulesForEvent: jest.Mock };
  let projectActivity: unknown;
  let svc: WorkPackagesService;

  beforeEach(() => {
    prisma = mkPrisma();
    notifications = { notifyEnhanced: jest.fn(async () => undefined) };
    automation = { executeRulesForEvent: jest.fn(async () => undefined) };
    projectActivity = { create: jest.fn(async () => ({})) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).projectActivity = projectActivity;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new WorkPackagesService(prisma as any, notifications as any, automation as any);
  });

  it('rejects empty title', async () => {
    const r = await svc.create('p1', { title: '   ' }, 'u-author');
    expect(r.isFailure).toBe(true);
    expect(r.error).toContain('titre');
  });

  it('creates a work package with defaults', async () => {
    const r = await svc.create('p1', { title: 'My task' }, 'u-author');
    expect(r.isSuccess).toBe(true);
    expect(r.value).toMatchObject({ title: 'My task', type: 'Task', status: 'New', priority: 'Normal' });
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

  it('fires automation on work_package_created', async () => {
    await svc.create('p1', { title: 'Task' }, 'u-author');
    expect(automation.executeRulesForEvent).toHaveBeenCalledWith(
      'p1', 'work_package_created', expect.objectContaining({ title: 'Task' }),
    );
  });

  it('fires automation on status change during update', async () => {
    const created = await svc.create('p1', { title: 'Task' }, 'u-author');
    const wpId = (created.value as { id: string }).id;
    await svc.update(wpId, 'p1', { status: 'InProgress' }, 'u-author');
    expect(automation.executeRulesForEvent).toHaveBeenCalledWith(
      'p1', 'work_package_status_changed',
      expect.objectContaining({ fromStatus: 'New', toStatus: 'InProgress' }),
    );
  });

  it('does NOT fire status-change automation when status unchanged', async () => {
    const created = await svc.create('p1', { title: 'Task' }, 'u-author');
    const wpId = (created.value as { id: string }).id;
    automation.executeRulesForEvent.mockClear();
    await svc.update(wpId, 'p1', { title: 'Renamed' }, 'u-author');
    expect(automation.executeRulesForEvent).not.toHaveBeenCalledWith(
      expect.anything(), 'work_package_status_changed', expect.anything(),
    );
  });

  it('softDelete marks isDeleted=true', async () => {
    const created = await svc.create('p1', { title: 'Task' }, 'u-author');
    const wpId = (created.value as { id: string }).id;
    const r = await svc.softDelete(wpId, 'p1');
    expect(r.isSuccess).toBe(true);
    const wp = prisma._store.wp.find((w: Record<string, unknown>) => w.id === wpId) as Record<string, unknown>;
    expect(wp.isDeleted).toBe(true);
  });
});
