/**
 * @file projects.service.spec.ts — unit tests for the biggest service in
 * the repo (~1000 lines). Focused on the highest-risk public methods:
 * findWithFilters, getById, create, update, softDelete/restore/hardDelete,
 * assignManager, updateStatus, saveFieldValues (and the indexer hook),
 * the bulk operations, and a couple of helpers (toSummary / exportToCsv).
 *
 * Per CLAUDE.md: every Prisma method touched by a covered code path is
 * mocked on `mockPrisma`. `$transaction(fn)` is intercepted so `fn(tx)`
 * runs against the same mocked client — no real DB.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PhaseGateService } from './phase-gate.service';
import { AuditService } from '../audit/audit.service';
import { AnalyticsCacheService } from '../analytics/analytics-cache.service';
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service';
import { Result } from '../common/result';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  project: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    delete: jest.fn(),
  },
  projectField: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    aggregate: jest.fn(),
    deleteMany: jest.fn(),
  },
  projectFieldValue: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  projectActivity: {
    findMany: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    deleteMany: jest.fn(),
  },
  projectValidation: {
    deleteMany: jest.fn(),
  },
  projectMember: {
    findFirst: jest.fn(),
  },
  appUser: {
    findUnique: jest.fn(),
  },
  notification: {
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockNotifications: any = {
  notify: jest.fn().mockResolvedValue(undefined),
  notifyEnhanced: jest.fn().mockResolvedValue(undefined),
};

const mockPhaseGate: any = {
  canTransition: jest.fn().mockResolvedValue(Result.ok()),
};

const mockAudit: any = {
  log: jest.fn().mockResolvedValue(undefined),
};

const mockAnalyticsCache: any = {
  invalidate: jest.fn().mockResolvedValue(undefined),
};

const mockEmbeddingIndexer: any = {
  indexAndStore: jest.fn().mockResolvedValue({ indexed: 0, failed: 0 }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProjectRow(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'p1',
    name: 'Demo',
    clientName: 'ACME',
    status: 'Active',
    priority: 'Normal',
    isDeleted: false,
    deletedAt: null,
    deletedByUserId: null,
    projectManagerId: 'pm-1',
    projectManager: { id: 'pm-1', firstName: 'PM', lastName: 'One', email: 'pm@x', role: 'ProjectManager' },
    workPackages: [],
    fields: [],
    fieldValues: [],
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-06-30'),
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2025-12-01'),
    aiOutput: null,
    currentPhaseEnteredAt: new Date('2025-12-01'),
    ...overrides,
  };
}

/** Default $transaction implementation: call the callback with the
 *  same mockPrisma instance so tx.* === prisma.*. Returns whatever the
 *  callback returned. */
function bindTransaction() {
  mockPrisma.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    // Array form — return resolved values in order.
    if (Array.isArray(arg)) return Promise.all(arg);
    return arg;
  });
}

