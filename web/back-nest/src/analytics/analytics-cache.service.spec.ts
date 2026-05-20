import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsCacheService } from './analytics-cache.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  analyticsCache: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsCacheService', () => {
  let service: AnalyticsCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsCacheService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsCacheService>(AnalyticsCacheService);
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns null when no entry exists (cache miss)', async () => {
      mockPrisma.analyticsCache.findUnique.mockResolvedValue(null);

      const result = await service.get('phase_velocity', 15);

      expect(result).toBeNull();
      expect(mockPrisma.analyticsCache.findUnique).toHaveBeenCalledWith({
        where: { cacheKey: 'phase_velocity' },
      });
    });

    it('returns the parsed payload when entry is fresh (cache hit)', async () => {
      const payload = [{ phase: 'Draft', avgDays: 10 }];
      mockPrisma.analyticsCache.findUnique.mockResolvedValue({
        cacheKey: 'phase_velocity',
        data: JSON.stringify(payload),
        computedAt: new Date(Date.now() - 60_000), // 1 minute ago
      });

      const result = await service.get<typeof payload>('phase_velocity', 15);

      expect(result).toEqual(payload);
    });

    it('returns null when entry is older than TTL (expiry)', async () => {
      const payload = [{ phase: 'Draft', avgDays: 10 }];
      mockPrisma.analyticsCache.findUnique.mockResolvedValue({
        cacheKey: 'phase_velocity',
        data: JSON.stringify(payload),
        // 30 minutes ago — exceeds 15 min TTL
        computedAt: new Date(Date.now() - 30 * 60_000),
      });

      const result = await service.get('phase_velocity', 15);

      expect(result).toBeNull();
    });

    it('returns null when entry data is malformed JSON', async () => {
      mockPrisma.analyticsCache.findUnique.mockResolvedValue({
        cacheKey: 'phase_velocity',
        data: '{not valid json',
        computedAt: new Date(),
      });

      const result = await service.get('phase_velocity', 15);

      expect(result).toBeNull();
    });

    it('honors a per-call TTL (different keys can have different TTLs)', async () => {
      // 10 minutes old; OK for TTL=15, expired for TTL=5
      const computedAt = new Date(Date.now() - 10 * 60_000);
      mockPrisma.analyticsCache.findUnique.mockResolvedValue({
        cacheKey: 'k',
        data: JSON.stringify({ ok: 1 }),
        computedAt,
      });

      expect(await service.get('k', 15)).toEqual({ ok: 1 });

      mockPrisma.analyticsCache.findUnique.mockResolvedValue({
        cacheKey: 'k',
        data: JSON.stringify({ ok: 1 }),
        computedAt,
      });

      expect(await service.get('k', 5)).toBeNull();
    });
  });

  // ── set ────────────────────────────────────────────────────────────────────

  describe('set', () => {
    it('upserts the cache entry with serialized data', async () => {
      mockPrisma.analyticsCache.upsert.mockResolvedValue({ cacheKey: 'phase_velocity' });

      const payload = [{ phase: 'Draft', avgDays: 10 }];
      await service.set('phase_velocity', payload);

      expect(mockPrisma.analyticsCache.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.analyticsCache.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ cacheKey: 'phase_velocity' });
      expect(call.create.cacheKey).toBe('phase_velocity');
      expect(call.create.data).toBe(JSON.stringify(payload));
      expect(call.create.computedAt).toBeInstanceOf(Date);
      expect(call.update.data).toBe(JSON.stringify(payload));
      expect(call.update.computedAt).toBeInstanceOf(Date);
    });

    it('generates a fresh id on each create branch (idempotent upsert)', async () => {
      mockPrisma.analyticsCache.upsert.mockResolvedValue({});

      await service.set('a', { v: 1 });
      await service.set('b', { v: 2 });

      const id1 = mockPrisma.analyticsCache.upsert.mock.calls[0][0].create.id;
      const id2 = mockPrisma.analyticsCache.upsert.mock.calls[1][0].create.id;

      expect(typeof id1).toBe('string');
      expect(typeof id2).toBe('string');
      expect(id1).not.toBe(id2);
    });
  });

  // ── invalidate ─────────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('deletes a single key when one is provided', async () => {
      mockPrisma.analyticsCache.deleteMany.mockResolvedValue({ count: 1 });

      await service.invalidate('phase_velocity');

      expect(mockPrisma.analyticsCache.deleteMany).toHaveBeenCalledWith({
        where: { cacheKey: 'phase_velocity' },
      });
    });

    it('wipes ALL entries when no key is provided', async () => {
      mockPrisma.analyticsCache.deleteMany.mockResolvedValue({ count: 7 });

      await service.invalidate();

      expect(mockPrisma.analyticsCache.deleteMany).toHaveBeenCalledWith({});
    });

    it('swallows Prisma errors (best-effort — must not break mutations)', async () => {
      mockPrisma.analyticsCache.deleteMany.mockRejectedValue(new Error('DB down'));

      await expect(service.invalidate('phase_velocity')).resolves.toBeUndefined();
      await expect(service.invalidate()).resolves.toBeUndefined();
    });
  });
});
