import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService, NotificationRecord } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

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
    count: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
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
      expect(result.value).toEqual(expected);
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
    it('succeeds when userId matches', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(makeNotification());
      mockPrisma.notification.update.mockResolvedValue({ ...makeNotification(), isRead: true });

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
      });
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { isRead: true },
      });
    });

    it('returns failure when notification belongs to a different user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const result = await service.markAsRead('notif-1', 'attacker');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Notification non trouvée.');
      expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.findFirst.mockRejectedValue(new Error('DB error'));

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
    it('deletes the notification when userId matches', async () => {
      const notif = makeNotification();
      mockPrisma.notification.findFirst.mockResolvedValue(notif);
      mockPrisma.notification.delete.mockResolvedValue(notif);

      const result = await service.delete('notif-1', 'user-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
      });
      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({ where: { id: 'notif-1' } });
    });

    it('returns failure and does NOT delete when userId does not match', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      const result = await service.delete('notif-1', 'attacker');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Notification non trouvée.');
      expect(mockPrisma.notification.delete).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.notification.findFirst.mockRejectedValue(new Error('DB error'));

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
    it('creates a notification record', async () => {
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

    it('does not throw when Prisma fails (fire-and-forget contract)', async () => {
      mockPrisma.notification.create.mockRejectedValue(new Error('DB down'));

      await expect(service.notify('user-1', 'type', 'Title', 'Body')).resolves.toBeUndefined();
    });
  });
});
