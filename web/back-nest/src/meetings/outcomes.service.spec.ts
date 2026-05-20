import { Test, TestingModule } from '@nestjs/testing';
import { OutcomesService } from './outcomes.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const mockPrisma = {
  meetingOutcome: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workPackage: {
    create: jest.fn(),
  },
};

const mockNotifications = {
  notifyEnhanced: jest.fn().mockResolvedValue(undefined),
};

describe('OutcomesService', () => {
  let service: OutcomesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutcomesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get<OutcomesService>(OutcomesService);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns outcomes without a type filter', async () => {
      const rows = [{ id: 'o1', meetingId: 'm1', type: 'Decision', description: 'X' }];
      mockPrisma.meetingOutcome.findMany.mockResolvedValue(rows);

      const r = await service.list('m1');

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(rows);
      const call = mockPrisma.meetingOutcome.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ meetingId: 'm1' });
    });

    it('applies the type filter when provided', async () => {
      mockPrisma.meetingOutcome.findMany.mockResolvedValue([]);
      await service.list('m1', 'Risk');
      const call = mockPrisma.meetingOutcome.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ meetingId: 'm1', type: 'Risk' });
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.meetingOutcome.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.list('m1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('writes type + description with optional ownerId and parsed dueDate', async () => {
      mockPrisma.meetingOutcome.create.mockResolvedValue({ id: 'o-new' });

      await service.create('m1', {
        type: 'ActionItem',
        description: 'Send the contract',
        ownerId: 'u1',
        dueDate: '2026-12-31',
      });

      const call = mockPrisma.meetingOutcome.create.mock.calls[0][0] as { data: { meetingId: string; type: string; description: string; ownerId: string; dueDate: Date } };
      expect(call.data.meetingId).toBe('m1');
      expect(call.data.type).toBe('ActionItem');
      expect(call.data.description).toBe('Send the contract');
      expect(call.data.ownerId).toBe('u1');
      expect(call.data.dueDate).toBeInstanceOf(Date);
      expect(call.data.dueDate.toISOString()).toMatch(/^2026-12-31/);
    });

    it('defaults optional fields to null when omitted', async () => {
      mockPrisma.meetingOutcome.create.mockResolvedValue({ id: 'o-new' });
      await service.create('m1', { type: 'Decision', description: 'X' });
      const call = mockPrisma.meetingOutcome.create.mock.calls[0][0] as { data: { ownerId: unknown; dueDate: unknown } };
      expect(call.data.ownerId).toBeNull();
      expect(call.data.dueDate).toBeNull();
    });

    it('returns failure when Prisma rejects', async () => {
      mockPrisma.meetingOutcome.create.mockRejectedValue(new Error('DB down'));
      const r = await service.create('m1', { type: 'Decision', description: 'X' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('forwards only the defined fields (undefined values stripped)', async () => {
      mockPrisma.meetingOutcome.update.mockResolvedValue({ id: 'o1' });
      await service.update('o1', { description: 'Renamed' });
      const call = mockPrisma.meetingOutcome.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).toEqual({ description: 'Renamed' });
    });

    it('parses dueDate string into a Date instance', async () => {
      mockPrisma.meetingOutcome.update.mockResolvedValue({ id: 'o1' });
      await service.update('o1', { dueDate: '2026-06-15' });
      const call = mockPrisma.meetingOutcome.update.mock.calls[0][0] as { data: { dueDate: Date } };
      expect(call.data.dueDate).toBeInstanceOf(Date);
    });

    it('supports clearing dueDate with null', async () => {
      mockPrisma.meetingOutcome.update.mockResolvedValue({ id: 'o1' });
      await service.update('o1', { dueDate: null });
      const call = mockPrisma.meetingOutcome.update.mock.calls[0][0] as { data: { dueDate: null } };
      expect(call.data.dueDate).toBeNull();
    });

    it('supports clearing ownerId with null', async () => {
      mockPrisma.meetingOutcome.update.mockResolvedValue({ id: 'o1' });
      await service.update('o1', { ownerId: null });
      const call = mockPrisma.meetingOutcome.update.mock.calls[0][0] as { data: { ownerId: null } };
      expect(call.data.ownerId).toBeNull();
    });

    it('returns failure when Prisma rejects', async () => {
      mockPrisma.meetingOutcome.update.mockRejectedValue(new Error('P2025'));
      const r = await service.update('missing', { type: 'X' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the row by id', async () => {
      mockPrisma.meetingOutcome.delete.mockResolvedValue({});
      const r = await service.delete('o1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingOutcome.delete).toHaveBeenCalledWith({ where: { id: 'o1' } });
    });

    it('returns failure when Prisma rejects', async () => {
      mockPrisma.meetingOutcome.delete.mockRejectedValue(new Error('P2025'));
      const r = await service.delete('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── convertToWorkPackage ──────────────────────────────────────────────────

  describe('convertToWorkPackage', () => {
    it('returns failure when the outcome does not exist', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue(null);
      const r = await service.convertToWorkPackage('missing', 'p1', 'author-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Issue introuvable.');
      expect(mockPrisma.workPackage.create).not.toHaveBeenCalled();
    });

    it('refuses to convert when the outcome already has a workPackageId', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1',
        workPackageId: 'wp-existing',
        meeting: { projectId: 'p1' },
      });
      const r = await service.convertToWorkPackage('o1', 'p1', 'author-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/déjà converti/);
      expect(mockPrisma.workPackage.create).not.toHaveBeenCalled();
    });

    it('uses the meeting projectId (not the URL param) — guards against URL spoofing', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1',
        workPackageId: null,
        description: 'Investigate Y',
        type: 'ActionItem',
        ownerId: 'u-assignee',
        dueDate: new Date('2026-12-31'),
        meeting: { projectId: 'real-project' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({ id: 'wp1', assigneeId: 'u-assignee', title: 'Investigate Y' });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      const r = await service.convertToWorkPackage('o1', 'spoofed-project', 'author-1');

      expect(r.isSuccess).toBe(true);
      const wpCall = mockPrisma.workPackage.create.mock.calls[0][0] as { data: { projectId: string } };
      expect(wpCall.data.projectId).toBe('real-project');
    });

    it('maps ActionItem → Task / Normal priority', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'Send doc', type: 'ActionItem',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({ id: 'wp1', assigneeId: null, title: 'Send doc' });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');

      const wpCall = mockPrisma.workPackage.create.mock.calls[0][0] as { data: { type: string; priority: string } };
      expect(wpCall.data.type).toBe('Task');
      expect(wpCall.data.priority).toBe('Normal');
    });

    it('maps Risk → Bug / High priority', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'Schema drift risk', type: 'Risk',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({ id: 'wp1', assigneeId: null, title: 'Schema drift risk' });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');

      const wpCall = mockPrisma.workPackage.create.mock.calls[0][0] as { data: { type: string; priority: string } };
      expect(wpCall.data.type).toBe('Bug');
      expect(wpCall.data.priority).toBe('High');
    });

    it('truncates title to 255 chars and description to 10k', async () => {
      const longText = 'X'.repeat(20_000);
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: longText, type: 'ActionItem',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({ id: 'wp1', assigneeId: null, title: 'X' });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');

      const wpCall = mockPrisma.workPackage.create.mock.calls[0][0] as { data: { title: string; description: string } };
      expect(wpCall.data.title.length).toBe(255);
      expect(wpCall.data.description.length).toBe(10_000);
    });

    it('links the outcome back to the new WP via meetingOutcome.update', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'X', type: 'ActionItem',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({ id: 'wp-new', assigneeId: null, title: 'X' });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');

      expect(mockPrisma.meetingOutcome.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { workPackageId: 'wp-new' },
      });
    });

    it('notifies the assignee when assignee !== author', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'Investigate', type: 'ActionItem',
        ownerId: 'u-assignee', dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({
        id: 'wp1', assigneeId: 'u-assignee', title: 'Investigate',
      });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');
      // notifyEnhanced is fire-and-forget — flush microtasks so the promise resolves.
      await Promise.resolve();
      await Promise.resolve();

      expect(mockNotifications.notifyEnhanced).toHaveBeenCalledTimes(1);
      const notifyArgs = mockNotifications.notifyEnhanced.mock.calls[0][0] as {
        userId: string; actorId: string; type: string; reason: string; projectId: string;
      };
      expect(notifyArgs.userId).toBe('u-assignee');
      expect(notifyArgs.actorId).toBe('author-1');
      expect(notifyArgs.type).toBe('work_package_assigned');
      expect(notifyArgs.reason).toBe('Assignee');
      expect(notifyArgs.projectId).toBe('p1');
    });

    it('does NOT notify when assignee === author (self-assignment)', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'X', type: 'ActionItem',
        ownerId: 'author-1', dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({
        id: 'wp1', assigneeId: 'author-1', title: 'X',
      });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');
      await Promise.resolve();

      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('does NOT notify when there is no assignee', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'X', type: 'ActionItem',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockResolvedValue({
        id: 'wp1', assigneeId: null, title: 'X',
      });
      mockPrisma.meetingOutcome.update.mockResolvedValue({});

      await service.convertToWorkPackage('o1', 'p1', 'author-1');
      await Promise.resolve();

      expect(mockNotifications.notifyEnhanced).not.toHaveBeenCalled();
    });

    it('returns failure when wp.create throws', async () => {
      mockPrisma.meetingOutcome.findUnique.mockResolvedValue({
        id: 'o1', workPackageId: null,
        description: 'X', type: 'ActionItem',
        ownerId: null, dueDate: null,
        meeting: { projectId: 'p1' },
      });
      mockPrisma.workPackage.create.mockRejectedValue(new Error('DB down'));
      const r = await service.convertToWorkPackage('o1', 'p1', 'author-1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec de la conversion.');
    });
  });
});
