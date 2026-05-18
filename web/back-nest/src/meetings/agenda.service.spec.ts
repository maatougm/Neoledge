import { Test, TestingModule } from '@nestjs/testing';
import { AgendaService } from './agenda.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  meetingAgendaItem: {
    findMany: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('AgendaService', () => {
  let service: AgendaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgendaService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<AgendaService>(AgendaService);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns rows ordered by position with responsible details', async () => {
      const rows = [
        { id: 'a1', meetingId: 'm1', position: 0, title: 'Welcome', responsible: { id: 'u1', firstName: 'A', lastName: 'B' } },
        { id: 'a2', meetingId: 'm1', position: 1, title: 'Status', responsible: null },
      ];
      mockPrisma.meetingAgendaItem.findMany.mockResolvedValue(rows);

      const r = await service.list('m1');

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(rows);
      expect(mockPrisma.meetingAgendaItem.findMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1' },
        include: { responsible: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { position: 'asc' },
      });
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.list('m1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('appends to the end (max position + 1) and forwards optional fields', async () => {
      mockPrisma.meetingAgendaItem.aggregate.mockResolvedValue({ _max: { position: 4 } });
      mockPrisma.meetingAgendaItem.create.mockResolvedValue({ id: 'a-new', position: 5 });

      const r = await service.create('m1', {
        title: 'Démo Elise',
        duration: 30,
        responsibleId: 'u1',
        notes: 'préparer le slide',
      });

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAgendaItem.create).toHaveBeenCalledWith({
        data: {
          meetingId: 'm1',
          title: 'Démo Elise',
          duration: 30,
          responsibleId: 'u1',
          notes: 'préparer le slide',
          position: 5,
        },
      });
    });

    it('uses position 0 when there are no existing items (max null)', async () => {
      mockPrisma.meetingAgendaItem.aggregate.mockResolvedValue({ _max: { position: null } });
      mockPrisma.meetingAgendaItem.create.mockResolvedValue({ id: 'a-new', position: 0 });

      await service.create('m1', { title: 'First item' });

      const call = mockPrisma.meetingAgendaItem.create.mock.calls[0][0] as { data: { position: number; duration: unknown; responsibleId: unknown; notes: unknown } };
      expect(call.data.position).toBe(0);
      expect(call.data.duration).toBeNull();
      expect(call.data.responsibleId).toBeNull();
      expect(call.data.notes).toBeNull();
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.meetingAgendaItem.aggregate.mockResolvedValue({ _max: { position: 0 } });
      mockPrisma.meetingAgendaItem.create.mockRejectedValue(new Error('unique violation'));
      const r = await service.create('m1', { title: 'X' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec de la création.');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('forwards the patch to Prisma and returns the updated row', async () => {
      const updated = { id: 'a1', title: 'Renamed' };
      mockPrisma.meetingAgendaItem.update.mockResolvedValue(updated);

      const r = await service.update('a1', { title: 'Renamed' });

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(updated);
      expect(mockPrisma.meetingAgendaItem.update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { title: 'Renamed' },
      });
    });

    it('returns failure when Prisma rejects (e.g. row not found)', async () => {
      mockPrisma.meetingAgendaItem.update.mockRejectedValue(new Error('P2025'));
      const r = await service.update('missing', { title: 'X' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('removes the row by id', async () => {
      mockPrisma.meetingAgendaItem.delete.mockResolvedValue({});
      const r = await service.delete('a1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAgendaItem.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
    });

    it('returns failure when Prisma rejects', async () => {
      mockPrisma.meetingAgendaItem.delete.mockRejectedValue(new Error('P2025'));
      const r = await service.delete('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── reorder ───────────────────────────────────────────────────────────────

  describe('reorder', () => {
    it('rejects ids that do not belong to this meeting (scope check)', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);

      const r = await service.reorder('m1', ['a1', 'foreign-id', 'a2']);

      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('n\'appartiennent pas');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('commits all position updates atomically in a single $transaction', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
      // Capture the prepared statements before $transaction runs them.
      const updateCalls: Array<{ where: unknown; data: unknown }> = [];
      mockPrisma.meetingAgendaItem.update.mockImplementation((args) => {
        updateCalls.push(args);
        return Promise.resolve(args);
      });
      mockPrisma.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));

      const r = await service.reorder('m1', ['a3', 'a1', 'a2']);

      expect(r.isSuccess).toBe(true);
      expect(updateCalls).toEqual([
        { where: { id: 'a3', meetingId: 'm1' }, data: { position: 0 } },
        { where: { id: 'a1', meetingId: 'm1' }, data: { position: 1 } },
        { where: { id: 'a2', meetingId: 'm1' }, data: { position: 2 } },
      ]);
    });

    it('returns failure when Prisma rejects mid-transaction', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockResolvedValue([{ id: 'a1' }]);
      mockPrisma.$transaction.mockRejectedValue(new Error('deadlock'));
      const r = await service.reorder('m1', ['a1']);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });

    it('returns failure when the initial validation findMany throws', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.reorder('m1', ['a1']);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });

    it('handles an empty order array as a no-op success', async () => {
      mockPrisma.meetingAgendaItem.findMany.mockResolvedValue([]);
      mockPrisma.$transaction.mockResolvedValue([]);
      const r = await service.reorder('m1', []);
      expect(r.isSuccess).toBe(true);
    });
  });
});
