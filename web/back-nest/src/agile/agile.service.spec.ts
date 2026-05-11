import { AgileService } from './agile.service.js';

describe('AgileService.getBurndown', () => {
  let prisma: {
    sprint: { findUnique: jest.Mock };
    board: { findUnique: jest.Mock };
    workPackage: { update: jest.Mock };
    boardColumn: { findUnique: jest.Mock };
  };
  let svc: AgileService;

  beforeEach(() => {
    prisma = {
      sprint: { findUnique: jest.fn() },
      board: { findUnique: jest.fn(async () => ({ projectId: 'p1' })) },
      workPackage: { update: jest.fn(async () => ({ id: 'wp1', projectId: 'p1', boardColumnId: 'c1', status: 'InProgress' })) },
      boardColumn: { findUnique: jest.fn(async () => ({ mapStatus: 'InProgress' })) },
    };
    const collab = { broadcastCardMoved: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new AgileService(prisma as any, collab as any);
  });

  it('fails when sprint not found', async () => {
    prisma.sprint.findUnique.mockResolvedValueOnce(null);
    const r = await svc.getBurndown('s1');
    expect(r.isFailure).toBe(true);
  });

  it('returns days array covering sprint duration', async () => {
    const start = new Date('2026-04-01');
    const end = new Date('2026-04-05');  // 4 days
    prisma.sprint.findUnique.mockResolvedValueOnce({
      id: 's1',
      startDate: start,
      endDate: end,
      workPackages: [
        { estimatedHours: 10, status: 'InProgress', createdAt: start, updatedAt: start, percentDone: 0 },
      ],
    });
    const r = await svc.getBurndown('s1');
    expect(r.isSuccess).toBe(true);
    const v = r.value as { days: unknown[] };
    expect(v.days.length).toBe(5); // 0..4 inclusive
  });

  it('moveCard broadcasts the move via collaboration gateway', async () => {
    const collab = { broadcastCardMoved: jest.fn() };
    const prismaForMove = {
      ...prisma,
      workPackage: {
        ...prisma.workPackage,
        findFirst: jest.fn(async () => ({ id: 'wp1', projectId: 'p1' })),
      },
      boardColumn: {
        findUnique: jest.fn(async () => ({ mapStatus: 'InProgress', board: { projectId: 'p1' } })),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = new AgileService(prismaForMove as any, collab as any);
    await s.moveCard('p1', 'wp1', 'c1', 0);
    expect(collab.broadcastCardMoved).toHaveBeenCalledWith('p1', expect.objectContaining({
      workPackageId: 'wp1', boardColumnId: 'c1', status: 'InProgress',
    }));
  });
});
