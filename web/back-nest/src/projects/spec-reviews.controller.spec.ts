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

  describe('listMyReviews', () => {
    function feedbackRow(over: {
      projectId: string;
      status: string;
      comment?: string | null;
      createdAt: Date;
      savedAt?: string | null;
      name?: string;
    }) {
      return {
        projectId: over.projectId,
        status: over.status,
        comment: over.comment ?? 'ok',
        createdAt: over.createdAt,
        project: {
          name: over.name ?? over.projectId,
          clientName: 'C',
          status: 'Active',
          aiOutput:
            over.savedAt === null
              ? null
              : JSON.stringify({ savedAt: over.savedAt ?? '2026-01-01T00:00:00Z' }),
        },
      };
    }

    it('returns [] when no userId on the request', async () => {
      expect(await controller.listMyReviews(reqAs(undefined))).toEqual([]);
    });

    it('returns the latest verdict per project — including approved ones', async () => {
      mockPrisma.cahierFeedback.findMany.mockResolvedValue([
        feedbackRow({ projectId: 'p1', status: 'approved', createdAt: new Date('2026-02-01') }),
      ]);
      const rows = await controller.listMyReviews(reqAs('u1'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        projectId: 'p1',
        verdict: 'approved',
        isCurrent: true,
      });
    });

    it('collapses multiple feedback rows to the newest per project', async () => {
      // findMany is ordered desc, so the first row per project is the latest.
      mockPrisma.cahierFeedback.findMany.mockResolvedValue([
        feedbackRow({ projectId: 'p1', status: 'approved', createdAt: new Date('2026-02-10') }),
        feedbackRow({ projectId: 'p1', status: 'rejected', createdAt: new Date('2026-01-05') }),
      ]);
      const rows = await controller.listMyReviews(reqAs('u1'));
      expect(rows).toHaveLength(1);
      expect(rows[0].verdict).toBe('approved');
    });

    it('flags isCurrent=false when the cahier was re-saved after the verdict', async () => {
      mockPrisma.cahierFeedback.findMany.mockResolvedValue([
        feedbackRow({
          projectId: 'p1',
          status: 'approved',
          createdAt: new Date('2026-01-01'),
          savedAt: '2026-03-01T00:00:00Z',
        }),
      ]);
      const rows = await controller.listMyReviews(reqAs('u1'));
      expect(rows[0].isCurrent).toBe(false);
    });

    it('treats a null/malformed cahier as current (isCurrent=true)', async () => {
      mockPrisma.cahierFeedback.findMany.mockResolvedValue([
        feedbackRow({ projectId: 'p1', status: 'rejected', createdAt: new Date('2026-01-01'), savedAt: null }),
      ]);
      const rows = await controller.listMyReviews(reqAs('u1'));
      expect(rows[0].isCurrent).toBe(true);
      expect(rows[0].verdict).toBe('rejected');
    });
  });
});
