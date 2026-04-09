import { Test, TestingModule } from '@nestjs/testing';
import { DeadlinesService } from './deadlines.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function makeProject(overrides: {
  id?: string;
  name?: string;
  clientName?: string;
  endDate?: Date;
  projectManagerId?: string | null;
  status?: string;
  isDeleted?: boolean;
}) {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Mon Projet',
    clientName: overrides.clientName ?? 'ACME',
    endDate: overrides.endDate ?? addDays(startOfToday(), 5),
    projectManagerId: overrides.projectManagerId ?? null,
    status: overrides.status ?? 'InProgress',
    isDeleted: overrides.isDeleted ?? false,
  };
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  project: {
    findMany: jest.fn(),
  },
  appUser: {
    findMany: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
  },
};

const mockNotifications = {
  notify: jest.fn(),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('DeadlinesService', () => {
  let service: DeadlinesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: no already-alerted notifications
    mockPrisma.notification.findMany.mockResolvedValue([]);
    // Default: no admins
    mockPrisma.appUser.findMany.mockResolvedValue([]);
    // Default: no projects
    mockPrisma.project.findMany.mockResolvedValue([]);
    // Default: notify resolves cleanly
    mockNotifications.notify.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeadlinesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<DeadlinesService>(DeadlinesService);
  });

  // ── Projects expiring tomorrow → deadline_critical ─────────────────────────

  describe('when a project expires tomorrow', () => {
    it('sends a deadline_critical notification to the project manager', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      const project = makeProject({ id: 'proj-1', endDate: tomorrow, projectManagerId: 'pm-1' });

      mockPrisma.project.findMany.mockResolvedValue([project]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'pm-1',
        'deadline_critical',
        expect.any(String),
        expect.stringContaining('moins de 2 jours'),
        'proj-1',
      );
    });

    it('sends deadline_critical to all active admins', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      const project = makeProject({ id: 'proj-1', endDate: tomorrow });

      mockPrisma.project.findMany.mockResolvedValue([project]);
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'admin-1',
        'deadline_critical',
        expect.any(String),
        expect.any(String),
        'proj-1',
      );
      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'admin-2',
        'deadline_critical',
        expect.any(String),
        expect.any(String),
        'proj-1',
      );
    });
  });

  // ── Projects expiring in 5 days → deadline_warning ────────────────────────

  describe('when a project expires in 5 days', () => {
    it('sends a deadline_warning notification to the project manager', async () => {
      const inFiveDays = addDays(startOfToday(), 5);
      const project = makeProject({ id: 'proj-2', endDate: inFiveDays, projectManagerId: 'pm-2' });

      mockPrisma.project.findMany.mockResolvedValue([project]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'pm-2',
        'deadline_warning',
        expect.any(String),
        expect.stringContaining('5 jours'),
        'proj-2',
      );
    });

    it('includes the client name in the warning message', async () => {
      const inFiveDays = addDays(startOfToday(), 5);
      const project = makeProject({
        id: 'proj-2',
        name: 'ProjectX',
        clientName: 'ClientABC',
        endDate: inFiveDays,
        projectManagerId: 'pm-2',
      });

      mockPrisma.project.findMany.mockResolvedValue([project]);

      await service.checkDeadlines();

      const call = mockNotifications.notify.mock.calls[0] as [string, string, string, string, string];
      expect(call[3]).toContain('ClientABC');
      expect(call[3]).toContain('ProjectX');
    });
  });

  // ── Completed / Archived projects are excluded ────────────────────────────

  describe('skipped statuses', () => {
    it('does NOT notify for Completed projects', async () => {
      // prisma query is already filtered by Prisma — simulate empty result
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });

    it('passes the correct status exclusion filter to Prisma', async () => {
      await service.checkDeadlines();

      const callArg = mockPrisma.project.findMany.mock.calls[0][0] as {
        where: { status: { notIn: string[] } };
      };
      expect(callArg.where.status.notIn).toContain('Completed');
      expect(callArg.where.status.notIn).toContain('Archived');
    });
  });

  // ── Already alerted today → no duplicate notification ────────────────────

  describe('deduplication', () => {
    it('does NOT notify a project that already received a deadline alert today', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      const project = makeProject({ id: 'proj-dupe', endDate: tomorrow, projectManagerId: 'pm-1' });

      mockPrisma.project.findMany.mockResolvedValue([project]);
      // Simulate a notification already recorded today for this project
      mockPrisma.notification.findMany.mockResolvedValue([
        { projectId: 'proj-dupe' },
      ]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).not.toHaveBeenCalled();
    });

    it('still notifies other projects when one is already alerted', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      const alerted = makeProject({ id: 'proj-alerted', endDate: tomorrow });
      const pending = makeProject({ id: 'proj-pending', endDate: tomorrow, projectManagerId: 'pm-1' });

      mockPrisma.project.findMany.mockResolvedValue([alerted, pending]);
      mockPrisma.notification.findMany.mockResolvedValue([{ projectId: 'proj-alerted' }]);

      await service.checkDeadlines();

      expect(mockNotifications.notify).toHaveBeenCalledWith(
        'pm-1',
        'deadline_critical',
        expect.any(String),
        expect.any(String),
        'proj-pending',
      );
      const callsForAlerted = (mockNotifications.notify.mock.calls as unknown[][]).filter(
        (c) => c[4] === 'proj-alerted',
      );
      expect(callsForAlerted).toHaveLength(0);
    });
  });

  // ── notify called once per recipient per project ──────────────────────────

  describe('notification count per recipient', () => {
    it('calls notify exactly once per unique recipient for a single project', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      // PM is also an admin — should only receive ONE notification
      const project = makeProject({ id: 'proj-1', endDate: tomorrow, projectManagerId: 'admin-1' });

      mockPrisma.project.findMany.mockResolvedValue([project]);
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await service.checkDeadlines();

      const callsForProj = (mockNotifications.notify.mock.calls as unknown[][]).filter(
        (c) => c[4] === 'proj-1',
      );
      // admin-1 (= PM) + admin-2 = 2 unique recipients
      expect(callsForProj).toHaveLength(2);
    });

    it('notifies both PM and admins when PM is not an admin', async () => {
      const inFiveDays = addDays(startOfToday(), 5);
      const project = makeProject({ id: 'proj-1', endDate: inFiveDays, projectManagerId: 'pm-99' });

      mockPrisma.project.findMany.mockResolvedValue([project]);
      mockPrisma.appUser.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      await service.checkDeadlines();

      const recipients = (mockNotifications.notify.mock.calls as unknown[][]).map((c) => c[0]);
      expect(recipients).toContain('pm-99');
      expect(recipients).toContain('admin-1');
      expect(recipients).toHaveLength(2);
    });
  });

  // ── Resilience ────────────────────────────────────────────────────────────

  describe('resilience', () => {
    it('does not throw when Prisma.project.findMany rejects', async () => {
      mockPrisma.project.findMany.mockRejectedValue(new Error('DB down'));

      await expect(service.checkDeadlines()).resolves.toBeUndefined();
    });

    it('does not throw when notify rejects', async () => {
      const tomorrow = addDays(startOfToday(), 1);
      const project = makeProject({ id: 'proj-1', endDate: tomorrow, projectManagerId: 'pm-1' });

      mockPrisma.project.findMany.mockResolvedValue([project]);
      mockNotifications.notify.mockRejectedValue(new Error('Notification service down'));

      await expect(service.checkDeadlines()).resolves.toBeUndefined();
    });
  });
});
