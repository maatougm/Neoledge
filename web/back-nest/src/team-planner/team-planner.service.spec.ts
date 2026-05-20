import { Test, TestingModule } from '@nestjs/testing';
import { TeamPlannerService } from './team-planner.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  workPackage: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  appUser: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  projectMember: {
    upsert: jest.fn(),
  },
};
const mockNotifications = { notifyEnhanced: jest.fn() };

// Helpers
function makeWp(overrides: Partial<{ id: string; assigneeId: string | null; estimatedHours: number; startDate: Date; dueDate: Date; project: { id: string; name: string }; title: string; projectId: string }> = {}) {
  return {
    id: 'wp1',
    title: 'Task',
    assigneeId: 'u1',
    estimatedHours: 8,
    startDate: new Date('2026-01-01'),
    dueDate: new Date('2026-01-05'),
    projectId: 'p1',
    assignee: { id: overrides.assigneeId ?? 'u1', firstName: 'A', lastName: 'A', avatarPath: null },
    project: { id: 'p1', name: 'Proj' },
    isDeleted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TeamPlannerService', () => {
  let service: TeamPlannerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamPlannerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get<TeamPlannerService>(TeamPlannerService);
  });

  // ── getAssignments ────────────────────────────────────────────────────────
  describe('getAssignments', () => {
    it('groups WPs by assignee', async () => {
      const wps = [
        makeWp({ id: 'w1', assigneeId: 'u1' }),
        makeWp({ id: 'w2', assigneeId: 'u1' }),
        makeWp({ id: 'w3', assigneeId: 'u2', assignee: { id: 'u2', firstName: 'B', lastName: 'B', avatarPath: null } } as any),
      ];
      mockPrisma.workPackage.findMany.mockResolvedValue(wps);
      const r = await service.getAssignments({ from: '2026-01-01', to: '2026-01-10' });
      expect(r.isSuccess).toBe(true);
      const groups = r.value as Array<{ items: unknown[] }>;
      expect(groups).toHaveLength(2);
      expect(groups.find((g) => (g as any).user.id === 'u1')!.items).toHaveLength(2);
      expect(groups.find((g) => (g as any).user.id === 'u2')!.items).toHaveLength(1);
    });

    it('applies userIds filter via where clause', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      await service.getAssignments({ from: '2026-01-01', to: '2026-01-10', userIds: ['u1'] });
      const call = mockPrisma.workPackage.findMany.mock.calls[0][0] as any;
      expect(call.where.assigneeId).toEqual({ in: ['u1'] });
    });

    it('applies projectIds filter via where clause', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      await service.getAssignments({ from: '2026-01-01', to: '2026-01-10', projectIds: ['p1', 'p2'] });
      const call = mockPrisma.workPackage.findMany.mock.calls[0][0] as any;
      expect(call.where.projectId).toEqual({ in: ['p1', 'p2'] });
    });

    it('skips WPs whose assigneeId is null when grouping', async () => {
      const wps = [makeWp({ assigneeId: null } as any), makeWp({ assigneeId: 'u1' })];
      mockPrisma.workPackage.findMany.mockResolvedValue(wps);
      const r = await service.getAssignments({ from: '2026-01-01', to: '2026-01-10' });
      expect((r.value as unknown[]).length).toBe(1);
    });

    it('returns Result.fail when prisma throws', async () => {
      mockPrisma.workPackage.findMany.mockRejectedValue(new Error('boom'));
      const r = await service.getAssignments({ from: '2026-01-01', to: '2026-01-10' });
      expect(r.isFailure).toBe(true);
    });
  });

  // ── getCapacity ───────────────────────────────────────────────────────────
  describe('getCapacity', () => {
    it('computes capacity, allocated, and utilization%', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'u1', firstName: 'A', lastName: 'A' },
        { id: 'u2', firstName: 'B', lastName: 'B' },
      ]);
      // 5-day window → 5 * 8 = 40 capacity per user.
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { assigneeId: 'u1', estimatedHours: 20, startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-04') },
        { assigneeId: 'u1', estimatedHours: 10, startDate: new Date('2026-01-02'), dueDate: new Date('2026-01-03') },
        { assigneeId: 'u2', estimatedHours: 60, startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05') },
      ]);
      const r = await service.getCapacity('2026-01-01', '2026-01-05');
      expect(r.isSuccess).toBe(true);
      const rows = r.value as Array<{ user: any; capacityHours: number; allocatedHours: number; utilizationPercent: number }>;
      const u1 = rows.find((r) => r.user.id === 'u1')!;
      const u2 = rows.find((r) => r.user.id === 'u2')!;
      expect(u1.capacityHours).toBe(40);
      expect(u1.allocatedHours).toBe(30);
      expect(u1.utilizationPercent).toBe(75);
      expect(u2.allocatedHours).toBe(60);
      expect(u2.utilizationPercent).toBe(150); // overallocated — math still goes through
    });

    it('returns 0% utilization when there are no assignments', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'u1', firstName: 'A', lastName: 'A' }]);
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      const r = await service.getCapacity('2026-01-01', '2026-01-05');
      expect((r.value as any[])[0].utilizationPercent).toBe(0);
    });

    it('treats missing estimatedHours as 0', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'u1', firstName: 'A', lastName: 'A' }]);
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { assigneeId: 'u1', estimatedHours: null, startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-02') },
      ]);
      const r = await service.getCapacity('2026-01-01', '2026-01-05');
      expect((r.value as any[])[0].allocatedHours).toBe(0);
    });

    it('clamps days to at least 1 even when from==to', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'u1', firstName: 'A', lastName: 'A' }]);
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      const r = await service.getCapacity('2026-01-01', '2026-01-01');
      expect((r.value as any[])[0].capacityHours).toBeGreaterThanOrEqual(8);
    });

    it('returns Result.fail when prisma throws', async () => {
      mockPrisma.appUser.findMany.mockRejectedValue(new Error('boom'));
      const r = await service.getCapacity('2026-01-01', '2026-01-05');
      expect(r.isFailure).toBe(true);
    });
  });

  // ── getConflicts ──────────────────────────────────────────────────────────
  describe('getConflicts', () => {
    it('detects overlapping WPs assigned to the same user', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'a', title: 'A', assigneeId: 'u1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-05'), project: { id: 'p1', name: 'P' } },
        { id: 'b', title: 'B', assigneeId: 'u1', startDate: new Date('2026-01-04'), dueDate: new Date('2026-01-10'), project: { id: 'p1', name: 'P' } },
      ]);
      const r = await service.getConflicts('2026-01-01', '2026-01-15');
      expect((r.value as unknown[]).length).toBe(1);
    });

    it('does not flag non-overlapping WPs', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'a', title: 'A', assigneeId: 'u1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-03'), project: { id: 'p1', name: 'P' } },
        { id: 'b', title: 'B', assigneeId: 'u1', startDate: new Date('2026-01-05'), dueDate: new Date('2026-01-08'), project: { id: 'p1', name: 'P' } },
      ]);
      const r = await service.getConflicts('2026-01-01', '2026-01-15');
      expect((r.value as unknown[]).length).toBe(0);
    });

    it('does not flag overlap when the two WPs belong to different users', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'a', title: 'A', assigneeId: 'u1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-10'), project: { id: 'p1', name: 'P' } },
        { id: 'b', title: 'B', assigneeId: 'u2', startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-10'), project: { id: 'p1', name: 'P' } },
      ]);
      const r = await service.getConflicts('2026-01-01', '2026-01-15');
      expect((r.value as unknown[]).length).toBe(0);
    });

    it('skips WPs where either date is null', async () => {
      mockPrisma.workPackage.findMany.mockResolvedValue([
        { id: 'a', title: 'A', assigneeId: 'u1', startDate: null, dueDate: null, project: { id: 'p1', name: 'P' } },
        { id: 'b', title: 'B', assigneeId: 'u1', startDate: new Date('2026-01-01'), dueDate: new Date('2026-01-10'), project: { id: 'p1', name: 'P' } },
      ]);
      const r = await service.getConflicts('2026-01-01', '2026-01-15');
      expect((r.value as unknown[]).length).toBe(0);
    });

    it('returns Result.fail when prisma throws', async () => {
      mockPrisma.workPackage.findMany.mockRejectedValue(new Error('boom'));
      const r = await service.getConflicts('2026-01-01', '2026-01-15');
      expect(r.isFailure).toBe(true);
    });
  });

  // ── reassign ──────────────────────────────────────────────────────────────
  describe('reassign', () => {
    it('returns failure when WP does not exist', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue(null);
      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'actor', 'Admin');
      expect(r.isFailure).toBe(true);
    });

    it('returns failure when WP is soft-deleted', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: true,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'actor', 'Admin');
      expect(r.isFailure).toBe(true);
    });

    it('returns failure when project is soft-deleted', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: true },
      });
      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'actor', 'Admin');
      expect(r.isFailure).toBe(true);
    });

    it('rejects non-Admin actor who is not the project PM', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'attacker', 'Member');
      expect(r.isFailure).toBe(true);
      expect(mockPrisma.workPackage.update).not.toHaveBeenCalled();
    });

    it('allows Admin actor regardless of project PM', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'u2' });
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member', isActive: true });
      mockPrisma.projectMember.upsert.mockResolvedValue({});
      mockNotifications.notifyEnhanced.mockResolvedValue(undefined);

      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'admin', 'Admin');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.workPackage.update).toHaveBeenCalled();
    });

    it('allows the project PM as actor', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'u2' });
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member', isActive: true });
      mockPrisma.projectMember.upsert.mockResolvedValue({});

      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'pm1', 'ProjectManager');
      expect(r.isSuccess).toBe(true);
    });

    it('upserts ProjectMember when assignee changes and target is not Admin', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'u2' });
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member', isActive: true });
      mockPrisma.projectMember.upsert.mockResolvedValue({});

      await service.reassign('wp1', { assigneeId: 'u2' }, 'admin', 'Admin');
      expect(mockPrisma.projectMember.upsert).toHaveBeenCalled();
      const call = mockPrisma.projectMember.upsert.mock.calls[0][0] as any;
      expect(call.where.project_member_uq.projectId).toBe('p1');
      expect(call.where.project_member_uq.userId).toBe('u2');
    });

    it('does NOT upsert ProjectMember when the new assignee is the project PM', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'pm1' });

      await service.reassign('wp1', { assigneeId: 'pm1' }, 'admin', 'Admin');
      expect(mockPrisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('does NOT upsert ProjectMember when target user is Admin', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'admin2' });
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin', isActive: true });

      await service.reassign('wp1', { assigneeId: 'admin2' }, 'admin', 'Admin');
      expect(mockPrisma.projectMember.upsert).not.toHaveBeenCalled();
    });

    it('passes start/dueDate updates through to prisma.update', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1' });

      await service.reassign('wp1', { assigneeId: 'u1', startDate: '2026-02-01', dueDate: '2026-02-10' }, 'admin', 'Admin');
      const call = mockPrisma.workPackage.update.mock.calls[0][0] as any;
      expect(call.data.startDate).toBeInstanceOf(Date);
      expect(call.data.dueDate).toBeInstanceOf(Date);
    });

    it('does NOT notify when the assignee did not actually change', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u2', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockResolvedValue({ id: 'wp1', assigneeId: 'u2' });

      // Same assignee → notify should not fire.
      await service.reassign('wp1', { assigneeId: 'u2' }, 'admin', 'Admin');
      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('returns Result.fail when prisma.update throws', async () => {
      mockPrisma.workPackage.findUnique.mockResolvedValue({
        id: 'wp1', title: 't', projectId: 'p1', assigneeId: 'u1', isDeleted: false,
        project: { projectManagerId: 'pm1', isDeleted: false },
      });
      mockPrisma.workPackage.update.mockRejectedValue(new Error('DB down'));
      const r = await service.reassign('wp1', { assigneeId: 'u2' }, 'admin', 'Admin');
      expect(r.isFailure).toBe(true);
    });
  });

  // ── getUtilization (delegates to getCapacity) ─────────────────────────────
  describe('getUtilization', () => {
    it('returns the same shape as getCapacity', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'u1', firstName: 'A', lastName: 'A' }]);
      mockPrisma.workPackage.findMany.mockResolvedValue([]);
      const r = await service.getUtilization('2026-01-01', '2026-01-05');
      expect(r.isSuccess).toBe(true);
      expect(Array.isArray(r.value)).toBe(true);
    });
  });
});
