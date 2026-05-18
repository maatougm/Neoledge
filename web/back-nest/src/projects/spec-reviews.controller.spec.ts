import { SpecReviewsController } from './spec-reviews.controller.js';

describe('SpecReviewsController', () => {
  let mockPrisma: {
    projectMember: { findMany: jest.Mock };
    cahierFeedback: { findMany: jest.Mock };
  };
  let controller: SpecReviewsController;

  function reqAs(userId: string | undefined): never {
    return { user: userId ? { userId } : undefined } as never;
  }

  beforeEach(() => {
    mockPrisma = {
      projectMember: { findMany: jest.fn() },
      cahierFeedback: { findMany: jest.fn() },
    };
    controller = new SpecReviewsController(mockPrisma as never);
  });

  it('returns [] when no userId on the request', async () => {
    expect(await controller.listPendingReviews(reqAs(undefined))).toEqual([]);
  });

  it('returns [] when caller has no memberships', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([]);
    expect(await controller.listPendingReviews(reqAs('u1'))).toEqual([]);
  });

  it('returns pending rows for projects with no prior feedback', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'p1',
          name: 'P1',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-01-01T00:00:00Z', body: 'x' }),
          updatedAt: new Date('2026-01-02'),
          projectManager: { firstName: 'A', lastName: 'B' },
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([]);

    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: 'p1',
      cahierStatus: 'pending',
      managerName: 'A B',
      cahierSavedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('hides rows the caller already approved', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'p1',
          name: 'P1',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-01-01T00:00:00Z' }),
          updatedAt: new Date('2026-01-02'),
          projectManager: { firstName: 'A', lastName: 'B' },
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([
      { projectId: 'p1', status: 'approved', createdAt: new Date('2026-01-03') },
    ]);

    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows).toHaveLength(0);
  });

  it('keeps "rejected" rows in the queue', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'p1',
          name: 'P1',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-01-01T00:00:00Z' }),
          updatedAt: new Date(),
          projectManager: { firstName: 'A', lastName: 'B' },
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([
      { projectId: 'p1', status: 'rejected', createdAt: new Date('2026-01-03') },
    ]);

    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows).toHaveLength(1);
    expect(rows[0].cahierStatus).toBe('rejected');
  });

  it('treats a re-saved cahier (savedAt > last feedback) as pending again', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'p1',
          name: 'P1',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-02-01T00:00:00Z' }),
          updatedAt: new Date(),
          projectManager: null,
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([
      { projectId: 'p1', status: 'rejected', createdAt: new Date('2026-01-10') },
    ]);

    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows).toHaveLength(1);
    expect(rows[0].cahierStatus).toBe('pending');
    expect(rows[0].managerName).toBeNull();
  });

  it('tolerates malformed aiOutput JSON (cahierSavedAt becomes null)', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'p1',
          name: 'P1',
          clientName: 'C',
          status: 'Active',
          aiOutput: '{not valid json',
          updatedAt: new Date(),
          projectManager: { firstName: 'A', lastName: 'B' },
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([]);
    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows).toHaveLength(1);
    expect(rows[0].cahierSavedAt).toBeNull();
  });

  it('sorts most recent cahier first', async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([
      {
        project: {
          id: 'older',
          name: 'O',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-01-01T00:00:00Z' }),
          updatedAt: new Date(),
          projectManager: null,
        },
      },
      {
        project: {
          id: 'newer',
          name: 'N',
          clientName: 'C',
          status: 'Active',
          aiOutput: JSON.stringify({ savedAt: '2026-03-01T00:00:00Z' }),
          updatedAt: new Date(),
          projectManager: null,
        },
      },
    ]);
    mockPrisma.cahierFeedback.findMany.mockResolvedValue([]);

    const rows = await controller.listPendingReviews(reqAs('u1'));
    expect(rows.map((r) => r.projectId)).toEqual(['newer', 'older']);
  });
});
