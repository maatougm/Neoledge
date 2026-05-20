import { Test, TestingModule } from '@nestjs/testing';
import { CollaborationService } from './collaboration.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingIndexerService } from '../ai/embeddings/embedding-indexer.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  projectFieldValue: {
    updateMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
  },
};

const mockEmbeddingIndexer = {
  indexAndStore: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollaborationService', () => {
  let service: CollaborationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollaborationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingIndexerService, useValue: mockEmbeddingIndexer },
      ],
    }).compile();

    service = module.get<CollaborationService>(CollaborationService);
  });

  // ── saveField ─────────────────────────────────────────────────────────────

  describe('saveField', () => {
    it('updates existing row when one exists (updateMany count > 0)', async () => {
      // Use fake timers so scheduleEmbed's setTimeout does not actually fire.
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });

      await service.saveField('proj-1', 'field-1', 'new value', 'user-1');

      expect(mockPrisma.projectFieldValue.updateMany).toHaveBeenCalledWith({
        where: { projectId: 'proj-1', projectFieldId: 'field-1' },
        data: { value: 'new value', updatedBy: 'user-1' },
      });
      expect(mockPrisma.projectFieldValue.create).not.toHaveBeenCalled();
    });

    it('falls back to create when no existing row matched (updateMany count === 0)', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.projectFieldValue.create.mockResolvedValue({ id: 'fv-new' });

      await service.saveField('proj-1', 'field-1', 'first value', 'user-1');

      expect(mockPrisma.projectFieldValue.updateMany).toHaveBeenCalled();
      expect(mockPrisma.projectFieldValue.create).toHaveBeenCalledWith({
        data: {
          projectId: 'proj-1',
          projectFieldId: 'field-1',
          value: 'first value',
          updatedBy: 'user-1',
        },
      });
    });

    it('schedules an embedding after the write (setTimeout queued)', async () => {
      jest.useFakeTimers();
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });

      await service.saveField('proj-1', 'field-1', 'val', 'user-1');

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1500);
    });
  });

  // ── scheduleEmbed (debounce) ──────────────────────────────────────────────

  describe('scheduleEmbed debouncing', () => {
    it('coalesces rapid saveField calls into ONE indexer call after 1500ms', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-1',
        value: 'final value',
        field: { label: 'Stack' },
      });
      mockEmbeddingIndexer.indexAndStore.mockResolvedValue({ indexed: 1, failed: 0 });

      // Three rapid keystrokes within the debounce window.
      await service.saveField('proj-1', 'field-1', 'v1', 'user-1');
      await service.saveField('proj-1', 'field-1', 'v2', 'user-1');
      await service.saveField('proj-1', 'field-1', 'final value', 'user-1');

      // Indexer not called yet — still inside the debounce window.
      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();

      // Advance past the debounce.
      jest.advanceTimersByTime(1500);
      // Allow the queued microtasks to drain (the setTimeout callback awaits
      // runEmbed which awaits findUnique + indexer).
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Only ONE indexer call, not three.
      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledTimes(1);
    });

    it('schedules independently per (projectId,fieldId) — separate keys fire separately', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-x',
        value: 'value',
        field: { label: 'L' },
      });
      mockEmbeddingIndexer.indexAndStore.mockResolvedValue({ indexed: 1, failed: 0 });

      await service.saveField('proj-1', 'field-A', 'a', 'user-1');
      await service.saveField('proj-1', 'field-B', 'b', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledTimes(2);
    });
  });

  // ── runEmbed (private, exercised via the debounce) ────────────────────────

  describe('runEmbed via debounce', () => {
    it('reads back the row, formats "label: value", and calls indexer', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-1',
        value: 'PostgreSQL + NestJS',
        field: { label: 'Stack technique' },
      });
      mockEmbeddingIndexer.indexAndStore.mockResolvedValue({ indexed: 1, failed: 0 });

      await service.saveField('proj-1', 'field-1', 'PostgreSQL + NestJS', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockPrisma.projectFieldValue.findUnique).toHaveBeenCalledWith({
        where: { projectId_projectFieldId: { projectId: 'proj-1', projectFieldId: 'field-1' } },
        select: {
          id: true,
          value: true,
          field: { select: { label: true } },
        },
      });
      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledWith(
        'field-value',
        [{ id: 'fv-1', text: 'Stack technique: PostgreSQL + NestJS' }],
        { projectId: 'proj-1' },
      );
    });

    it('falls back to "Champ" label when field.label is missing', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-2',
        value: 'value here',
        field: null,
      });
      mockEmbeddingIndexer.indexAndStore.mockResolvedValue({ indexed: 1, failed: 0 });

      await service.saveField('proj-1', 'field-1', 'value here', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).toHaveBeenCalledWith(
        'field-value',
        [{ id: 'fv-2', text: 'Champ: value here' }],
        { projectId: 'proj-1' },
      );
    });

    it('skips embedding when row value is empty', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-3',
        value: '',
        field: { label: 'Stack' },
      });

      await service.saveField('proj-1', 'field-1', '', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();
    });

    it('skips embedding when row value is whitespace only', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue({
        id: 'fv-4',
        value: '   \n\t  ',
        field: { label: 'Stack' },
      });

      await service.saveField('proj-1', 'field-1', '   ', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();
    });

    it('skips embedding when row is not found (null)', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockResolvedValue(null);

      await service.saveField('proj-1', 'field-1', 'val', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();
    });

    it('swallows errors from runEmbed via the .catch on the scheduled call', async () => {
      jest.useFakeTimers();
      mockPrisma.projectFieldValue.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.projectFieldValue.findUnique.mockRejectedValue(new Error('DB hiccup'));

      // Should not throw out of the scheduled callback.
      await service.saveField('proj-1', 'field-1', 'val', 'user-1');

      jest.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Indexer was never called because findUnique threw; service did not crash.
      expect(mockEmbeddingIndexer.indexAndStore).not.toHaveBeenCalled();
    });
  });
});
