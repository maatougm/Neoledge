import { Test, TestingModule } from '@nestjs/testing';
import { WpCommentsService } from './wp-comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  workPackageComment: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workPackage: {
    findFirst: jest.fn(),
  },
};

const mockNotifications = {
  notifyEnhanced: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<{ id: string; workPackageId: string; userId: string; content: string; isDeleted: boolean }> = {}) {
  return {
    id: overrides.id ?? 'c-1',
    workPackageId: overrides.workPackageId ?? 'wp-1',
    userId: overrides.userId ?? 'user-1',
    content: overrides.content ?? 'hello',
    isDeleted: overrides.isDeleted ?? false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    user: { id: 'user-1', firstName: 'Alice', lastName: 'A', email: 'a@e.com', avatarPath: null },
  };
}

function makeWp(overrides: Partial<{ id: string; title: string; projectId: string; assigneeId: string | null; watchers: Array<{ userId: string }> }> = {}) {
  return {
    id: overrides.id ?? 'wp-1',
    title: overrides.title ?? 'Some WP',
    projectId: overrides.projectId ?? 'proj-1',
    assigneeId: overrides.assigneeId ?? null,
    watchers: overrides.watchers ?? [],
  };
}

// Helper: wait for all microtasks/promises to settle so the fire-and-forget
// notify pipeline finishes before assertions.
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WpCommentsService', () => {
  let service: WpCommentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WpCommentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<WpCommentsService>(WpCommentsService);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns comments ordered by createdAt ascending, filtered to non-deleted', async () => {
      const rows = [makeComment(), makeComment({ id: 'c-2' })];
      // assertWpInProject: the WP must belong to the authorized project.
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp());
      mockPrisma.workPackageComment.findMany.mockResolvedValue(rows);

      const result = await service.list('wp-1', 'proj-1');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual(rows);
      expect(mockPrisma.workPackageComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workPackageId: 'wp-1', isDeleted: false },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('refuses to list comments when the WP is not in the authorized project (IDOR guard)', async () => {
      mockPrisma.workPackage.findFirst.mockResolvedValue(null);

      const result = await service.list('wp-from-other-project', 'proj-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Work package introuvable.');
      expect(mockPrisma.workPackageComment.findMany).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp());
      mockPrisma.workPackageComment.findMany.mockRejectedValue(new Error('DB down'));

      const result = await service.list('wp-1', 'proj-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Échec du chargement des commentaires.');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('returns failure when content is empty after trim', async () => {
      const result = await service.create('wp-1', 'user-1', '   ', 'proj-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Contenu requis.');
      expect(mockPrisma.workPackageComment.create).not.toHaveBeenCalled();
    });

    it('refuses to create a comment when the WP is not in the authorized project (IDOR guard)', async () => {
      mockPrisma.workPackage.findFirst.mockResolvedValue(null);

      const result = await service.create('wp-from-other-project', 'user-1', 'hi', 'proj-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Work package introuvable.');
      expect(mockPrisma.workPackageComment.create).not.toHaveBeenCalled();
    });

    it('persists the trimmed comment and returns it', async () => {
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment({ content: 'hi' }));
      // No assignee + no watchers → fanout no-ops. Same mock backs assertWpInProject.
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp());

      const result = await service.create('wp-1', 'user-1', '  hi  ', 'proj-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.workPackageComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { workPackageId: 'wp-1', userId: 'user-1', content: 'hi' },
        }),
      );
    });

    it('notifies the assignee (skipping the actor)', async () => {
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment({ content: 'review please' }));
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp({ assigneeId: 'assignee-1', watchers: [] }));

      const result = await service.create('wp-1', 'author-1', 'review please', 'proj-1');
      await flushMicrotasks();

      expect(result.isSuccess).toBe(true);
      expect(mockNotifications.notifyEnhanced).toHaveBeenCalledTimes(1);
      expect(mockNotifications.notifyEnhanced).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'assignee-1',
          actorId: 'author-1',
          type: 'wp_comment_added',
          projectId: 'proj-1',
          entityType: 'work_package',
          entityId: 'wp-1',
        }),
      );
    });

    it('notifies watchers + assignee, deduplicates, and skips the actor', async () => {
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment());
      mockPrisma.workPackage.findFirst.mockResolvedValue(
        makeWp({
          assigneeId: 'user-A',
          // user-A is also a watcher (dedup), author is a watcher (skip).
          watchers: [{ userId: 'user-A' }, { userId: 'user-B' }, { userId: 'author-1' }],
        }),
      );

      await service.create('wp-1', 'author-1', 'hello team', 'proj-1');
      await flushMicrotasks();

      const targetIds = mockNotifications.notifyEnhanced.mock.calls.map((c) => (c[0] as { userId: string }).userId);
      expect(targetIds.sort()).toEqual(['user-A', 'user-B']);
      expect(targetIds).not.toContain('author-1');
    });

    it('skips notification when assignee equals the actor', async () => {
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment());
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp({ assigneeId: 'self', watchers: [] }));

      await service.create('wp-1', 'self', 'note to self', 'proj-1');
      await flushMicrotasks();

      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('truncates the snippet to 120 chars + ellipsis in the notification message', async () => {
      const longContent = 'x'.repeat(200);
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment({ content: longContent }));
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp({ assigneeId: 'recv' }));

      await service.create('wp-1', 'author', longContent, 'proj-1');
      await flushMicrotasks();

      const call = mockNotifications.notifyEnhanced.mock.calls[0][0] as { message: string };
      expect(call.message).toMatch(/…$/);
      // 120 chars of 'x' + ellipsis + surrounding text from the template.
      expect((call.message.match(/x/g) ?? []).length).toBe(120);
    });

    it('returns failure (and skips fanout) when create() throws', async () => {
      mockPrisma.workPackage.findFirst.mockResolvedValue(makeWp());
      mockPrisma.workPackageComment.create.mockRejectedValue(new Error('DB error'));

      const result = await service.create('wp-1', 'user-1', 'hi', 'proj-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Échec de la création.');
      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('does not surface fanout failures to the caller (fire-and-forget)', async () => {
      mockPrisma.workPackageComment.create.mockResolvedValue(makeComment());
      // First findFirst = assertWpInProject (passes); second = fanout (crashes).
      mockPrisma.workPackage.findFirst
        .mockResolvedValueOnce(makeWp())
        .mockRejectedValueOnce(new Error('fanout crashed'));

      const result = await service.create('wp-1', 'user-1', 'hi', 'proj-1');
      await flushMicrotasks();

      expect(result.isSuccess).toBe(true);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('returns failure when the comment does not exist', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(null);

      const result = await service.update('c-1', 'user-1', 'new');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Commentaire introuvable.');
      expect(mockPrisma.workPackageComment.update).not.toHaveBeenCalled();
    });

    it('refuses to update a comment that belongs to a different user', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment({ userId: 'someone-else' }));

      const result = await service.update('c-1', 'attacker', 'new');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Accès refusé.');
      expect(mockPrisma.workPackageComment.update).not.toHaveBeenCalled();
    });

    it('updates with trimmed content when the caller is the author', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment());
      mockPrisma.workPackageComment.update.mockResolvedValue(makeComment({ content: 'edited' }));

      const result = await service.update('c-1', 'user-1', '  edited  ');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.workPackageComment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-1' },
          data: { content: 'edited' },
        }),
      );
    });

    it('reads with isDeleted:false — a soft-deleted comment cannot be edited', async () => {
      // The lookup must scope to non-deleted rows. If a deleted comment is
      // requested, findFirst returns null and update is rejected.
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(null);

      const result = await service.update('c-deleted', 'user-1', 'sneaky edit');

      expect(result.isFailure).toBe(true);
      expect(mockPrisma.workPackageComment.findFirst).toHaveBeenCalledWith({
        where: { id: 'c-deleted', isDeleted: false },
      });
      expect(mockPrisma.workPackageComment.update).not.toHaveBeenCalled();
    });

    it('returns failure when Prisma update throws', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment());
      mockPrisma.workPackageComment.update.mockRejectedValue(new Error('DB error'));

      const result = await service.update('c-1', 'user-1', 'new');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Échec de la mise à jour du commentaire.');
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('returns failure when the comment does not exist', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(null);

      const result = await service.delete('c-1', 'user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Commentaire introuvable.');
      expect(mockPrisma.workPackageComment.update).not.toHaveBeenCalled();
    });

    it('refuses to delete when caller is not the author', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment({ userId: 'someone-else' }));

      const result = await service.delete('c-1', 'attacker');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Accès refusé.');
      expect(mockPrisma.workPackageComment.update).not.toHaveBeenCalled();
    });

    it('soft-deletes (isDeleted:true) when caller is the author', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment());
      mockPrisma.workPackageComment.update.mockResolvedValue(makeComment({ isDeleted: true }));

      const result = await service.delete('c-1', 'user-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.workPackageComment.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { isDeleted: true },
      });
    });

    it('returns failure when Prisma update throws', async () => {
      mockPrisma.workPackageComment.findFirst.mockResolvedValue(makeComment());
      mockPrisma.workPackageComment.update.mockRejectedValue(new Error('DB error'));

      const result = await service.delete('c-1', 'user-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Échec de la suppression du commentaire.');
    });
  });
});
