import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingIndexerService, IndexTarget } from './embedding-indexer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingsService } from './embeddings.service';
import { Result } from '../../common/result';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  $executeRawUnsafe: jest.fn(),
};

const mockEmbeddings = {
  isConfigured: jest.fn().mockReturnValue(true),
  embed: jest.fn(),
};

const PID = 'p1';

function okResult<T>(value: T): Result<T> {
  return Result.ok(value);
}

function failResult<T>(error: string): Result<T> {
  return Result.fail<T>(error);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingIndexerService', () => {
  let service: EmbeddingIndexerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEmbeddings.isConfigured.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingIndexerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmbeddingsService, useValue: mockEmbeddings },
      ],
    }).compile();

    service = module.get<EmbeddingIndexerService>(EmbeddingIndexerService);
  });

  // ── Early-exit guards ─────────────────────────────────────────────────────

  describe('early-exit guards', () => {
    it('returns {indexed:0,failed:0} on empty items array (no embed roundtrip)', async () => {
      const r = await service.indexAndStore('segment', [], { projectId: PID });
      expect(r).toEqual({ indexed: 0, failed: 0 });
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('returns {indexed:0,failed:N} when embeddings service is not configured', async () => {
      mockEmbeddings.isConfigured.mockReturnValue(false);

      const items = [
        { id: 's1', text: 'foo' },
        { id: 's2', text: 'bar' },
      ];
      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 0, failed: 2 });
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('filters out items with empty text BEFORE calling embed', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1, 0.2, 0.3]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      const items = [
        { id: 's1', text: 'real text' },
        { id: 's2', text: '' },
        { id: 's3', text: '   \n\t  ' },
        { id: 's4', text: null as unknown as string },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 1, failed: 0 });
      expect(mockEmbeddings.embed).toHaveBeenCalledWith(['real text'], 'passage', { projectId: PID });
    });

    it('returns {indexed:0,failed:0} when every item is filtered out', async () => {
      const items = [
        { id: 's1', text: '' },
        { id: 's2', text: '   ' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 0, failed: 0 });
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
    });
  });

  // ── Multi-tenancy guard (the projectId requirement) ───────────────────────

  describe('multi-tenancy guard', () => {
    it('throws when projectId is missing (opts omitted)', async () => {
      await expect(service.indexAndStore('segment', [{ id: 's1', text: 'foo' }])).rejects.toThrow(
        /requires opts\.projectId/,
      );
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('throws when projectId is explicitly null', async () => {
      await expect(
        service.indexAndStore('segment', [{ id: 's1', text: 'foo' }], { projectId: null }),
      ).rejects.toThrow(/requires opts\.projectId/);
    });

    it('passes projectId as the 3rd positional UPDATE arg', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      await service.indexAndStore('field-value', [{ id: 'fv-1', text: 'Stack: PostgreSQL' }], {
        projectId: 'proj-42',
      });

      const call = mockPrisma.$executeRawUnsafe.mock.calls[0];
      expect(call[1]).toBe('[0.1]'); // vector literal
      expect(call[2]).toBe('fv-1'); // row id
      expect(call[3]).toBe('proj-42'); // tenant guard
    });
  });

  // ── Embed failure handling ────────────────────────────────────────────────

  describe('embed failure handling', () => {
    it('returns {indexed:0,failed:N} and logs warn when embed returns Result.fail', async () => {
      mockEmbeddings.embed.mockResolvedValue(failResult<number[][]>('embedding_unavailable'));

      const items = [
        { id: 's1', text: 'foo' },
        { id: 's2', text: 'bar' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 0, failed: 2 });
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('treats Result.ok with missing .value as failure', async () => {
      const weird = { isFailure: false, isSuccess: true, value: undefined, error: undefined } as unknown as Result<number[][]>;
      mockEmbeddings.embed.mockResolvedValue(weird);

      const r = await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }], { projectId: PID });

      expect(r).toEqual({ indexed: 0, failed: 1 });
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });
  });

  // ── Successful indexing per target ────────────────────────────────────────

  describe('successful indexing — UPDATE SQL per target', () => {
    const vectors = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];

    beforeEach(() => {
      mockEmbeddings.embed.mockResolvedValue(okResult(vectors));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
    });

    it("uses TranscriptSegments UPDATE scoped via parent transcript for target='segment'", async () => {
      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 2, failed: 0 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      const calls = mockPrisma.$executeRawUnsafe.mock.calls;
      // SQL scopes by the parent transcript's projectId.
      expect(calls[0][0]).toContain('UPDATE "TranscriptSegments" SET embedding = $1::vector');
      expect(calls[0][0]).toContain('"MeetingTranscripts"');
      expect(calls[0][0]).toContain('"projectId" = $3');
      expect(calls[0][1]).toBe('[0.1,0.2,0.3]');
      expect(calls[0][2]).toBe('s1');
      expect(calls[0][3]).toBe(PID);
      expect(calls[1][2]).toBe('s2');
      expect(calls[1][3]).toBe(PID);
    });

    it("uses ProjectFieldValues UPDATE with projectId guard for target='field-value'", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.7, 0.8, 0.9]]));

      const r = await service.indexAndStore('field-value', [{ id: 'fv-1', text: 'Stack: PostgreSQL' }], {
        projectId: PID,
      });

      expect(r).toEqual({ indexed: 1, failed: 0 });
      const call = mockPrisma.$executeRawUnsafe.mock.calls[0];
      expect(call[0]).toContain('UPDATE "ProjectFieldValues" SET embedding = $1::vector');
      expect(call[0]).toContain('"projectId" = $3');
      expect(call[1]).toBe('[0.7,0.8,0.9]');
      expect(call[2]).toBe('fv-1');
      expect(call[3]).toBe(PID);
    });

    it("uses MeetingTranscripts summaryEmbedding UPDATE with projectId guard for target='summary'", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[1, 2, 3]]));

      const r = await service.indexAndStore('summary', [{ id: 'm-1', text: 'meeting summary' }], {
        projectId: PID,
      });

      expect(r).toEqual({ indexed: 1, failed: 0 });
      const call = mockPrisma.$executeRawUnsafe.mock.calls[0];
      expect(call[0]).toContain('UPDATE "MeetingTranscripts" SET "summaryEmbedding" = $1::vector');
      expect(call[0]).toContain('"projectId" = $3');
      expect(call[1]).toBe('[1,2,3]');
      expect(call[2]).toBe('m-1');
      expect(call[3]).toBe(PID);
    });
  });

  // ── Per-row failure counting ──────────────────────────────────────────────

  describe('per-row failure counting', () => {
    it('counts a row failed when its vector slot is missing (undefined)', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1, 0.2]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 1, failed: 1 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('counts UPDATE rejections as failures and continues with the rest', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1], [0.2], [0.3]]));
      mockPrisma.$executeRawUnsafe
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce(1);

      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
        { id: 's3', text: 'three' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: PID });

      expect(r).toEqual({ indexed: 2, failed: 1 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });

    it('handles non-Error throws gracefully (string thrown)', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockImplementation(() => {
        throw 'string error';
      });

      const r = await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }], { projectId: PID });

      expect(r).toEqual({ indexed: 0, failed: 1 });
    });
  });

  // ── Always passes 'passage' input-type ────────────────────────────────────

  describe('passage prefix', () => {
    it("always uses 'passage' for the embedding input type", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      for (const target of ['segment', 'field-value', 'summary'] as IndexTarget[]) {
        mockEmbeddings.embed.mockClear();
        mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
        await service.indexAndStore(target, [{ id: 'x', text: 'y' }], { projectId: PID });
        expect(mockEmbeddings.embed).toHaveBeenCalledWith(['y'], 'passage', { projectId: PID });
      }
    });
  });
});
