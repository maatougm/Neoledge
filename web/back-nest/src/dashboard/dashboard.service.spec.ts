import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  project: {
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  appUser: {
    findMany: jest.fn(),
  },
  projectActivity: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<DashboardService>(DashboardService);
  });

  // ── getStats ───────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('aggregates project counts + workloads + recent activity', async () => {
      mockPrisma.project.count
        .mockResolvedValueOnce(20)  // total
        .mockResolvedValueOnce(12)  // active
        .mockResolvedValueOnce(5)   // completed
        .mockResolvedValueOnce(2)   // archived
        .mockResolvedValueOnce(3)   // overdue
        .mockResolvedValueOnce(7);  // this month
      // First groupBy is for getProjectsByStatus (status), then priority groupBy.
      mockPrisma.project.groupBy
        .mockResolvedValueOnce([{ status: 'Kickoff', _count: 4 }, { status: 'Completed', _count: 5 }])
        .mockResolvedValueOnce([{ priority: 'High', _count: 8 }, { priority: 'Low', _count: 12 }]);
      mockPrisma.appUser.findMany.mockResolvedValue([]);
      mockPrisma.projectActivity.findMany.mockResolvedValue([]);

      const result = await service.getStats();

      expect(result.isSuccess).toBe(true);
      const value = result.value as {
        totalProjects: number;
        activeProjects: number;
        completedProjects: number;
        archivedProjects: number;
        overdueProjects: number;
        projectsThisMonth: number;
        projectsByStatus: Record<string, number>;
        projectsByPriority: Record<string, number>;
        projectManagerWorkloads: unknown[];
        recentActivities: unknown[];
      };
      expect(value.totalProjects).toBe(20);
      expect(value.activeProjects).toBe(12);
      expect(value.completedProjects).toBe(5);
      expect(value.archivedProjects).toBe(2);
      expect(value.overdueProjects).toBe(3);
      expect(value.projectsThisMonth).toBe(7);
      expect(value.projectsByStatus).toEqual({ Kickoff: 4, Completed: 5 });
      expect(value.projectsByPriority).toEqual({ High: 8, Low: 12 });
    });
  });

  // ── getProjectsByStatus ────────────────────────────────────────────────────

  describe('getProjectsByStatus', () => {
    it('returns a status → count map', async () => {
      mockPrisma.project.groupBy.mockResolvedValueOnce([
        { status: 'Active', _count: 3 },
        { status: 'Completed', _count: 2 },
      ]);

      const result = await service.getProjectsByStatus();

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual({ Active: 3, Completed: 2 });
    });

    it('returns an empty object when no rows match', async () => {
      mockPrisma.project.groupBy.mockResolvedValueOnce([]);

      const result = await service.getProjectsByStatus();

      expect(result.value).toEqual({});
    });
  });

  // ── getWorkloads ───────────────────────────────────────────────────────────

  describe('getWorkloads', () => {
    it('classifies managed projects into inProgress / completed / overdue buckets', async () => {
      const past = new Date(Date.now() - 86_400_000);
      const future = new Date(Date.now() + 86_400_000);
      mockPrisma.appUser.findMany.mockResolvedValueOnce([
        {
          id: 'pm-1',
          firstName: 'Alice',
          lastName: 'PM',
          email: 'alice@ex.com',
          managedProjects: [
            { status: 'Kickoff', endDate: future },
            { status: 'Completed', endDate: past },
            { status: 'Realisation', endDate: past }, // overdue + inProgress
          ],
        },
      ]);

      const result = await service.getWorkloads();

      expect(result.isSuccess).toBe(true);
      const row = (result.value as Array<{
        managerId: string;
        managerName: string;
        managerEmail: string;
        totalProjects: number;
        inProgressProjects: number;
        completedProjects: number;
        overdueProjects: number;
      }>)[0];
      expect(row.managerId).toBe('pm-1');
      expect(row.managerName).toBe('Alice PM');
      expect(row.managerEmail).toBe('alice@ex.com');
      expect(row.totalProjects).toBe(3);
      expect(row.inProgressProjects).toBe(2); // Kickoff + Realisation
      expect(row.completedProjects).toBe(1);
      expect(row.overdueProjects).toBe(1);    // Realisation in the past, not Completed/Archived
    });
  });

  // ── getRecentActivity ──────────────────────────────────────────────────────

  describe('getRecentActivity', () => {
    it('caps count to [1,500] and applies the cap on take', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValueOnce([]);

      await service.getRecentActivity(1000); // > 500 cap

      const args = mockPrisma.projectActivity.findMany.mock.calls[0][0] as { take: number };
      expect(args.take).toBe(500);
    });

    it('falls back to 10 on NaN / negative input', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValueOnce([]);

      await service.getRecentActivity(-5);

      const args = mockPrisma.projectActivity.findMany.mock.calls[0][0] as { take: number };
      expect(args.take).toBe(10);
    });

    it('maps activities to the flat DTO shape with project + user fields', async () => {
      const ts = new Date('2026-05-01T12:00:00Z');
      mockPrisma.projectActivity.findMany.mockResolvedValueOnce([
        {
          id: 'a1',
          action: 'created',
          detail: 'project X',
          createdAt: ts,
          user: { id: 'u1', firstName: 'A', lastName: 'B', role: 'Admin' },
          project: { id: 'p1', name: 'Pjt', clientName: 'Client' },
        },
        {
          id: 'a2',
          action: 'updated',
          detail: null,
          createdAt: ts,
          user: null,
          project: null,
        },
      ]);

      const result = await service.getRecentActivity(2);

      expect(result.isSuccess).toBe(true);
      const items = result.value as Array<{ id: string; userName: string | null; projectId: string | null; userRole: string | null }>;
      expect(items[0].id).toBe('a1');
      expect(items[0].userName).toBe('A B');
      expect(items[0].projectId).toBe('p1');
      expect(items[0].userRole).toBe('Admin');
      expect(items[1].userName).toBeNull();
      expect(items[1].projectId).toBeNull();
    });
  });

  // ── getActivityStats ───────────────────────────────────────────────────────

  describe('getActivityStats', () => {
    it('returns counts + most-active project', async () => {
      mockPrisma.projectActivity.count
        .mockResolvedValueOnce(15)  // today
        .mockResolvedValueOnce(78); // this week
      mockPrisma.projectActivity.groupBy.mockResolvedValueOnce([
        { projectId: 'p1', _count: { _all: 22 } },
      ]);
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'p1', name: 'Hot Project' });

      const result = await service.getActivityStats();

      expect(result.isSuccess).toBe(true);
      const value = result.value as {
        totalToday: number;
        totalThisWeek: number;
        mostActiveProject: { id: string; name: string; count: number } | null;
      };
      expect(value.totalToday).toBe(15);
      expect(value.totalThisWeek).toBe(78);
      expect(value.mostActiveProject).toEqual({ id: 'p1', name: 'Hot Project', count: 22 });
    });

    it('returns mostActiveProject=null when no activities exist', async () => {
      mockPrisma.projectActivity.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      mockPrisma.projectActivity.groupBy.mockResolvedValueOnce([]);

      const result = await service.getActivityStats();

      const value = result.value as { mostActiveProject: unknown };
      expect(value.mostActiveProject).toBeNull();
    });

    it('returns null mostActiveProject when the top project row no longer exists', async () => {
      mockPrisma.projectActivity.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      mockPrisma.projectActivity.groupBy.mockResolvedValueOnce([
        { projectId: 'ghost', _count: { _all: 1 } },
      ]);
      mockPrisma.project.findUnique.mockResolvedValueOnce(null);

      const result = await service.getActivityStats();

      const value = result.value as { mostActiveProject: unknown };
      expect(value.mostActiveProject).toBeNull();
    });
  });

  // ── getOverdueProjects ─────────────────────────────────────────────────────

  describe('getOverdueProjects', () => {
    it('returns count + projects past their endDate, excluding Completed/Archived', async () => {
      mockPrisma.project.findMany.mockResolvedValueOnce([
        { id: 'p1', name: 'late', endDate: new Date(0), status: 'Kickoff' },
        { id: 'p2', name: 'also late', endDate: new Date(0), status: 'Recette' },
      ]);

      const result = await service.getOverdueProjects();

      expect(result.isSuccess).toBe(true);
      const value = result.value as { count: number; projects: unknown[] };
      expect(value.count).toBe(2);
      const args = mockPrisma.project.findMany.mock.calls[0][0] as {
        where: { status: { notIn: string[] } };
      };
      expect(args.where.status.notIn).toEqual(['Cloture', 'Completed', 'Archived']);
    });
  });
});
