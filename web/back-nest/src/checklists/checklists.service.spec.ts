import { Test, TestingModule } from '@nestjs/testing';
import { ChecklistsService } from './checklists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockPrisma = {
  phaseChecklist: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    aggregate: jest.fn(),
    delete: jest.fn(),
  },
};

function makeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ck-1',
    projectId: 'p-1',
    phase: 'Draft',
    label: 'Cadrage initial validé',
    isChecked: false,
    checkedBy: null,
    checkedAt: null,
    orderIndex: 0,
    createdAt: new Date('2026-01-01'),
    checker: null,
    ...overrides,
  };
}

describe('ChecklistsService', () => {
  let service: ChecklistsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ChecklistsService>(ChecklistsService);
  });

  // ── getForProjectPhase ────────────────────────────────────────────────────
  describe('getForProjectPhase', () => {
    it('returns existing items mapped to DTOs (no seed needed)', async () => {
      mockPrisma.phaseChecklist.findMany.mockResolvedValue([
        makeItem(),
        makeItem({ id: 'ck-2', orderIndex: 1, isChecked: true, checker: { id: 'u', firstName: 'Bob', lastName: 'L' } }),
      ]);

      const r = await service.getForProjectPhase('p-1', 'Draft');

      expect(r.isSuccess).toBe(true);
      const items = (r.value as Array<{ id: string; checkedBy: string | null }>) ?? [];
      expect(items).toHaveLength(2);
      expect(items[1].checkedBy).toBe('Bob L');
      expect(mockPrisma.phaseChecklist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: 'p-1', phase: 'Draft' },
          orderBy: { orderIndex: 'asc' },
        }),
      );
      // Did NOT seed because items existed.
      expect(mockPrisma.phaseChecklist.createMany).not.toHaveBeenCalled();
    });

    it('seeds the phase defaults then recurses when the phase is empty (known phase)', async () => {
      mockPrisma.phaseChecklist.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeItem(), makeItem({ id: 'ck-2', orderIndex: 1 })]);
      mockPrisma.phaseChecklist.createMany.mockResolvedValue({ count: 2 });

      const r = await service.getForProjectPhase('p-1', 'Draft');

      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.phaseChecklist.createMany).toHaveBeenCalledTimes(1);
      const args = mockPrisma.phaseChecklist.createMany.mock.calls[0][0];
      expect(args.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ projectId: 'p-1', phase: 'Draft', label: 'Cadrage initial validé', orderIndex: 0 }),
          expect.objectContaining({ projectId: 'p-1', phase: 'Draft', label: 'Équipe projet identifiée', orderIndex: 1 }),
        ]),
      );
      expect(args.skipDuplicates).toBe(true);
      // Recursed once: 2 findMany + 1 createMany.
      expect(mockPrisma.phaseChecklist.findMany).toHaveBeenCalledTimes(2);
    });

    it('returns Result.ok([]) for an unknown phase (no defaults → no recursion)', async () => {
      // The earlier version of getForProjectPhase recursed forever when the
      // phase had no defaults (seedDefaults was a no-op and findMany kept
      // returning empty). The service now guards on PHASE_DEFAULTS having
      // entries before recursing.
      mockPrisma.phaseChecklist.findMany.mockResolvedValueOnce([]);

      const r = await service.getForProjectPhase('p1', 'NotAPhase');

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual([]);
      expect(mockPrisma.phaseChecklist.createMany).not.toHaveBeenCalled();
      // Only ONE findMany call — no recursion.
      expect(mockPrisma.phaseChecklist.findMany).toHaveBeenCalledTimes(1);
    });

    it('every PHASE_DEFAULTS phase seeds the expected count', async () => {
      // Drive each phase once with empty result + non-empty on second call,
      // and verify createMany.data.length matches the documented seed.
      const expected: Record<string, number> = {
        Draft: 2, Kickoff: 3, CadrageTechnique: 3, Environnement: 3,
        Parametrage: 3, Integration: 3, Recette: 3, MEP: 3, Cloture: 3,
      };
      for (const [phase, count] of Object.entries(expected)) {
        mockPrisma.phaseChecklist.findMany.mockReset();
        mockPrisma.phaseChecklist.createMany.mockReset();
        // First findMany returns empty (triggers seedDefaults); second
        // returns at least one item so the recursion terminates.
        mockPrisma.phaseChecklist.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([makeItem({ phase })]);
        await service.getForProjectPhase('p-1', phase);
        const data = mockPrisma.phaseChecklist.createMany.mock.calls[0][0].data as unknown[];
        expect(data).toHaveLength(count);
      }
    });

    it('DTO maps checker null → checkedBy null', async () => {
      mockPrisma.phaseChecklist.findMany.mockResolvedValue([
        makeItem({ checker: null, isChecked: false }),
      ]);
      const r = await service.getForProjectPhase('p-1', 'Draft');
      const items = r.value as Array<{ checkedBy: string | null }>;
      expect(items[0].checkedBy).toBeNull();
    });
  });

  // ── toggle ────────────────────────────────────────────────────────────────
  describe('toggle', () => {
    it('returns failure when the item does not exist', async () => {
      mockPrisma.phaseChecklist.findUnique.mockResolvedValue(null);
      const r = await service.toggle('ck-x', 'u-1', true);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Élément non trouvé.');
      expect(mockPrisma.phaseChecklist.update).not.toHaveBeenCalled();
    });

    it('marks as checked sets checkedBy + checkedAt', async () => {
      mockPrisma.phaseChecklist.findUnique.mockResolvedValue(makeItem());
      mockPrisma.phaseChecklist.update.mockResolvedValue(makeItem({ isChecked: true, checker: { id: 'u-1', firstName: 'Alice', lastName: 'PM' } }));

      const r = await service.toggle('ck-1', 'u-1', true);
      expect(r.isSuccess).toBe(true);
      const update = mockPrisma.phaseChecklist.update.mock.calls[0][0];
      expect(update.data.isChecked).toBe(true);
      expect(update.data.checkedBy).toBe('u-1');
      expect(update.data.checkedAt).toBeInstanceOf(Date);
    });

    it('unchecking clears checkedBy + checkedAt', async () => {
      mockPrisma.phaseChecklist.findUnique.mockResolvedValue(makeItem({ isChecked: true }));
      mockPrisma.phaseChecklist.update.mockResolvedValue(makeItem({ isChecked: false }));

      const r = await service.toggle('ck-1', 'u-1', false);
      expect(r.isSuccess).toBe(true);
      const update = mockPrisma.phaseChecklist.update.mock.calls[0][0];
      expect(update.data.isChecked).toBe(false);
      expect(update.data.checkedBy).toBeNull();
      expect(update.data.checkedAt).toBeNull();
    });
  });

  // ── addItem ───────────────────────────────────────────────────────────────
  describe('addItem', () => {
    it('appends at orderIndex = max + 1', async () => {
      mockPrisma.phaseChecklist.aggregate.mockResolvedValue({ _max: { orderIndex: 4 } });
      mockPrisma.phaseChecklist.create.mockResolvedValue(makeItem({ id: 'ck-new', orderIndex: 5, label: 'New item' }));

      const r = await service.addItem('p-1', 'Draft', 'New item');
      expect(r.isSuccess).toBe(true);
      const args = mockPrisma.phaseChecklist.create.mock.calls[0][0];
      expect(args.data).toEqual({ projectId: 'p-1', phase: 'Draft', label: 'New item', orderIndex: 5 });
    });

    it('uses orderIndex 0 when no items exist yet (_max.orderIndex null)', async () => {
      mockPrisma.phaseChecklist.aggregate.mockResolvedValue({ _max: { orderIndex: null } });
      mockPrisma.phaseChecklist.create.mockResolvedValue(makeItem({ id: 'ck-first', orderIndex: 0 }));

      const r = await service.addItem('p-1', 'Draft', 'First');
      expect(r.isSuccess).toBe(true);
      const args = mockPrisma.phaseChecklist.create.mock.calls[0][0];
      expect(args.data.orderIndex).toBe(0);
    });

    it('scopes the aggregate to the same project+phase', async () => {
      mockPrisma.phaseChecklist.aggregate.mockResolvedValue({ _max: { orderIndex: 0 } });
      mockPrisma.phaseChecklist.create.mockResolvedValue(makeItem());
      await service.addItem('p-1', 'Draft', 'X');
      const agg = mockPrisma.phaseChecklist.aggregate.mock.calls[0][0];
      expect(agg.where).toEqual({ projectId: 'p-1', phase: 'Draft' });
    });
  });

  // ── deleteItem ────────────────────────────────────────────────────────────
  describe('deleteItem', () => {
    it('returns failure when not found', async () => {
      mockPrisma.phaseChecklist.findUnique.mockResolvedValue(null);
      const r = await service.deleteItem('ck-x');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Élément non trouvé.');
      expect(mockPrisma.phaseChecklist.delete).not.toHaveBeenCalled();
    });

    it('hard-deletes (no soft-delete column on this model)', async () => {
      mockPrisma.phaseChecklist.findUnique.mockResolvedValue(makeItem());
      mockPrisma.phaseChecklist.delete.mockResolvedValue(makeItem());
      const r = await service.deleteItem('ck-1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.phaseChecklist.delete).toHaveBeenCalledWith({ where: { id: 'ck-1' } });
    });
  });

  // ── getProgress ───────────────────────────────────────────────────────────
  describe('getProgress', () => {
    it('aggregates by phase with total + checked counts', async () => {
      mockPrisma.phaseChecklist.findMany.mockResolvedValue([
        makeItem({ phase: 'Draft', isChecked: true }),
        makeItem({ phase: 'Draft', isChecked: false }),
        makeItem({ phase: 'Kickoff', isChecked: true }),
        makeItem({ phase: 'Kickoff', isChecked: true }),
        makeItem({ phase: 'Kickoff', isChecked: false }),
      ]);
      const r = await service.getProgress('p-1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({
        Draft: { total: 2, checked: 1 },
        Kickoff: { total: 3, checked: 2 },
      });
    });

    it('returns an empty record when the project has no items', async () => {
      mockPrisma.phaseChecklist.findMany.mockResolvedValue([]);
      const r = await service.getProgress('p-1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({});
    });

    it('scopes the findMany to the project', async () => {
      mockPrisma.phaseChecklist.findMany.mockResolvedValue([]);
      await service.getProgress('p-1');
      const where = mockPrisma.phaseChecklist.findMany.mock.calls[0][0].where;
      expect(where).toEqual({ projectId: 'p-1' });
    });
  });
});
