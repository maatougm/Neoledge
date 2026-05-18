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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      const r = await service.indexAndStore('segment', [], { projectId: 'p1' });
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
      const r = await service.indexAndStore('segment', items);

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

      const r = await service.indexAndStore('segment', items);

      expect(r).toEqual({ indexed: 1, failed: 0 });
      // embed called with only the one non-empty text.
      expect(mockEmbeddings.embed).toHaveBeenCalledWith(['real text'], 'passage', { projectId: undefined });
    });

    it('returns {indexed:0,failed:0} when every item is filtered out', async () => {
      const items = [
        { id: 's1', text: '' },
        { id: 's2', text: '   ' },
      ];

      const r = await service.indexAndStore('segment', items);

      expect(r).toEqual({ indexed: 0, failed: 0 });
      expect(mockEmbeddings.embed).not.toHaveBeenCalled();
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

      const r = await service.indexAndStore('segment', items, { projectId: 'p1' });

      expect(r).toEqual({ indexed: 0, failed: 2 });
      expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('treats Result.ok with missing .value as failure', async () => {
      // Pathological: ok-flagged result without value. The code checks
      // `result.isFailure || !result.value`.
      const weird = { isFailure: false, isSuccess: true, value: undefined, error: undefined } as unknown as Result<number[][]>;
      mockEmbeddings.embed.mockResolvedValue(weird);

      const items = [{ id: 's1', text: 'foo' }];

      const r = await service.indexAndStore('segment', items);

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

    it("uses TranscriptSegments UPDATE for target='segment'", async () => {
      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
      ];

      const r = await service.indexAndStore('segment', items, { projectId: 'p1' });

      expect(r).toEqual({ indexed: 2, failed: 0 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      // Both calls use the segment SQL.
      const calls = mockPrisma.$executeRawUnsafe.mock.calls;
      expect(calls[0][0]).toBe('UPDATE "TranscriptSegments" SET embedding = $1::vector WHERE id = $2');
      expect(calls[1][0]).toBe('UPDATE "TranscriptSegments" SET embedding = $1::vector WHERE id = $2');
      // Vectors serialised as [a,b,c] literal.
      expect(calls[0][1]).toBe('[0.1,0.2,0.3]');
      expect(calls[0][2]).toBe('s1');
      expect(calls[1][1]).toBe('[0.4,0.5,0.6]');
      expect(calls[1][2]).toBe('s2');
    });

    it("uses ProjectFieldValues UPDATE for target='field-value'", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.7, 0.8, 0.9]]));

      const r = await service.indexAndStore('field-value', [{ id: 'fv-1', text: 'Stack: PostgreSQL' }]);

      expect(r).toEqual({ indexed: 1, failed: 0 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "ProjectFieldValues" SET embedding = $1::vector WHERE id = $2',
        '[0.7,0.8,0.9]',
        'fv-1',
      );
    });

    it("uses MeetingTranscripts summaryEmbedding UPDATE for target='summary'", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[1, 2, 3]]));

      const r = await service.indexAndStore('summary', [{ id: 'm-1', text: 'meeting summary' }]);

      expect(r).toEqual({ indexed: 1, failed: 0 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'UPDATE "MeetingTranscripts" SET "summaryEmbedding" = $1::vector WHERE id = $2',
        '[1,2,3]',
        'm-1',
      );
    });
  });

  // ── Per-row failure counting ──────────────────────────────────────────────

  describe('per-row failure counting', () => {
    it('counts a row failed when its vector slot is missing (undefined)', async () => {
      // Two inputs, but embed only returned one vector.
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1, 0.2]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
      ];

      const r = await service.indexAndStore('segment', items);

      expect(r).toEqual({ indexed: 1, failed: 1 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    });

    it('counts UPDATE rejections as failures and continues with the rest', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1], [0.2], [0.3]]));
      mockPrisma.$executeRawUnsafe
        .mockResolvedValueOnce(1) // s1 ok
        .mockRejectedValueOnce(new Error('deadlock')) // s2 fails
        .mockResolvedValueOnce(1); // s3 ok

      const items = [
        { id: 's1', text: 'one' },
        { id: 's2', text: 'two' },
        { id: 's3', text: 'three' },
      ];

      const r = await service.indexAndStore('segment', items);

      expect(r).toEqual({ indexed: 2, failed: 1 });
      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
    });

    it('handles non-Error throws gracefully (string thrown)', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockImplementation(() => {
        throw 'string error';
      });

      const r = await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }]);

      expect(r).toEqual({ indexed: 0, failed: 1 });
    });
  });

  // ── projectId plumbing ────────────────────────────────────────────────────

  describe('projectId plumbing', () => {
    it('forwards projectId to embeddings.embed', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }], { projectId: 'proj-42' });

      expect(mockEmbeddings.embed).toHaveBeenCalledWith(['foo'], 'passage', { projectId: 'proj-42' });
    });

    it('forwards projectId=null when explicitly set', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }], { projectId: null });

      expect(mockEmbeddings.embed).toHaveBeenCalledWith(['foo'], 'passage', { projectId: null });
    });

    it('defaults opts to {} when not passed', async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      const r = await service.indexAndStore('segment', [{ id: 's1', text: 'foo' }]);
      expect(r).toEqual({ indexed: 1, failed: 0 });
      expect(mockEmbeddings.embed).toHaveBeenCalledWith(['foo'], 'passage', { projectId: undefined });
    });
  });

  // ── Always passes 'passage' input-type ────────────────────────────────────

  describe('passage prefix', () => {
    it("always uses 'passage' for the embedding input type", async () => {
      mockEmbeddings.embed.mockResolvedValue(okResult([[0.1]]));
      mockPrisma.$executeRawUnsafe.mockResolvedValue(1);

      for (const target of ['segment', 'field-value', 'summary'] as IndexTarget[]) {
        mockEmbeddings.embed.mockClear();
        await service.indexAndStore(target, [{ id: 'x', text: 'y' }]);
        expect(mockEmbeddings.embed).toHaveBeenCalledWith(['y'], 'passage', expect.any(Object));
      }
    });
  });
});
