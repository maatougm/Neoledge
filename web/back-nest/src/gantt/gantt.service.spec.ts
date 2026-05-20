import { Test, TestingModule } from '@nestjs/testing';
import { GanttService } from './gantt.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  workPackage: { findMany: jest.fn() },
  milestone: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  ganttBaseline: {
    findMany: jest.fn(),
    count: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

describe('GanttService', () => {
  let service: GanttService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GanttService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(GanttService);
  });

  describe('getGanttPayload', () => {
    it('returns workPackages + milestones + flattened dependencies', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'a', dependenciesOut: [{ toWpId: 'b', type: 'FS' }, { toWpId: 'c', type: 'FF' }] },
        { id: 'b', dependenciesOut: [] },
      ]);
      mockPrisma.milestone.findMany.mockResolvedValue([{ id: 'm1' }]);
      const r = await service.getGanttPayload('p1');
      expect(r.isSuccess).toBe(true);
      const payload = r.value as { dependencies: unknown[]; workPackages: unknown[]; milestones: unknown[] };
      expect(payload.dependencies).toEqual([
        { fromWpId: 'a', toWpId: 'b', type: 'FS' },
        { fromWpId: 'a', toWpId: 'c', type: 'FF' },
      ]);
      expect(payload.workPackages).toHaveLength(2);
      expect(payload.milestones).toHaveLength(1);
    });

    it('handles prisma failure', async () => {
      mockPrisma.workPackage.findMany.mockRejectedValue(new Error('DB'));
      mockPrisma.milestone.findMany.mockResolvedValue([]);
      const r = await service.getGanttPayload('p1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('listMilestones', () => {
    it('returns sorted list', async () => {
      mockPrisma.milestone.findMany.mockResolvedValue([{ id: 'm1' }]);
      const r = await service.listMilestones('p1');
      expect(r.isSuccess).toBe(true);
    });
    it('handles prisma failure', async () => {
      mockPrisma.milestone.findMany.mockRejectedValue(new Error('DB'));
      const r = await service.listMilestones('p1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('createMilestone', () => {
    it('happy path', async () => {
      mockPrisma.milestone.create.mockResolvedValue({ id: 'm1' });
      const r = await service.createMilestone('p1', { title: 'T', date: '2026-06-01' });
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.milestone.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 'p1', title: 'T', date: expect.any(Date) }),
      });
    });

    it('passes through optional fields', async () => {
      mockPrisma.milestone.create.mockResolvedValue({ id: 'm1' });
      await service.createMilestone('p1', { title: 'T', date: '2026-06-01', description: 'd', color: '#FF0000', workPackageId: 'wp1' });
      const arg = mockPrisma.milestone.create.mock.calls[0][0];
      expect(arg.data.description).toBe('d');
      expect(arg.data.color).toBe('#FF0000');
      expect(arg.data.workPackageId).toBe('wp1');
    });

    it('handles prisma failure', async () => {
      mockPrisma.milestone.create.mockRejectedValue(new Error('DB'));
      const r = await service.createMilestone('p1', { title: 'T', date: '2026-06-01' });
      expect(r.isFailure).toBe(true);
    });
  });

  describe('updateMilestone', () => {
    it('only patches provided fields', async () => {
      mockPrisma.milestone.update.mockResolvedValue({ id: 'm1' });
      await service.updateMilestone('m1', { title: 'new' });
      const arg = mockPrisma.milestone.update.mock.calls[0][0];
      expect(arg.data).toEqual({ title: 'new' });
    });

    it('coerces date to a Date', async () => {
      mockPrisma.milestone.update.mockResolvedValue({});
      await service.updateMilestone('m1', { date: '2026-12-31' });
      const arg = mockPrisma.milestone.update.mock.calls[0][0];
      expect(arg.data.date).toBeInstanceOf(Date);
    });

    it('handles isReached flip', async () => {
      mockPrisma.milestone.update.mockResolvedValue({});
      await service.updateMilestone('m1', { isReached: true });
      expect(mockPrisma.milestone.update.mock.calls[0][0].data).toEqual({ isReached: true });
    });

    it('handles prisma failure', async () => {
      mockPrisma.milestone.update.mockRejectedValue(new Error('DB'));
      const r = await service.updateMilestone('m1', { title: 'x' });
      expect(r.isFailure).toBe(true);
    });
  });

  describe('deleteMilestone', () => {
    it('happy path without projectId check', async () => {
      mockPrisma.milestone.delete.mockResolvedValue({});
      const r = await service.deleteMilestone('m1');
      expect(r.isSuccess).toBe(true);
    });

    it('cross-project guard rejects', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue({ projectId: 'other' });
      const r = await service.deleteMilestone('m1', 'p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/hors projet/);
    });

    it('not-found inside guard', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(null);
      const r = await service.deleteMilestone('missing', 'p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/introuvable/);
    });

    it('matching projectId allows delete', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue({ projectId: 'p1' });
      mockPrisma.milestone.delete.mockResolvedValue({});
      const r = await service.deleteMilestone('m1', 'p1');
      expect(r.isSuccess).toBe(true);
    });
  });

  describe('markMilestoneReached', () => {
    it('no-op when already reached', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ projectId: 'p1', isReached: true });
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ id: 'm1', isReached: true });
      const r = await service.markMilestoneReached('m1', 'p1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.milestone.updateMany).not.toHaveBeenCalled();
    });

    it('atomic transition flips it', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ projectId: 'p1', isReached: false });
      mockPrisma.milestone.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ id: 'm1', isReached: true });
      const r = await service.markMilestoneReached('m1', 'p1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.milestone.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', isReached: false },
        data: { isReached: true },
      });
    });

    it('lost-race returns the row anyway', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ projectId: 'p1', isReached: false });
      mockPrisma.milestone.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.milestone.findUnique.mockResolvedValueOnce({ id: 'm1', isReached: true });
      const r = await service.markMilestoneReached('m1', 'p1');
      expect(r.isSuccess).toBe(true);
    });

    it('fails on not-found', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue(null);
      const r = await service.markMilestoneReached('missing', 'p1');
      expect(r.isFailure).toBe(true);
    });

    it('rejects mismatched projectId', async () => {
      mockPrisma.milestone.findUnique.mockResolvedValue({ projectId: 'other', isReached: false });
      const r = await service.markMilestoneReached('m1', 'p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/hors projet/);
    });
  });

  describe('captureBaseline', () => {
    it('rejects empty name', async () => {
      const r = await service.captureBaseline('p1', '   ', 'u1');
      expect(r.isFailure).toBe(true);
    });

    it('rejects name > 120 chars', async () => {
      const r = await service.captureBaseline('p1', 'x'.repeat(121), 'u1');
      expect(r.isFailure).toBe(true);
    });

    it('rejects duplicate snapshotName', async () => {
      mockPrisma.ganttBaseline.count.mockResolvedValue(1);
      const r = await service.captureBaseline('p1', 'S1', 'u1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/déjà utilisé/);
    });

    it('happy path captures one row per WP', async () => {
      mockPrisma.ganttBaseline.count.mockResolvedValue(0);
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'wp1', startDate: new Date(), dueDate: new Date(), estimatedHours: 5, percentDone: 10 },
        { id: 'wp2', startDate: null, dueDate: null, estimatedHours: null, percentDone: 0 },
      ]);
      mockPrisma.ganttBaseline.createMany.mockResolvedValue({ count: 2 });
      const r = await service.captureBaseline('p1', 'S1', 'u1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({ snapshotName: 'S1', count: 2 });
    });

    it('handles concurrent capture P2002 race', async () => {
      mockPrisma.ganttBaseline.count.mockResolvedValue(0);
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      mockPrisma.ganttBaseline.createMany.mockRejectedValue({ code: 'P2002' });
      const r = await service.captureBaseline('p1', 'S1', 'u1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/déjà utilisé/);
    });

    it('generic failure path', async () => {
      mockPrisma.ganttBaseline.count.mockResolvedValue(0);
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      mockPrisma.ganttBaseline.createMany.mockRejectedValue(new Error('boom'));
      const r = await service.captureBaseline('p1', 'S1', 'u1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('listBaselines', () => {
    it('groups by snapshotName', async () => {
      mockPrisma.ganttBaseline.groupBy.mockResolvedValue([
        { snapshotName: 'S1', _min: { snapshotDate: new Date() }, _count: { _all: 5 } },
      ]);
      const r = await service.listBaselines('p1');
      expect(r.isSuccess).toBe(true);
      expect((r.value as unknown[])[0]).toEqual(expect.objectContaining({ snapshotName: 'S1', wpCount: 5 }));
    });

    it('handles failure', async () => {
      mockPrisma.ganttBaseline.groupBy.mockRejectedValue(new Error('DB'));
      const r = await service.listBaselines('p1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('deleteBaseline', () => {
    it('happy path', async () => {
      mockPrisma.ganttBaseline.deleteMany.mockResolvedValue({ count: 5 });
      const r = await service.deleteBaseline('p1', 'S1');
      expect(r.isSuccess).toBe(true);
    });
    it('handles failure', async () => {
      mockPrisma.ganttBaseline.deleteMany.mockRejectedValue(new Error('DB'));
      const r = await service.deleteBaseline('p1', 'S1');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('compareBaseline', () => {
    it('marks deleted WPs and computes deltas', async () => {
      mockPrisma.ganttBaseline.findMany.mockResolvedValue([
        { workPackageId: 'wp1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-02-01'), percentDone: 0, estimatedHours: 10 },
        { workPackageId: 'wp2', startDate: null, dueDate: null, percentDone: 0, estimatedHours: null },
      ]);
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'wp1', title: 'Task1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-02-08'), percentDone: 50, estimatedHours: 12 },
      ]);
      const r = await service.compareBaseline('p1', 'S1');
      expect(r.isSuccess).toBe(true);
      const drift = r.value as Array<Record<string, unknown>>;
      const w1 = drift.find((d) => d['workPackageId'] === 'wp1')!;
      expect(w1['delta']).toBe(7);
      expect(w1['percentDoneDelta']).toBe(50);
      expect(w1['estimatedHoursDelta']).toBe(2);
      const w2 = drift.find((d) => d['workPackageId'] === 'wp2')!;
      expect(w2['deleted']).toBe(true);
      expect(w2['title']).toBe('(deleted)');
    });

    it('handles failure', async () => {
      mockPrisma.ganttBaseline.findMany.mockRejectedValue(new Error('DB'));
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      const r = await service.compareBaseline('p1', 'S1');
      expect(r.isFailure).toBe(true);
    });
  });
});
