import { Test, TestingModule } from '@nestjs/testing';
import { CommentsService } from './comments.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const baseUser = { id: 'u-author', firstName: 'Alice', lastName: 'PM', avatarPath: null };

function makeComment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    projectId: 'p-1',
    userId: 'u-author',
    content: 'Hello',
    parentCommentId: null,
    mentions: null,
    isDeleted: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    user: baseUser,
    replies: [],
    ...overrides,
  };
}

const mockPrisma = {
  projectComment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  appUser: { findMany: jest.fn() },
  projectActivity: { create: jest.fn() },
};

const mockNotifications = {
  notifyEnhanced: jest.fn().mockResolvedValue(undefined),
};

describe('CommentsService', () => {
  let service: CommentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.projectActivity.create.mockResolvedValue(undefined);
    mockNotifications.notifyEnhanced.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  // ── getProjectComments ───────────────────────────────────────────────────
  describe('getProjectComments', () => {
    it('returns top-level comments (no parent) with replies, ordered desc', async () => {
      const parent = makeComment({
        id: 'c-parent',
        replies: [makeComment({ id: 'c-reply', parentCommentId: 'c-parent' })],
      });
      mockPrisma.projectComment.findMany.mockResolvedValue([parent]);

      const r = await service.getProjectComments('p-1');

      expect(r.isSuccess).toBe(true);
      const items = (r.value as Array<{ id: string; replies: Array<{ id: string }> }>) ?? [];
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('c-parent');
      expect(items[0].replies).toHaveLength(1);
      expect(items[0].replies[0].id).toBe('c-reply');
      expect(mockPrisma.projectComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'p-1', isDeleted: false, parentCommentId: null },
        }),
      );
    });

    it('omits soft-deleted comments via where.isDeleted=false', async () => {
      mockPrisma.projectComment.findMany.mockResolvedValue([]);
      await service.getProjectComments('p-1');
      const where = mockPrisma.projectComment.findMany.mock.calls[0][0].where;
      expect(where.isDeleted).toBe(false);
    });
  });

  // ── getById ──────────────────────────────────────────────────────────────
  describe('getById', () => {
    it('returns the comment when found', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment());
      const r = await service.getById('c-1');
      expect(r.isSuccess).toBe(true);
      expect((r.value as { id: string }).id).toBe('c-1');
    });

    it('returns failure when not found', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(null);
      const r = await service.getById('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Commentaire non trouvé.');
    });

    it('scopes findFirst by isDeleted=false', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment());
      await service.getById('c-1');
      const where = mockPrisma.projectComment.findFirst.mock.calls[0][0].where;
      expect(where.isDeleted).toBe(false);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────
  describe('create', () => {
    beforeEach(() => {
      mockPrisma.projectComment.create.mockResolvedValue(makeComment({ id: 'c-new' }));
      mockPrisma.appUser.findMany.mockResolvedValue([]);
    });

    it('rejects empty content', async () => {
      const r = await service.create('p-1', 'u-author', '   ');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Contenu requis.');
      expect(mockPrisma.projectComment.create).not.toHaveBeenCalled();
    });

    it('rejects content over 20 000 chars', async () => {
      const r = await service.create('p-1', 'u-author', 'a'.repeat(20_001));
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/trop long/i);
      expect(mockPrisma.projectComment.create).not.toHaveBeenCalled();
    });

    it('creates the comment + writes an activity row', async () => {
      const r = await service.create('p-1', 'u-author', 'Hello world');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectComment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'p-1',
            userId: 'u-author',
            content: 'Hello world',
            parentCommentId: null,
            mentions: null,
          }),
        }),
      );
      // fire-and-forget activity write
      await new Promise((res) => setImmediate(res));
      expect(mockPrisma.projectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'comment_added' }) }),
      );
    });

    it('serialises @-mentions into the `mentions` column (max 10)', async () => {
      const mentioned = Array.from({ length: 12 }, (_, i) => `user${i}`).map((m) => `@${m}`).join(' ');
      await service.create('p-1', 'u-author', `Hey ${mentioned}`);
      const data = mockPrisma.projectComment.create.mock.calls[0][0].data;
      expect(typeof data.mentions).toBe('string');
      const parsed = JSON.parse(data.mentions);
      expect(parsed).toHaveLength(10); // capped
    });

    it('@-mentions trigger notifyEnhanced for each matched, active, non-self user', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([
        { id: 'u-alice' },
        { id: 'u-author' }, // self — must be skipped
        { id: 'u-bob' },
      ]);
      await service.create('p-1', 'u-author', 'Hello @Alice and @Bob');
      // notifyEnhanced is fire-and-forget — let it flush.
      await new Promise((res) => setImmediate(res));
      const recipients = mockNotifications.notifyEnhanced.mock.calls.map(
        (c: unknown[]) => (c[0] as { userId: string }).userId,
      );
      expect(recipients).toEqual(expect.arrayContaining(['u-alice', 'u-bob']));
      expect(recipients).not.toContain('u-author');
      // Each call carries type=comment_mention.
      for (const call of mockNotifications.notifyEnhanced.mock.calls) {
        expect((call[0] as { type: string }).type).toBe('comment_mention');
      }
    });

    it('records an activity row labelled comment_replied for reply creates', async () => {
      mockPrisma.projectComment.findUnique.mockResolvedValue({ userId: 'u-other', isDeleted: false });
      mockPrisma.projectComment.create.mockResolvedValue(
        makeComment({ id: 'c-reply', parentCommentId: 'c-parent' }),
      );
      await service.create('p-1', 'u-author', 'reply text', 'c-parent');
      await new Promise((res) => setImmediate(res));
      expect(mockPrisma.projectActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'comment_replied' }) }),
      );
    });

    it('reply notifies the parent author (excluded when parent is self)', async () => {
      mockPrisma.projectComment.findUnique.mockResolvedValue({ userId: 'u-parent', isDeleted: false });
      mockPrisma.projectComment.create.mockResolvedValue(
        makeComment({ id: 'c-reply', parentCommentId: 'c-parent' }),
      );
      await service.create('p-1', 'u-author', 'reply text', 'c-parent');
      await new Promise((res) => setImmediate(res));
      const replyNotify = mockNotifications.notifyEnhanced.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'comment_reply',
      );
      expect(replyNotify).toBeDefined();
      expect((replyNotify![0] as { userId: string }).userId).toBe('u-parent');
    });

    it('does NOT notify the parent author when they are the replier', async () => {
      mockPrisma.projectComment.findUnique.mockResolvedValue({ userId: 'u-author', isDeleted: false });
      mockPrisma.projectComment.create.mockResolvedValue(
        makeComment({ id: 'c-reply', parentCommentId: 'c-parent' }),
      );
      await service.create('p-1', 'u-author', 'self-reply', 'c-parent');
      await new Promise((res) => setImmediate(res));
      const replyNotify = mockNotifications.notifyEnhanced.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'comment_reply',
      );
      expect(replyNotify).toBeUndefined();
    });

    it('does NOT notify the parent author when the parent is soft-deleted', async () => {
      mockPrisma.projectComment.findUnique.mockResolvedValue({ userId: 'u-parent', isDeleted: true });
      mockPrisma.projectComment.create.mockResolvedValue(
        makeComment({ id: 'c-reply', parentCommentId: 'c-parent' }),
      );
      await service.create('p-1', 'u-author', 'reply text', 'c-parent');
      await new Promise((res) => setImmediate(res));
      const replyNotify = mockNotifications.notifyEnhanced.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'comment_reply',
      );
      expect(replyNotify).toBeUndefined();
    });

    it('does NOT notify the parent author when the parent does not exist', async () => {
      mockPrisma.projectComment.findUnique.mockResolvedValue(null);
      mockPrisma.projectComment.create.mockResolvedValue(
        makeComment({ id: 'c-reply', parentCommentId: 'c-parent' }),
      );
      await service.create('p-1', 'u-author', 'reply text', 'c-parent');
      await new Promise((res) => setImmediate(res));
      const replyNotify = mockNotifications.notifyEnhanced.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'comment_reply',
      );
      expect(replyNotify).toBeUndefined();
    });

    it('truncates the activity detail at 120 chars with ellipsis', async () => {
      const long = 'a'.repeat(200);
      await service.create('p-1', 'u-author', long);
      await new Promise((res) => setImmediate(res));
      const detail = mockPrisma.projectActivity.create.mock.calls[0][0].data.detail as string;
      expect(detail.length).toBeLessThanOrEqual(121); // 120 + '…'
      expect(detail.endsWith('…')).toBe(true);
    });

    it('activity row failure does not throw (non-fatal catch)', async () => {
      mockPrisma.projectActivity.create.mockRejectedValueOnce(new Error('DB down'));
      const r = await service.create('p-1', 'u-author', 'OK');
      // The non-fatal catch lives on the promise chain; just confirm Result is OK.
      expect(r.isSuccess).toBe(true);
    });

    it('notifyMentions failure does not throw', async () => {
      mockPrisma.appUser.findMany.mockRejectedValueOnce(new Error('DB down'));
      const r = await service.create('p-1', 'u-author', 'hey @Bob');
      expect(r.isSuccess).toBe(true);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('update', () => {
    it('rejects when comment not found', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(null);
      const r = await service.update('c-1', 'u-author', false, 'edit');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Commentaire non trouvé.');
    });

    it('rejects when the editor is neither author nor admin', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      const r = await service.update('c-1', 'u-attacker', false, 'edit');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Non autorisé.');
      expect(mockPrisma.projectComment.update).not.toHaveBeenCalled();
    });

    it('allows the author to update', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      mockPrisma.projectComment.update.mockResolvedValue(makeComment({ content: 'edited' }));
      const r = await service.update('c-1', 'u-author', false, 'edited @Bob');
      expect(r.isSuccess).toBe(true);
      const data = mockPrisma.projectComment.update.mock.calls[0][0].data;
      expect(data.content).toBe('edited @Bob');
      expect(JSON.parse(data.mentions)).toEqual(['Bob']);
    });

    it('admin override — non-author admin can update', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      mockPrisma.projectComment.update.mockResolvedValue(makeComment());
      const r = await service.update('c-1', 'u-admin', true, 'admin-edit');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectComment.update).toHaveBeenCalled();
    });
  });

  // ── deleteComment ────────────────────────────────────────────────────────
  describe('deleteComment', () => {
    it('rejects when not found', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(null);
      const r = await service.deleteComment('c-1', 'u-author', false);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Commentaire non trouvé.');
    });

    it('rejects when not author and not admin', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      const r = await service.deleteComment('c-1', 'u-attacker', false);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Non autorisé.');
      expect(mockPrisma.projectComment.update).not.toHaveBeenCalled();
    });

    it('soft-deletes (sets isDeleted=true, never hard delete) for the author', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      mockPrisma.projectComment.update.mockResolvedValue(makeComment({ isDeleted: true }));
      const r = await service.deleteComment('c-1', 'u-author', false);
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectComment.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: { isDeleted: true },
      });
    });

    it('admin override — non-author admin can soft-delete', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ userId: 'u-author' }));
      mockPrisma.projectComment.update.mockResolvedValue(makeComment({ isDeleted: true }));
      const r = await service.deleteComment('c-1', 'u-admin', true);
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.projectComment.update).toHaveBeenCalled();
    });

    it('only acts on isDeleted=false comments (idempotent)', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(null); // already-deleted is filtered out
      const r = await service.deleteComment('c-1', 'u-author', false);
      expect(r.isFailure).toBe(true);
      const where = mockPrisma.projectComment.findFirst.mock.calls[0][0].where;
      expect(where.isDeleted).toBe(false);
    });
  });

  // ── DTO + parseMentions ──────────────────────────────────────────────────
  describe('toDto + mentions parsing', () => {
    it('parses JSON mentions into an array', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(
        makeComment({ mentions: '["Alice","Bob"]' }),
      );
      const r = await service.getById('c-1');
      const v = r.value as { mentions: unknown[] };
      expect(v.mentions).toEqual(['Alice', 'Bob']);
    });

    it('returns [] mentions when stored value is malformed JSON', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ mentions: 'not json' }));
      const r = await service.getById('c-1');
      const v = r.value as { mentions: unknown[] };
      expect(v.mentions).toEqual([]);
    });

    it('returns [] mentions when stored value is null', async () => {
      mockPrisma.projectComment.findFirst.mockResolvedValue(makeComment({ mentions: null }));
      const r = await service.getById('c-1');
      const v = r.value as { mentions: unknown[] };
      expect(v.mentions).toEqual([]);
    });
  });
});
