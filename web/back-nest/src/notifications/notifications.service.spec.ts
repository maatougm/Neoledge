import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService, NotificationRecord } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'project_assigned',
    title: 'Test',
    message: 'Test message',
    projectId: null,
    isRead: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  },
  project: {
    findFirst: jest.fn(),
  },
  projectMember: {
    findFirst: jest.fn(),
  },
  appUser: {
    findUnique: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockMail = { send: jest.fn(async () => undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  // ── getForUser ─────────────────────────────────────────────────────────────

  describe('getForUser', () => {
    it('returns only notifications for the given userId', async () => {
      const userId = 'user-1';
      const expected = [makeNotification({ userId }), makeNotification({ id: 'notif-2', userId })];
      mockPrisma.notification.findMany.mockResolvedValue(expected);

      const result = await service.getForUser(userId);

      expect(result.isSuccess).toBe(true);
      // getForUser returns { items, nextCursor } (cursor-pagination shape)
      expect((result.value as { items: unknown[] } | undefined)?.items).toEqual(expected);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId } }),
      );
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.findMany.mockRejectedValue(new Error('DB down'));

      const result = await service.getForUser('user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Impossible de récupérer les notifications.');
    });
  });

  // ── markAsRead ─────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('succeeds when userId matches (atomic updateMany)', async () => {
      // New behavior: single scoped updateMany, no read-before-write.
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
      // findFirst is only used as a tiebreaker when count===0.
      expect(mockPrisma.notification.findFirst).not.toHaveBeenCalled();
    });

    it('is idempotent — already-read row resolves as success', async () => {
      // updateMany returns count:0 because the row is already isRead:true.
      // The follow-up findFirst confirms the row exists and belongs to the user.
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.notification.findFirst.mockResolvedValue({ id: 'notif-1' });

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.isSuccess).toBe(true);
    });

    it('returns failure when notification belongs to a different user', async () => {
      // updateMany matches nothing AND the follow-up scoped findFirst confirms
      // the row does not belong to this user (or does not exist).
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const result = await service.markAsRead('notif-1', 'attacker');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Notification non trouvée.');
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Impossible de mettre à jour la notification.');
    });
  });

  // ── markAllAsRead ──────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('calls updateMany scoped strictly to userId and isRead:false', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllAsRead('user-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
        data: { isRead: true },
      });
    });

    it('does not touch notifications for a different user', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await service.markAllAsRead('user-A');

      const call = mockPrisma.notification.updateMany.mock.calls[0][0] as {
        where: { userId: string; isRead: boolean };
      };
      expect(call.where.userId).toBe('user-A');
      expect(Object.keys(call.where)).toEqual(['userId', 'isRead']);
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.updateMany.mockRejectedValue(new Error('DB error'));

      const result = await service.markAllAsRead('user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Impossible de mettre à jour les notifications.');
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the notification when userId matches (atomic deleteMany)', async () => {
      mockPrisma.notification.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.delete('notif-1', 'user-1');

      expect(result.isSuccess).toBe(true);
      // New behavior: single scoped deleteMany — no read-before-delete.
      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
      });
      expect(mockPrisma.notification.delete).not.toHaveBeenCalled();
    });

    it('returns failure when userId does not match (deleteMany count 0)', async () => {
      mockPrisma.notification.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.delete('notif-1', 'attacker');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Notification non trouvée.');
      expect(mockPrisma.notification.delete).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.deleteMany.mockRejectedValue(new Error('DB error'));

      const result = await service.delete('notif-1', 'user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Impossible de supprimer la notification.');
    });
  });

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns the unread count for the given userId', async () => {
      mockPrisma.notification.count.mockResolvedValue(5);

      const result = await service.getUnreadCount('user-1');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toBe(5);
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', isRead: false },
      });
    });

    it('returns 0 when there are no unread notifications', async () => {
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount('user-1');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toBe(0);
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.count.mockRejectedValue(new Error('DB error'));

      const result = await service.getUnreadCount('user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Impossible de compter les notifications non lues.');
    });
  });

  // ── notify (fire-and-forget helper) ───────────────────────────────────────

  describe('notify', () => {
    it('creates a notification record when target is a project PM', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({ id: 'proj-1' });
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'ProjectManager' });
      mockPrisma.notification.create.mockResolvedValue(makeNotification());

      await expect(
        service.notify('user-1', 'project_assigned', 'Title', 'Body', 'proj-1'),
      ).resolves.toBeUndefined();

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'project_assigned',
          title: 'Title',
          message: 'Body',
          projectId: 'proj-1',
        },
      });
    });

    it('creates a notification when no projectId is supplied (no scope check)', async () => {
      mockPrisma.notification.create.mockResolvedValue(makeNotification());

      await expect(service.notify('user-1', 'type', 'Title', 'Body')).resolves.toBeUndefined();

      expect(mockPrisma.notification.create).toHaveBeenCalled();
      expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('skips when actorId equals userId (self-notify)', async () => {
      await service.notify('user-1', 'type', 'Title', 'Body', 'proj-1', 'user-1');

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    });

    it('skips when target is not a project member', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });

      await service.notify('user-1', 'type', 'Title', 'Body', 'proj-1');

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('persists when target is global Admin (cross-project oversight)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Admin' });
      mockPrisma.notification.create.mockResolvedValue(makeNotification());

      await service.notify('user-1', 'type', 'Title', 'Body', 'proj-1');

      expect(mockPrisma.notification.create).toHaveBeenCalled();
    });

    it('fails-closed when scope check throws (drops notification)', async () => {
      mockPrisma.project.findFirst.mockRejectedValue(new Error('DB down'));
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });

      await service.notify('user-1', 'type', 'Title', 'Body', 'proj-1');

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('does not throw when persisting fails (fire-and-forget contract)', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('DB down'));

      await expect(service.notify('user-1', 'type', 'Title', 'Body')).resolves.toBeUndefined();
    });
  });

  // ── notifyEnhanced (Notifications 2.0 path) ────────────────────────────────

  describe('notifyEnhanced', () => {
    it('persists when target is a ProjectMember', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      mockPrisma.projectMember.findFirst.mockResolvedValue({ id: 'pm-1' });
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });
      mockPrisma.notification.create.mockResolvedValue(makeNotification());

      await service.notifyEnhanced({
        userId: 'user-1',
        type: 'work_package',
        title: 'T',
        message: 'M',
        projectId: 'proj-1',
        link: '/app/team/my-tasks',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            projectId: 'proj-1',
            link: '/app/team/my-tasks',
          }),
        }),
      );
    });

    it('skips when target is not a project member (fail-closed)', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });

      await service.notifyEnhanced({
        userId: 'user-1',
        type: 'work_package',
        title: 'T',
        message: 'M',
        projectId: 'proj-1',
      });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('fails-closed when scope check throws', async () => {
      mockPrisma.project.findFirst.mockRejectedValue(new Error('DB down'));
      mockPrisma.projectMember.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ role: 'Member' });

      await service.notifyEnhanced({
        userId: 'user-1',
        type: 'work_package',
        title: 'T',
        message: 'M',
        projectId: 'proj-1',
      });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    });

    it('skips on self-notify (actorId === userId)', async () => {
      await service.notifyEnhanced({
        userId: 'user-1',
        type: 'work_package',
        title: 'T',
        message: 'M',
        projectId: 'proj-1',
        actorId: 'user-1',
      });

      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
      expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    });
  });
});