// ─── Test harness ────────────────────────────────────────────────────────────

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    bindTransaction();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: PhaseGateService, useValue: mockPhaseGate },
        { provide: AuditService, useValue: mockAudit },
        { provide: AnalyticsCacheService, useValue: mockAnalyticsCache },
        { provide: EmbeddingIndexerService, useValue: mockEmbeddingIndexer },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  // ─── findWithFilters ───────────────────────────────────────────────────────

  describe('findWithFilters', () => {
    it('applies default pagination (skip=0, take=20) and filters out soft-deleted', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      const r = await service.findWithFilters('u-1', {});

      expect(r.isSuccess).toBe(true);
      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ isDeleted: false });
      expect(call.skip).toBe(0);
      expect(call.take).toBe(20);
    });

    it('clamps take to [1, 100]', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('u-1', { take: 9999 });
      expect(mockPrisma.project.findMany.mock.calls[0][0].take).toBe(100);

      jest.clearAllMocks();
      bindTransaction();
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('u-1', { take: 0 });
      expect(mockPrisma.project.findMany.mock.calls[0][0].take).toBe(1);
    });

    it('passes the status[] filter into where.status.in', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('u-1', { status: ['Active', 'Planning'] });

      const where = mockPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ in: ['Active', 'Planning'] });
    });

    it('uses projectManagerId when assignedToMe=true', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('me-pm', { assignedToMe: true });

      const where = mockPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.projectManagerId).toBe('me-pm');
    });

    it('passes search across name + clientName via OR', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('u-1', { search: 'GED' });

      const where = mockPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { name: { contains: 'GED' } },
        { clientName: { contains: 'GED' } },
      ]);
    });

    it('applies dateRange.from + to onto startDate gte/lte', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.findWithFilters('u-1', { dateRange: { from: '2026-01-01', to: '2026-12-31' } });

      const where = mockPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.startDate.gte).toEqual(new Date('2026-01-01'));
      expect(where.startDate.lte).toEqual(new Date('2026-12-31'));
    });

    it('returns items mapped through toSummary (computes progressPct)', async () => {
      // 4 WPs total, 2 in TERMINAL_WP_STATUSES (Resolved/Closed) → 50%
      mockPrisma.project.findMany.mockResolvedValue([
        makeProjectRow({
          id: 'p1',
          workPackages: [
            { status: 'Open' }, { status: 'InProgress' },
            { status: 'Resolved' }, { status: 'Closed' },
          ],
        }),
      ]);
      mockPrisma.project.count.mockResolvedValue(1);

      const r = await service.findWithFilters('u-1', {});

      expect(r.isSuccess).toBe(true);
      const items = (r.value as any).items;
      expect(items[0].progressPct).toBe(50);
      expect(items[0].wpTotal).toBe(4);
      expect(items[0].wpClosed).toBe(2);
      expect(items[0].projectManagerName).toBe('PM One');
    });

    it('returns 0% progress when project has no WPs', async () => {
      mockPrisma.project.findMany.mockResolvedValue([makeProjectRow({ workPackages: [] })]);
      mockPrisma.project.count.mockResolvedValue(1);

      const r = await service.findWithFilters('u-1', {});
      expect((r.value as any).items[0].progressPct).toBe(0);
    });
  });

  // ─── getProjectsPaged ──────────────────────────────────────────────────────

  describe('getProjectsPaged', () => {
    it('clamps take to [1, 100]', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.getProjectsPaged(0, 9999, undefined, undefined);
      expect(mockPrisma.project.findMany.mock.calls[0][0].take).toBe(100);
    });

    it('applies the status equality filter', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.getProjectsPaged(0, 10, undefined, 'Archived');

      const where = mockPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('Archived');
    });
  });

  // ─── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns toDetail() when the project exists', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({
        fields: [{ id: 'f1', label: 'L1', fieldType: 'Text', isRequired: true, orderIndex: 0, fieldCategory: 'Static' }],
        fieldValues: [{ projectFieldId: 'f1', value: 'v', updatedAt: new Date(), updatedBy: 'u', field: { label: 'L1' } }],
      }));

      const r = await service.getById('p1');

      expect(r.isSuccess).toBe(true);
      const detail = r.value as any;
      expect(detail.id).toBe('p1');
      expect(detail.fields).toHaveLength(1);
      expect(detail.fieldValues[0].label).toBe('L1');
      expect(mockPrisma.project.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', isDeleted: false });
    });

    it('returns Result.fail when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.getById('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Projet non trouvé.');
    });
  });

  // ─── getByManager / getByStatus ────────────────────────────────────────────

  describe('getByManager', () => {
    it('scopes the query to the given managerId and not-deleted', async () => {
      mockPrisma.project.findMany.mockResolvedValue([makeProjectRow()]);

      const r = await service.getByManager('pm-1');

      expect(r.isSuccess).toBe(true);
      expect((r.value as any[]).length).toBe(1);
      expect(mockPrisma.project.findMany.mock.calls[0][0].where).toEqual({
        projectManagerId: 'pm-1',
        isDeleted: false,
      });
    });
  });

  describe('getByStatus', () => {
    it('clamps take to [1, 200]', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.getByStatus('Active', 0, 9999);
      expect(mockPrisma.project.findMany.mock.calls[0][0].take).toBe(200);
    });

    it('rejects negative skip by clamping to 0', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);
      mockPrisma.project.count.mockResolvedValue(0);

      await service.getByStatus('Active', -50, 10);
      expect(mockPrisma.project.findMany.mock.calls[0][0].skip).toBe(0);
    });
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when endDate <= startDate', async () => {
      const r = await service.create('admin-1', {
        name: 'P', clientName: 'C',
        startDate: '2026-06-01', endDate: '2026-01-01',
        projectManagerId: 'pm-1',
      });
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('date de fin');
      // No transaction opened.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates project + 7 seeded fields + activity row in one transaction', async () => {
      mockPrisma.project.create.mockResolvedValue({ id: 'new-p1', name: 'P' });
      mockPrisma.projectField.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `f-${data.orderIndex}`, ...data }),
      );
      mockPrisma.projectFieldValue.create.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ id: 'new-p1' }));

      const r = await service.create('admin-1', {
        name: 'P', clientName: 'C',
        startDate: '2026-01-01', endDate: '2026-06-30',
        projectManagerId: 'pm-1',
      });

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.create).toHaveBeenCalledTimes(1);
      // 7 static fields → 7 field creates + 7 placeholder value rows
      expect(mockPrisma.projectField.create).toHaveBeenCalledTimes(7);
      expect(mockPrisma.projectFieldValue.create).toHaveBeenCalledTimes(7);
      expect(mockPrisma.projectActivity.create).toHaveBeenCalledTimes(1);
    });

    it('notifies the assigned PM (different from admin) via notifyEnhanced', async () => {
      mockPrisma.project.create.mockResolvedValue({ id: 'new-p1', name: 'New' });
      mockPrisma.projectField.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `f-${data.orderIndex}`, ...data }),
      );
      mockPrisma.projectFieldValue.create.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ id: 'new-p1' }));

      await service.create('admin-1', {
        name: 'New', clientName: 'C',
        startDate: '2026-01-01', endDate: '2026-06-30',
        projectManagerId: 'pm-2',
      });
      // Fire-and-forget — schedule the microtask + await it.
      await Promise.resolve();
      await Promise.resolve();

      expect(mockNotifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'pm-2',
          type: 'project_assigned',
          projectId: 'new-p1',
          actorId: 'admin-1',
        }),
      );
    });

    it('does NOT notify when the admin assigns themselves', async () => {
      mockPrisma.project.create.mockResolvedValue({ id: 'p-self', name: 'Self' });
      mockPrisma.projectField.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `f-${data.orderIndex}`, ...data }),
      );
      mockPrisma.projectFieldValue.create.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ id: 'p-self' }));

      await service.create('admin-1', {
        name: 'Self', clientName: 'C',
        startDate: '2026-01-01', endDate: '2026-06-30',
        projectManagerId: 'admin-1',
      });
      await Promise.resolve();

      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('rejects when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.update('missing', { name: 'X' });
      expect(r.isFailure).toBe(true);
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
    });

    it('re-validates the date invariant after applying the patch', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-06-30'),
      }));

      // Try to move endDate before existing startDate.
      const r = await service.update('p1', { endDate: '2025-12-31' });

      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('date de fin');
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
    });

    it('only patches fields explicitly provided', async () => {
      mockPrisma.project.findFirst
        .mockResolvedValueOnce(makeProjectRow())
        .mockResolvedValueOnce(makeProjectRow({ name: 'Renamed' }));
      mockPrisma.project.update.mockResolvedValue({});

      await service.update('p1', { name: 'Renamed' });

      const data = mockPrisma.project.update.mock.calls[0][0].data;
      expect(data).toEqual({ name: 'Renamed' });
      expect(data.clientName).toBeUndefined();
      expect(data.startDate).toBeUndefined();
    });
  });

  // ─── softDelete / restore / hardDelete ─────────────────────────────────────

  describe('softDelete', () => {
    it('flips isDeleted, stamps deletedAt + deletedByUserId, clears notification links', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.project.update.mockResolvedValue({});
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const r = await service.softDelete('p1', 'u-actor');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({
          isDeleted: true,
          deletedByUserId: 'u-actor',
          deletedAt: expect.any(Date),
        }),
      });
      await Promise.resolve();
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', isRead: false },
        data: { link: null },
      });
    });

    it('returns failure when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.softDelete('missing', 'u');
      expect(r.isFailure).toBe(true);
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe('restoreProjectAsync', () => {
    it('throws BadRequest when project exists but is not deleted', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(makeProjectRow({ isDeleted: false }));
      await expect(service.restoreProjectAsync('p1')).rejects.toThrow(BadRequestException);
    });

    it('returns failure when project does not exist', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      const r = await service.restoreProjectAsync('missing');
      expect(r.isFailure).toBe(true);
    });

    it('restores when the project is soft-deleted', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(makeProjectRow({ isDeleted: true }));
      mockPrisma.project.update.mockResolvedValue({});

      const r = await service.restoreProjectAsync('p1');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { isDeleted: false, deletedAt: null, deletedByUserId: null },
      });
    });
  });

  describe('hardDeleteProjectAsync', () => {
    it('refuses to hard-delete a row that is not soft-deleted yet', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(makeProjectRow({ isDeleted: false }));
      const r = await service.hardDeleteProjectAsync('p1', 'admin');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('soft delete');
    });

    it('cascades children inside a transaction', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(makeProjectRow({ isDeleted: true }));
      mockPrisma.projectFieldValue.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.projectField.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.projectValidation.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.projectActivity.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.project.delete.mockResolvedValue({});

      const r = await service.hardDeleteProjectAsync('p1', 'admin');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectFieldValue.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.projectField.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.projectValidation.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.projectActivity.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.project.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('returns a clean failure when the cascade transaction throws', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(makeProjectRow({ isDeleted: true }));
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('FK violation'));

      const r = await service.hardDeleteProjectAsync('p1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('dépendances');
    });
  });

  // ─── assignManager ─────────────────────────────────────────────────────────

  describe('assignManager', () => {
    it('rejects when the user is not a ProjectManager', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u', role: 'Member', isActive: true });

      const r = await service.assignManager('p1', 'u');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('chef de projet');
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
    });

    it('rejects when the PM is inactive', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'pm', role: 'ProjectManager', isActive: false });

      const r = await service.assignManager('p1', 'pm');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('désactivé');
    });

    it('updates project + writes activity + notifies the new PM on success', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ name: 'X' }));
      mockPrisma.appUser.findUnique.mockResolvedValue({
        id: 'pm-2', firstName: 'New', lastName: 'PM', role: 'ProjectManager', isActive: true,
      });
      mockPrisma.project.update.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});

      const r = await service.assignManager('p1', 'pm-2', 'actor');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.update).toHaveBeenCalledWith({
        where: { id: 'p1' }, data: { projectManagerId: 'pm-2' },
      });
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'pm-2',
        'project_assigned',
        'Nouveau projet assigné',
        expect.stringContaining('X'),
        'p1',
      );
    });

    it('returns failure when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.assignManager('missing', 'pm');
      expect(r.isFailure).toBe(true);
    });
  });

  // ─── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('is idempotent — no-op when status matches', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ status: 'Active' }));

      const r = await service.updateStatus('p1', 'Active', 'actor');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
      expect(mockPhaseGate.canTransition).not.toHaveBeenCalled();
    });

    it('rejects when the phase gate refuses', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ status: 'Active' }));
      mockPhaseGate.canTransition.mockResolvedValueOnce(Result.fail('gate closed'));

      const r = await service.updateStatus('p1', 'Completed', 'actor');

      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('gate closed');
      expect(mockPrisma.project.update).not.toHaveBeenCalled();
    });

    it('updates + stamps currentPhaseEnteredAt + busts analytics cache on success', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ status: 'Active' }));
      mockPhaseGate.canTransition.mockResolvedValueOnce(Result.ok());
      mockPrisma.project.update.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});

      const r = await service.updateStatus('p1', 'Completed', 'actor');

      expect(r.isSuccess).toBe(true);
      const data = mockPrisma.project.update.mock.calls[0][0].data;
      expect(data.status).toBe('Completed');
      expect(data.currentPhaseEnteredAt).toBeInstanceOf(Date);
      expect(mockAnalyticsCache.invalidate).toHaveBeenCalled();
    });
  });

  // ─── archive ───────────────────────────────────────────────────────────────

  describe('archive', () => {
    it('delegates to updateStatus(Archived)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ status: 'Active' }));
      mockPhaseGate.canTransition.mockResolvedValueOnce(Result.ok());
      mockPrisma.project.update.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});

      const r = await service.archive('p1', 'actor');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.project.update.mock.calls[0][0].data.status).toBe('Archived');
    });
  });

  // ─── saveFieldValues + indexer hook ────────────────────────────────────────

  describe('saveFieldValues', () => {
    it('returns failure when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.saveFieldValues('p-missing', 'u', [
        { projectFieldId: 'f1', value: 'x' },
      ]);
      expect(r.isFailure).toBe(true);
      expect(mockPrisma.projectField.findMany).not.toHaveBeenCalled();
    });

    it('rejects when a required field is null/empty BEFORE opening transaction', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([
        { id: 'f-req', label: 'Required Label', isRequired: true },
      ]);

      const r = await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f-req', value: '   ' },
      ]);

      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Required Label');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows null on a non-required field', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([
        { id: 'f-opt', label: 'Optional', isRequired: false },
      ]);
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});

      const r = await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f-opt', value: null },
      ]);

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectFieldValue.upsert).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException on optimistic-lock conflict (expectedUpdatedAt stale)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([]); // no required fields to check
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        updatedAt: new Date('2026-05-10T12:00:00Z'),
      });

      await expect(
        service.saveFieldValues('p1', 'u', [
          {
            projectFieldId: 'f1',
            value: 'newer',
            expectedUpdatedAt: '2026-05-10T11:00:00Z', // client's stamp is older → conflict
          },
        ]),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.projectFieldValue.upsert).not.toHaveBeenCalled();
    });

    it('skips the lock check when expectedUpdatedAt is absent', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});

      const r = await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f1', value: 'v' },
      ]);

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectFieldValue.findUnique).not.toHaveBeenCalled();
    });

    it('fires the embedding indexer hook with "label: value" strings for non-empty values', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});
      mockPrisma.projectFieldValue.findMany.mockResolvedValue([
        { id: 'fv-1', value: 'Vue 3 + Nest', field: { label: 'Stack' } },
      ]);

      const r = await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f-stack', value: 'Vue 3 + Nest' },
      ]);
      expect(r.isSuccess).toBe(true);

      // Fire-and-forget — drain microtasks.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledWith(
        'field-value',
        [{ id: 'fv-1', text: 'Stack: Vue 3 + Nest' }],
        { projectId: 'p1' },
      );
    });

    it('does NOT fire the indexer when all written values are empty', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.projectFieldValue.upsert.mockResolvedValue({});

      await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f1', value: '' },
        { projectFieldId: 'f2', value: '   ' },
        { projectFieldId: 'f3', value: null },
      ]);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();
    });

    it('returns failure (without throwing) when the transaction throws a non-Conflict error', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow());
      mockPrisma.projectField.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockRejectedValueOnce(new Error('DB hiccup'));

      const r = await service.saveFieldValues('p1', 'u', [
        { projectFieldId: 'f1', value: 'v' },
      ]);

      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Erreur');
    });
  });

  // ─── Bulk operations ───────────────────────────────────────────────────────

  describe('bulk operations', () => {
    it('bulkArchive — rejects empty input', async () => {
      const r = await service.bulkArchive([], 'actor');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Aucun projet');
    });

    it('bulkArchive — rejects > BULK_MAX', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => `p-${i}`);
      const r = await service.bulkArchive(ids, 'actor');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('Trop');
    });

    it('bulkArchive — calls archive per surviving (non-deleted) candidate', async () => {
      mockPrisma.project.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      // For each archive() call: findFirst + canTransition + update + activity
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ status: 'Active' }));
      mockPhaseGate.canTransition.mockResolvedValue(Result.ok());
      mockPrisma.project.update.mockResolvedValue({});
      mockPrisma.projectActivity.create.mockResolvedValue({});

      const r = await service.bulkArchive(['p1', 'p2', 'p3-deleted'], 'actor');

      expect(r.isSuccess).toBe(true);
      const out = r.value as { attempted: number; results: any[] };
      expect(out.attempted).toBe(2); // p3-deleted filtered by filterBulkCandidates
      expect(out.results).toHaveLength(2);
    });

    it('bulkAssignManager — validates the manager once for the whole batch', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({
        id: 'bad', role: 'Member', isActive: true,
      });

      const r = await service.bulkAssignManager(['p1', 'p2'], 'bad', 'actor');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('invalide');
      // Should NOT proceed to per-project lookups.
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── getActivity ───────────────────────────────────────────────────────────

  describe('getActivity', () => {
    it('clamps take to [1, 200] and shapes the items', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        {
          id: 'a1', action: 'create', detail: 'd', createdAt: new Date(),
          user: { firstName: 'A', lastName: 'B' },
        },
      ]);
      mockPrisma.projectActivity.count.mockResolvedValue(1);

      const r = await service.getActivity('p1', 0, 9999);

      expect(r.isSuccess).toBe(true);
      const out = r.value as any;
      expect(out.take).toBe(200);
      expect(out.items[0]).toEqual({
        id: 'a1',
        userName: 'A B',
        action: 'create',
        detail: 'd',
        createdAt: expect.any(Date),
      });
    });
  });

  // ─── exportToCsv ───────────────────────────────────────────────────────────

  describe('exportToCsv', () => {
    it('emits CSV header + one row per non-deleted project', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        makeProjectRow({
          id: 'p1', name: 'Alpha', clientName: 'Cli, Co',
          status: 'Active', priority: 'High',
          projectManager: { firstName: 'PM', lastName: 'One', email: 'pm@x' },
        }),
      ]);

      const csv = await service.exportToCsv();
      const lines = csv.split('\r\n');
      expect(lines[0]).toContain('Nom');
      expect(lines[0]).toContain('Client');
      // Comma in clientName forces quoting
      expect(lines[1]).toContain('"Cli, Co"');
      expect(lines[1]).toContain('PM One');
    });

    it('escapes embedded double-quotes', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        makeProjectRow({ name: 'He said "hi"', projectManager: null }),
      ]);

      const csv = await service.exportToCsv();
      // "" is the CSV-correct escape for an embedded quote, wrapped in quotes
      // because the field contains quotes.
      expect(csv).toContain('"He said ""hi"""');
    });
  });

  // ─── submitValidation — access control ─────────────────────────────────────

  describe('submitValidation', () => {
    it('throws ForbiddenException when caller is not PM, member, or admin', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(makeProjectRow({ projectManagerId: 'someone-else' }));
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });

      await expect(
        service.submitValidation('p1', 'random-user', 'Member', { decision: 'approved', comment: '' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns failure when project not found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      const r = await service.submitValidation('missing', 'u', 'Admin', {});
      expect(r.isFailure).toBe(true);
    });
  });
});
