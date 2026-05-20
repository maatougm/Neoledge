import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiUsageService } from './ai-usage.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  aiUsage: {
    create: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
};

// Per-test ConfigService stub. Most tests want AI_MAX_TOKENS_PER_PROJECT_PER_DAY
// to be undefined (cap=0 → unlimited); the budget-enforcement tests override.
function makeConfig(envOverrides: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string) => envOverrides[key]),
  };
}

async function buildService(envOverrides: Record<string, string | undefined> = {}): Promise<AiUsageService> {
  const mockConfig = makeConfig(envOverrides);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiUsageService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compile();
  return module.get<AiUsageService>(AiUsageService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiUsageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── log() ────────────────────────────────────────────────────────────────

  describe('log', () => {
    it('writes a row with computed cost + totalTokens on the happy path', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        projectId: 'proj-1',
        userId: 'user-1',
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'cahier',
        promptTokens: 2000,
        completionTokens: 1500,
        audioSeconds: 0,
        durationMs: 1234,
        success: true,
      });

      expect(mockPrisma.aiUsage.create).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: {
          projectId: string;
          userId: string;
          provider: string;
          model: string;
          feature: string;
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          audioSeconds: number;
          costEstimateUsd: number;
          durationMs: number;
          success: boolean;
          errorMessage: string | null;
        };
      };
      expect(arg.data.projectId).toBe('proj-1');
      expect(arg.data.userId).toBe('user-1');
      expect(arg.data.provider).toBe('openai');
      expect(arg.data.model).toBe('gpt-4o-mini');
      expect(arg.data.feature).toBe('cahier');
      expect(arg.data.promptTokens).toBe(2000);
      expect(arg.data.completionTokens).toBe(1500);
      expect(arg.data.totalTokens).toBe(3500);
      expect(arg.data.durationMs).toBe(1234);
      expect(arg.data.success).toBe(true);
      expect(arg.data.errorMessage).toBeNull();
      // gpt-4o-mini cost: 2000/1000 * 0.00015 + 1500/1000 * 0.0006
      //                = 0.0003 + 0.0009 = 0.0012
      expect(arg.data.costEstimateUsd).toBeCloseTo(0.0012, 6);
    });

    it('uses fallback cost rates for unknown models', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        provider: 'mystery-provider',
        model: 'mystery-model',
        feature: 'cahier',
        promptTokens: 1000,
        completionTokens: 1000,
      });

      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { costEstimateUsd: number };
      };
      // FALLBACK_COST_PROMPT = 0.0002, FALLBACK_COST_COMPLETION = 0.0008
      // 1000/1000 * 0.0002 + 1000/1000 * 0.0008 = 0.0002 + 0.0008 = 0.001
      expect(arg.data.costEstimateUsd).toBeCloseTo(0.001, 6);
    });

    it('charges audio cost for assemblyai but not for local-whisper', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        provider: 'assemblyai',
        model: 'universal-2',
        feature: 'transcribe',
        audioSeconds: 600, // 10 minutes
      });
      const assemblyArg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { costEstimateUsd: number };
      };
      // 600 * 0.000106 = 0.0636
      expect(assemblyArg.data.costEstimateUsd).toBeCloseTo(0.0636, 6);

      mockPrisma.aiUsage.create.mockClear();
      await service.log({
        provider: 'local-whisper',
        model: 'base',
        feature: 'transcribe',
        audioSeconds: 600,
      });
      const localArg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { costEstimateUsd: number };
      };
      // local-whisper rate is 0, no prompt/completion tokens either
      expect(localArg.data.costEstimateUsd).toBe(0);
    });

    it('defaults provider/model strings to "unknown" when empty', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        provider: '',
        model: '',
        feature: 'cahier',
      });

      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { provider: string; model: string };
      };
      expect(arg.data.provider).toBe('unknown');
      expect(arg.data.model).toBe('unknown');
    });

    it('truncates provider to 40 chars and model to 80 chars', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      const longProvider = 'x'.repeat(100);
      const longModel = 'y'.repeat(200);
      await service.log({
        provider: longProvider,
        model: longModel,
        feature: 'cahier',
      });

      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { provider: string; model: string };
      };
      expect(arg.data.provider).toHaveLength(40);
      expect(arg.data.model).toHaveLength(80);
    });

    it('truncates errorMessage to 500 chars and stores null when omitted', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      const longError = 'e'.repeat(1000);
      await service.log({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'cahier',
        success: false,
        errorMessage: longError,
      });
      const errArg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { errorMessage: string | null; success: boolean };
      };
      expect(errArg.data.errorMessage).toHaveLength(500);
      expect(errArg.data.success).toBe(false);

      mockPrisma.aiUsage.create.mockClear();
      await service.log({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'cahier',
      });
      const okArg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { errorMessage: string | null; success: boolean };
      };
      expect(okArg.data.errorMessage).toBeNull();
      // success defaults to true when omitted
      expect(okArg.data.success).toBe(true);
    });

    it('coerces negative or fractional token / audio / duration values to safe integers', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'cahier',
        promptTokens: -50,
        completionTokens: 12.9,
        audioSeconds: -1,
        durationMs: 9.7,
      });

      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: {
          promptTokens: number;
          completionTokens: number;
          audioSeconds: number;
          durationMs: number;
          totalTokens: number;
        };
      };
      expect(arg.data.promptTokens).toBe(0);     // negative clamped to 0
      expect(arg.data.completionTokens).toBe(12); // floor
      expect(arg.data.audioSeconds).toBe(0);     // negative clamped to 0
      expect(arg.data.durationMs).toBe(9);       // floor
      expect(arg.data.totalTokens).toBe(12);     // 0 + 12
    });

    it('defaults projectId / userId to null when omitted', async () => {
      mockPrisma.aiUsage.create.mockResolvedValue({});
      const service = await buildService();

      await service.log({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'cahier',
      });

      const arg = mockPrisma.aiUsage.create.mock.calls[0][0] as {
        data: { projectId: string | null; userId: string | null };
      };
      expect(arg.data.projectId).toBeNull();
      expect(arg.data.userId).toBeNull();
    });

    it('does NOT throw when Prisma.create rejects (fire-and-forget)', async () => {
      mockPrisma.aiUsage.create.mockRejectedValue(new Error('DB down'));
      const service = await buildService();

      // Must resolve, not reject.
      await expect(
        service.log({
          provider: 'openai',
          model: 'gpt-4o-mini',
          feature: 'cahier',
          promptTokens: 100,
        }),
      ).resolves.toBeUndefined();
    });

    it('does NOT throw when Prisma.create rejects with a non-Error value', async () => {
      mockPrisma.aiUsage.create.mockRejectedValue('plain string failure');
      const service = await buildService();

      await expect(
        service.log({
          provider: 'openai',
          model: 'gpt-4o-mini',
          feature: 'cahier',
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ── assertWithinDailyBudget() ────────────────────────────────────────────

  describe('assertWithinDailyBudget', () => {
    it('is a no-op when AI_MAX_TOKENS_PER_PROJECT_PER_DAY is unset (cap=0)', async () => {
      const service = await buildService(); // no env override → undefined
      await expect(service.assertWithinDailyBudget('proj-1', 1_000_000)).resolves.toBeUndefined();
      expect(mockPrisma.aiUsage.aggregate).not.toHaveBeenCalled();
    });

    it('is a no-op when AI_MAX_TOKENS_PER_PROJECT_PER_DAY is "0"', async () => {
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '0' });
      await expect(service.assertWithinDailyBudget('proj-1', 999)).resolves.toBeUndefined();
      expect(mockPrisma.aiUsage.aggregate).not.toHaveBeenCalled();
    });

    it('is a no-op when projectId is null / undefined / empty', async () => {
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '50000' });
      await expect(service.assertWithinDailyBudget(null, 1000)).resolves.toBeUndefined();
      await expect(service.assertWithinDailyBudget(undefined, 1000)).resolves.toBeUndefined();
      await expect(service.assertWithinDailyBudget('', 1000)).resolves.toBeUndefined();
      expect(mockPrisma.aiUsage.aggregate).not.toHaveBeenCalled();
    });

    it('allows the call when used + estimate < cap', async () => {
      mockPrisma.aiUsage.aggregate.mockResolvedValue({ _sum: { totalTokens: 10_000 } });
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '50000' });

      await expect(service.assertWithinDailyBudget('proj-1', 1000)).resolves.toBeUndefined();

      expect(mockPrisma.aiUsage.aggregate).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.aiUsage.aggregate.mock.calls[0][0] as {
        where: { projectId: string; createdAt: { gte: Date } };
        _sum: { totalTokens: boolean };
      };
      expect(arg.where.projectId).toBe('proj-1');
      expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
      // 24h window
      const ageMs = Date.now() - arg.where.createdAt.gte.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(ageMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
      expect(arg._sum.totalTokens).toBe(true);
    });

    it('throws ForbiddenException when used + estimate >= cap', async () => {
      mockPrisma.aiUsage.aggregate.mockResolvedValue({ _sum: { totalTokens: 49_000 } });
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '50000' });

      await expect(service.assertWithinDailyBudget('proj-1', 2000)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.assertWithinDailyBudget('proj-1', 2000)).rejects.toThrow(
        /Quota IA quotidien atteint/,
      );
    });

    it('throws when used alone equals cap (boundary)', async () => {
      mockPrisma.aiUsage.aggregate.mockResolvedValue({ _sum: { totalTokens: 50_000 } });
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '50000' });

      await expect(service.assertWithinDailyBudget('proj-1', 0)).rejects.toThrow(ForbiddenException);
    });

    it('treats _sum.totalTokens = null as 0 used', async () => {
      mockPrisma.aiUsage.aggregate.mockResolvedValue({ _sum: { totalTokens: null } });
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '50000' });

      await expect(service.assertWithinDailyBudget('proj-1', 1000)).resolves.toBeUndefined();
    });

    it('treats a non-numeric env var as cap=0 (unlimited)', async () => {
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: 'not-a-number' });
      await expect(service.assertWithinDailyBudget('proj-1', 1_000_000)).resolves.toBeUndefined();
      expect(mockPrisma.aiUsage.aggregate).not.toHaveBeenCalled();
    });

    it('treats a negative env var as cap=0 (unlimited)', async () => {
      const service = await buildService({ AI_MAX_TOKENS_PER_PROJECT_PER_DAY: '-100' });
      await expect(service.assertWithinDailyBudget('proj-1', 1_000_000)).resolves.toBeUndefined();
      expect(mockPrisma.aiUsage.aggregate).not.toHaveBeenCalled();
    });
  });

  // ── summaryByProject() ───────────────────────────────────────────────────

  describe('summaryByProject', () => {
    it('aggregates groupBy rows by project + feature', async () => {
      const rows = [
        {
          projectId: 'proj-1',
          feature: 'cahier',
          _count: { _all: 3 },
          _sum: { totalTokens: 15000, audioSeconds: 0, costEstimateUsd: 0.0234 },
        },
        {
          projectId: 'proj-1',
          feature: 'transcribe',
          _count: { _all: 5 },
          _sum: { totalTokens: 0, audioSeconds: 1800, costEstimateUsd: 0.1908 },
        },
        {
          projectId: 'proj-2',
          feature: 'backlog',
          _count: { _all: 1 },
          _sum: { totalTokens: 5000, audioSeconds: 0, costEstimateUsd: 0.0035 },
        },
      ];
      mockPrisma.aiUsage.groupBy.mockResolvedValue(rows);
      const service = await buildService();

      const result = await service.summaryByProject(30);

      expect(mockPrisma.aiUsage.groupBy).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.aiUsage.groupBy.mock.calls[0][0] as {
        by: string[];
        where: { createdAt: { gte: Date } };
        _sum: Record<string, boolean>;
        _count: { _all: boolean };
      };
      expect(arg.by).toEqual(['projectId', 'feature']);
      expect(arg.where.createdAt.gte).toBeInstanceOf(Date);
      expect(arg._sum).toEqual({
        totalTokens: true,
        audioSeconds: true,
        costEstimateUsd: true,
      });
      expect(arg._count._all).toBe(true);

      expect(result).toEqual([
        {
          projectId: 'proj-1',
          feature: 'cahier',
          calls: 3,
          totalTokens: 15000,
          audioSeconds: 0,
          costEstimateUsd: 0.0234,
        },
        {
          projectId: 'proj-1',
          feature: 'transcribe',
          calls: 5,
          totalTokens: 0,
          audioSeconds: 1800,
          costEstimateUsd: 0.1908,
        },
        {
          projectId: 'proj-2',
          feature: 'backlog',
          calls: 1,
          totalTokens: 5000,
          audioSeconds: 0,
          costEstimateUsd: 0.0035,
        },
      ]);
    });

    it('defaults daysBack to 30 when not provided', async () => {
      mockPrisma.aiUsage.groupBy.mockResolvedValue([]);
      const service = await buildService();

      await service.summaryByProject();

      const arg = mockPrisma.aiUsage.groupBy.mock.calls[0][0] as {
        where: { createdAt: { gte: Date } };
      };
      const ageMs = Date.now() - arg.where.createdAt.gte.getTime();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(ageMs).toBeGreaterThanOrEqual(thirtyDays - 1000);
      expect(ageMs).toBeLessThanOrEqual(thirtyDays + 1000);
    });

    it('honors custom daysBack', async () => {
      mockPrisma.aiUsage.groupBy.mockResolvedValue([]);
      const service = await buildService();

      await service.summaryByProject(7);

      const arg = mockPrisma.aiUsage.groupBy.mock.calls[0][0] as {
        where: { createdAt: { gte: Date } };
      };
      const ageMs = Date.now() - arg.where.createdAt.gte.getTime();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(ageMs).toBeGreaterThanOrEqual(sevenDays - 1000);
      expect(ageMs).toBeLessThanOrEqual(sevenDays + 1000);
    });

    it('coerces null _sum values to 0 and rounds cost to 4 decimals', async () => {
      mockPrisma.aiUsage.groupBy.mockResolvedValue([
        {
          projectId: 'proj-x',
          feature: 'cahier',
          _count: { _all: 0 },
          _sum: { totalTokens: null, audioSeconds: null, costEstimateUsd: null },
        },
        {
          projectId: 'proj-y',
          feature: 'cahier',
          _count: { _all: 1 },
          _sum: { totalTokens: 1, audioSeconds: 0, costEstimateUsd: 0.123456789 },
        },
      ]);
      const service = await buildService();

      const result = await service.summaryByProject(30);

      expect(result[0]).toEqual({
        projectId: 'proj-x',
        feature: 'cahier',
        calls: 0,
        totalTokens: 0,
        audioSeconds: 0,
        costEstimateUsd: 0,
      });
      // 0.123456789 → 0.1235 (4-decimal toFixed)
      expect(result[1].costEstimateUsd).toBe(0.1235);
    });

    it('returns an empty array when there are no rows', async () => {
      mockPrisma.aiUsage.groupBy.mockResolvedValue([]);
      const service = await buildService();

      const result = await service.summaryByProject(30);
      expect(result).toEqual([]);
    });
  });
});
