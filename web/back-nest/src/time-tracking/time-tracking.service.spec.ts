import { Test, TestingModule } from '@nestjs/testing';
import { TimeTrackingService } from './time-tracking.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  timeEntry: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
  },
  workPackage: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TimeEntryRow {
  id: string;
  userId: string;
  projectId: string;
  workPackageId: string | null;
  hours: number;
  spentOn: Date;
  activity: string;
  comment: string | null;
  isBillable: boolean;
  lockedAt: Date | null;
  createdAt: Date;
  user?: { id: string; firstName: string; lastName: string };
}

function makeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: 'te-1',
    userId: 'user-1',
    projectId: 'proj-1',
    workPackageId: null,
    hours: 2,
    spentOn: new Date('2026-05-12T00:00:00Z'),
    activity: 'development',
    comment: null,
    isBillable: true,
    lockedAt: null,
    createdAt: new Date('2026-05-12T08:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimeTrackingService', () => {
  let service: TimeTrackingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TimeTrackingService>(TimeTrackingService);
  });

  // ── findMyEntries ─────────────────────────────────────────────────────────

  describe('findMyEntries', () => {
    it('scopes the query strictly to the caller userId', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      const r = await service.findMyEntries('user-1');
      expect(r.isSuccess).toBe(true);
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { userId: string } };
      expect(call.where.userId).toBe('user-1');
    });

    it('applies projectId and workPackageId filters when provided', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findMyEntries('user-1', { projectId: 'proj-1', workPackageId: 'wp-1' });
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { projectId: string; workPackageId: string } };
      expect(call.where.projectId).toBe('proj-1');
      expect(call.where.workPackageId).toBe('wp-1');
    });

    it('applies a date range when from and to are provided', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findMyEntries('user-1', { from: '2026-05-01', to: '2026-05-31' });
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { spentOn: { gte: Date; lte: Date } } };
      expect(call.where.spentOn.gte).toBeInstanceOf(Date);
      expect(call.where.spentOn.lte).toBeInstanceOf(Date);
    });

    it('applies only "gte" when only "from" is provided', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findMyEntries('user-1', { from: '2026-05-01' });
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { spentOn: { gte?: Date; lte?: Date } } };
      expect(call.where.spentOn.gte).toBeInstanceOf(Date);
      expect(call.where.spentOn.lte).toBeUndefined();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.timeEntry.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.findMyEntries('user-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec du chargement.');
    });
  });

  // ── findProjectEntries ────────────────────────────────────────────────────

  describe('findProjectEntries', () => {
    it('scopes by projectId and optional userId', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findProjectEntries('proj-1', { userId: 'user-1' });
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { projectId: string; userId: string } };
      expect(call.where.projectId).toBe('proj-1');
      expect(call.where.userId).toBe('user-1');
    });

    it('passes the date range when from/to provided', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findProjectEntries('proj-1', { from: '2026-01-01', to: '2026-12-31' });
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { spentOn: { gte: Date; lte: Date } } };
      expect(call.where.spentOn.gte).toBeInstanceOf(Date);
      expect(call.where.spentOn.lte).toBeInstanceOf(Date);
    });

    it('returns failure on Prisma error', async () => {
      mockPrisma.timeEntry.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.findProjectEntries('proj-1');
      expect(r.isFailure).toBe(true);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when hours <= 0', async () => {
      const r = await service.create('user-1', { projectId: 'proj-1', hours: 0, spentOn: '2026-05-12' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Heures invalides (0-24).');
      expect(mockPrisma.timeEntry.create).not.toHaveBeenCalled();
    });

    it('rejects when hours > 24', async () => {
      const r = await service.create('user-1', { projectId: 'proj-1', hours: 25, spentOn: '2026-05-12' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Heures invalides (0-24).');
    });

    it('creates the entry with defaults (activity, isBillable)', async () => {
      const created = makeEntry();
      mockPrisma.timeEntry.create.mockResolvedValue(created);
      const r = await service.create('user-1', { projectId: 'proj-1', hours: 4, spentOn: '2026-05-12' });
      expect(r.isSuccess).toBe(true);
      const call = mockPrisma.timeEntry.create.mock.calls[0][0] as { data: { userId: string; activity: string; isBillable: boolean; workPackageId: null; comment: null } };
      expect(call.data.userId).toBe('user-1');
      expect(call.data.activity).toBe('development');
      expect(call.data.isBillable).toBe(true);
      expect(call.data.workPackageId).toBeNull();
      expect(call.data.comment).toBeNull();
    });

    it('writes the user-provided activity, comment, and isBillable values', async () => {
      mockPrisma.timeEntry.create.mockResolvedValue(makeEntry());
      await service.create('user-1', {
        projectId: 'proj-1',
        hours: 2,
        spentOn: '2026-05-12',
        activity: 'meeting',
        comment: 'kickoff',
        isBillable: false,
      });
      const call = mockPrisma.timeEntry.create.mock.calls[0][0] as { data: { activity: string; comment: string; isBillable: boolean } };
      expect(call.data.activity).toBe('meeting');
      expect(call.data.comment).toBe('kickoff');
      expect(call.data.isBillable).toBe(false);
    });

    it('aggregates timeEntry.hours and updates workPackage.spentHours when a workPackageId is supplied', async () => {
      mockPrisma.timeEntry.create.mockResolvedValue(makeEntry({ workPackageId: 'wp-1' }));
      mockPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: 7 } });
      mockPrisma.workPackage.update.mockResolvedValue({});
      await service.create('user-1', { projectId: 'proj-1', workPackageId: 'wp-1', hours: 4, spentOn: '2026-05-12' });
      expect(mockPrisma.timeEntry.aggregate).toHaveBeenCalledWith({
        where: { workPackageId: 'wp-1' },
        _sum: { hours: true },
      });
      expect(mockPrisma.workPackage.update).toHaveBeenCalledWith({
        where: { id: 'wp-1' },
        data: { spentHours: 7 },
      });
    });

    it('handles aggregate returning null sum (no other entries) by writing spentHours=0', async () => {
      mockPrisma.timeEntry.create.mockResolvedValue(makeEntry({ workPackageId: 'wp-1' }));
      mockPrisma.timeEntry.aggregate.mockResolvedValue({ _sum: { hours: null } });
      mockPrisma.workPackage.update.mockResolvedValue({});
      await service.create('user-1', { projectId: 'proj-1', workPackageId: 'wp-1', hours: 4, spentOn: '2026-05-12' });
      const call = mockPrisma.workPackage.update.mock.calls[0][0] as { data: { spentHours: number } };
      expect(call.data.spentHours).toBe(0);
    });

    it('does NOT touch workPackage.update when no workPackageId is given', async () => {
      mockPrisma.timeEntry.create.mockResolvedValue(makeEntry());
      await service.create('user-1', { projectId: 'proj-1', hours: 2, spentOn: '2026-05-12' });
      expect(mockPrisma.workPackage.update).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.timeEntry.create.mockRejectedValue(new Error('DB down'));
      const r = await service.create('user-1', { projectId: 'proj-1', hours: 2, spentOn: '2026-05-12' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec de la saisie.');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('returns failure when the entry does not exist', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(null);
      const r = await service.update('te-1', 'user-1', { hours: 3 });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Saisie introuvable.');
    });

    it('refuses to update an entry owned by a different user', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(makeEntry({ userId: 'other-user' }));
      const r = await service.update('te-1', 'user-1', { hours: 3 });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Accès refusé.');
      expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
    });

    it('rejects reassignment to a WP from another project', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry({ projectId: 'proj-1' }));
      mockPrisma.workPackage.findUnique.mockResolvedValue({ id: 'wp-other', projectId: 'proj-2', isDeleted: false });
      const r = await service.update('te-1', 'user-1', { workPackageId: 'wp-other' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Le work package appartient à un autre projet.');
      expect(mockPrisma.timeEntry.updateMany).not.toHaveBeenCalled();
    });

    it('rejects reassignment when the target WP does not exist', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      mockPrisma.workPackage.findUnique.mockResolvedValue(null);
      const r = await service.update('te-1', 'user-1', { workPackageId: 'wp-missing' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Work package introuvable.');
    });

    it('rejects reassignment when the target WP is soft-deleted', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry({ projectId: 'proj-1' }));
      mockPrisma.workPackage.findUnique.mockResolvedValue({ id: 'wp-1', projectId: 'proj-1', isDeleted: true });
      const r = await service.update('te-1', 'user-1', { workPackageId: 'wp-1' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Work package supprimé.');
    });

    it('returns failure when the row is locked or vanished between read and write (count=0)', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 0 });
      const r = await service.update('te-1', 'user-1', { hours: 5 });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Saisie verrouillée ou introuvable.');
    });

    it('atomic lock check: updateMany predicate filters on lockedAt: null', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry({ hours: 5 }));
      await service.update('te-1', 'user-1', { hours: 5 });
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as { where: { id: string; userId: string; lockedAt: null } };
      expect(call.where).toEqual({ id: 'te-1', userId: 'user-1', lockedAt: null });
    });

    it('builds the data payload only from the fields supplied in the DTO', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry({ hours: 5 }));
      await service.update('te-1', 'user-1', { hours: 5, comment: 'edit' });
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(Object.keys(call.data).sort()).toEqual(['comment', 'hours']);
      expect(call.data.hours).toBe(5);
      expect(call.data.comment).toBe('edit');
    });

    it('coerces spentOn from string to Date in the data payload', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry());
      await service.update('te-1', 'user-1', { spentOn: '2026-05-13' });
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as { data: { spentOn: Date } };
      expect(call.data.spentOn).toBeInstanceOf(Date);
    });

    it('happy path: returns the refetched updated entry', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(makeEntry({ hours: 2 }));
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 1 });
      const fresh = makeEntry({ hours: 5 });
      mockPrisma.timeEntry.findUnique.mockResolvedValueOnce(fresh);
      const r = await service.update('te-1', 'user-1', { hours: 5 });
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(fresh);
    });

    it('returns failure when Prisma throws unexpectedly', async () => {
      mockPrisma.timeEntry.findUnique.mockRejectedValue(new Error('DB down'));
      const r = await service.update('te-1', 'user-1', { hours: 3 });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec de la mise à jour.');
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('returns failure when the entry does not exist', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(null);
      const r = await service.delete('te-1', 'user-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Saisie introuvable.');
    });

    it('refuses to delete an entry owned by a different user', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(makeEntry({ userId: 'other-user' }));
      const r = await service.delete('te-1', 'user-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Accès refusé.');
      expect(mockPrisma.timeEntry.deleteMany).not.toHaveBeenCalled();
    });

    it('returns failure when the row is locked (deleteMany count=0)', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(makeEntry());
      mockPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 0 });
      const r = await service.delete('te-1', 'user-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Saisie verrouillée ou introuvable.');
    });

    it('atomic lock check: deleteMany predicate filters on lockedAt: null', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(makeEntry());
      mockPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 1 });
      await service.delete('te-1', 'user-1');
      const call = mockPrisma.timeEntry.deleteMany.mock.calls[0][0] as { where: { id: string; userId: string; lockedAt: null } };
      expect(call.where).toEqual({ id: 'te-1', userId: 'user-1', lockedAt: null });
    });

    it('happy path: returns success when one row was deleted', async () => {
      mockPrisma.timeEntry.findUnique.mockResolvedValue(makeEntry());
      mockPrisma.timeEntry.deleteMany.mockResolvedValue({ count: 1 });
      const r = await service.delete('te-1', 'user-1');
      expect(r.isSuccess).toBe(true);
    });

    it('returns failure when Prisma throws unexpectedly', async () => {
      mockPrisma.timeEntry.findUnique.mockRejectedValue(new Error('DB down'));
      const r = await service.delete('te-1', 'user-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec de la suppression.');
    });
  });

  // ── getWeeklyGrid ─────────────────────────────────────────────────────────

  describe('getWeeklyGrid', () => {
    it('rejects malformed weekStart values', async () => {
      const r = await service.getWeeklyGrid('user-1', '2026/05/12');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('weekStart doit être au format YYYY-MM-DD.');
      expect(mockPrisma.timeEntry.findMany).not.toHaveBeenCalled();
    });

    it('rejects partial date strings', async () => {
      const r = await service.getWeeklyGrid('user-1', '2026-05');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('weekStart doit être au format YYYY-MM-DD.');
    });

    it('returns the entries within a 7-day window scoped to the user', async () => {
      const e = makeEntry();
      mockPrisma.timeEntry.findMany.mockResolvedValue([e]);
      const r = await service.getWeeklyGrid('user-1', '2026-05-11');
      expect(r.isSuccess).toBe(true);
      const grid = r.value as { entries: unknown[]; start: string; timezone: string };
      expect(grid?.entries).toEqual([e]);
      expect(grid?.start).toBe('2026-05-11');
      const call = mockPrisma.timeEntry.findMany.mock.calls[0][0] as { where: { userId: string; spentOn: { gte: Date; lte: Date } } };
      expect(call.where.userId).toBe('user-1');
      expect(call.where.spentOn.gte).toBeInstanceOf(Date);
      expect(call.where.spentOn.lte).toBeInstanceOf(Date);
      // 6 full days between the boundaries
      const diff = call.where.spentOn.lte.getTime() - call.where.spentOn.gte.getTime();
      expect(diff).toBe(6 * 86_400_000);
    });

    it('defaults the timezone to Europe/Paris when not supplied', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      const r = await service.getWeeklyGrid('user-1', '2026-05-11');
      expect((r.value as { timezone: string })?.timezone).toBe('Europe/Paris');
    });

    it('uses a supplied timezone in the result envelope', async () => {
      mockPrisma.timeEntry.findMany.mockResolvedValue([]);
      const r = await service.getWeeklyGrid('user-1', '2026-05-11', 'America/New_York');
      expect((r.value as { timezone: string })?.timezone).toBe('America/New_York');
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.timeEntry.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.getWeeklyGrid('user-1', '2026-05-11');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec du chargement de la semaine.');
    });
  });

  // ── getSummary ────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    it('aggregates hours by user and by activity, with a grand total', async () => {
      const e1 = makeEntry({ id: 'a', userId: 'u1', hours: 3, activity: 'development', user: { id: 'u1', firstName: 'Alice', lastName: 'A' } });
      const e2 = makeEntry({ id: 'b', userId: 'u1', hours: 2, activity: 'meeting',     user: { id: 'u1', firstName: 'Alice', lastName: 'A' } });
      const e3 = makeEntry({ id: 'c', userId: 'u2', hours: 4, activity: 'development', user: { id: 'u2', firstName: 'Bob',   lastName: 'B' } });
      mockPrisma.timeEntry.findMany.mockResolvedValue([e1, e2, e3]);
      const r = await service.getSummary('proj-1');
      expect(r.isSuccess).toBe(true);
      const summary = r.value as { total: number; byUser: { userId: string; name: string; hours: number }[]; byActivity: { activity: string; hours: number }[] };
      expect(summary?.total).toBe(9);
      const alice = summary?.byUser.find((u) => u.userId === 'u1');
      const bob = summary?.byUser.find((u) => u.userId === 'u2');
      expect(alice?.hours).toBe(5);
      expect(alice?.name).toBe('Alice A');
      expect(bob?.hours).toBe(4);
      const dev = summary?.byActivity.find((a) => a.activity === 'development');
      const meet = summary?.byActivity.find((a) => a.activity === 'meeting');
      expect(dev?.hours).toBe(7);
      expect(meet?.hours).toBe(2);
    });

    it('orders byUser descending by hours', async () => {
      const small = makeEntry({ id: 'a', userId: 'u1', hours: 1, user: { id: 'u1', firstName: 'A', lastName: 'A' } });
      const big   = makeEntry({ id: 'b', userId: 'u2', hours: 9, user: { id: 'u2', firstName: 'B', lastName: 'B' } });
      mockPrisma.timeEntry.findMany.mockResolvedValue([small, big]);
      const r = await service.getSummary('proj-1');
      expect((r.value as { byUser: { userId: string }[] })?.byUser.map((u) => u.userId)).toEqual(['u2', 'u1']);
    });

    it('falls back to "Unknown" when the relation is missing', async () => {
      const orphan = makeEntry({ id: 'a', userId: 'u-ghost', hours: 1, user: undefined });
      mockPrisma.timeEntry.findMany.mockResolvedValue([orphan]);
      const r = await service.getSummary('proj-1');
      expect((r.value as { byUser: { name: string }[] })?.byUser[0].name).toBe('Unknown');
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.timeEntry.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.getSummary('proj-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec du résumé.');
    });
  });

  // ── lockPeriod ────────────────────────────────────────────────────────────

  describe('lockPeriod', () => {
    it('locks every unlocked entry in the range and returns the count', async () => {
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 42 });
      const r = await service.lockPeriod('2026-05-01', '2026-05-31');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({ count: 42 });
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as {
        where: { spentOn: { gte: Date; lte: Date }; lockedAt: null; userId?: string };
        data: { lockedAt: Date };
      };
      expect(call.where.lockedAt).toBeNull();
      expect(call.where.spentOn.gte).toBeInstanceOf(Date);
      expect(call.where.spentOn.lte).toBeInstanceOf(Date);
      expect(call.where.userId).toBeUndefined();
      expect(call.data.lockedAt).toBeInstanceOf(Date);
    });

    it('scopes by userId when supplied', async () => {
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 3 });
      await service.lockPeriod('2026-05-01', '2026-05-31', 'user-1');
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as { where: { userId: string } };
      expect(call.where.userId).toBe('user-1');
    });

    it('does NOT relock entries already locked (predicate lockedAt: null)', async () => {
      mockPrisma.timeEntry.updateMany.mockResolvedValue({ count: 0 });
      await service.lockPeriod('2026-05-01', '2026-05-31');
      const call = mockPrisma.timeEntry.updateMany.mock.calls[0][0] as { where: { lockedAt: null } };
      expect(call.where.lockedAt).toBeNull();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.timeEntry.updateMany.mockRejectedValue(new Error('DB down'));
      const r = await service.lockPeriod('2026-05-01', '2026-05-31');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec du verrouillage.');
    });
  });
});
