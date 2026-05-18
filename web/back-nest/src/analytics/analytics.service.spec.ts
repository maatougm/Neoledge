import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { AnalyticsCacheService } from './analytics-cache.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date('2026-06-01T12:00:00Z');
const MS_PER_DAY = 86_400_000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * MS_PER_DAY);
}

function daysAgo(days: number): Date {
  return daysFromNow(-days);
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  projectActivity: {
    findMany: jest.fn(),
  },
  project: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  appUser: {
    findMany: jest.fn(),
  },
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: cache always misses unless a test overrides
    mockCache.get.mockResolvedValue(null);
    mockCache.set.mockResolvedValue(undefined);
    // Default groupBy returns empty so bottleneck heatmap doesn't blow up.
    mockPrisma.project.groupBy.mockResolvedValue([]);

    jest.useFakeTimers().setSystemTime(NOW.getTime());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AnalyticsCacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── getPhaseVelocity ───────────────────────────────────────────────────────

  describe('getPhaseVelocity', () => {
    it('returns cached value without hitting Prisma on cache hit', async () => {
      const cached = [{ phase: 'Draft', avgDays: 3, minDays: 1, maxDays: 5, projectCount: 2 }];
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getPhaseVelocity();

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual(cached);
      expect(mockPrisma.projectActivity.findMany).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('returns empty array when there are no activities', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([]);

      const result = await service.getPhaseVelocity();

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual([]);
      expect(mockCache.set).toHaveBeenCalledWith('phase_velocity', []);
    });

    it('computes phase durations from status_change activities (single project)', async () => {
      // p1: Draft (entered at day 0) → Kickoff (entered at day 2)
      //     Kickoff             → CadrageTechnique (entered at day 7)  → 5 days in Kickoff
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        {
          projectId: 'p1',
          detail: 'Statut changé: Draft → Kickoff',
          createdAt: daysAgo(7),
        },
        {
          projectId: 'p1',
          detail: 'Statut changé: Kickoff → CadrageTechnique',
          createdAt: daysAgo(2),
        },
      ]);

      const result = await service.getPhaseVelocity();

      expect(result.isSuccess).toBe(true);
      const rows = result.value!;
      // Only Kickoff has a tracked entry → exit pair (Draft → Kickoff has no
      // prior entry record), so we get exactly one row.
      expect(rows).toHaveLength(1);
      expect(rows[0].phase).toBe('Kickoff');
      expect(rows[0].avgDays).toBe(5);
      expect(rows[0].minDays).toBe(5);
      expect(rows[0].maxDays).toBe(5);
      expect(rows[0].projectCount).toBe(1);
    });

    it('aggregates min/max/avg across multiple projects in the same phase', async () => {
      // p1: Kickoff (day -10) → CadrageTechnique (day -4) → 6 days in Kickoff
      // p2: Kickoff (day -8)  → CadrageTechnique (day -6) → 2 days in Kickoff
      // p3: Kickoff (day -20) → CadrageTechnique (day -16)→ 4 days in Kickoff
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        // p1
        { projectId: 'p1', detail: 'Statut changé: Draft → Kickoff',          createdAt: daysAgo(10) },
        { projectId: 'p1', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(4) },
        // p2
        { projectId: 'p2', detail: 'Statut changé: Draft → Kickoff',          createdAt: daysAgo(8) },
        { projectId: 'p2', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(6) },
        // p3
        { projectId: 'p3', detail: 'Statut changé: Draft → Kickoff',          createdAt: daysAgo(20) },
        { projectId: 'p3', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(16) },
      ]);

      const result = await service.getPhaseVelocity();

      const kickoff = result.value!.find((r) => r.phase === 'Kickoff');
      expect(kickoff).toBeDefined();
      expect(kickoff!.projectCount).toBe(3);
      expect(kickoff!.minDays).toBe(2);
      expect(kickoff!.maxDays).toBe(6);
      expect(kickoff!.avgDays).toBe(4); // (6+2+4)/3 = 4.0
    });

    it('ignores activities with missing or unparseable detail', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        { projectId: 'p1', detail: null, createdAt: daysAgo(5) },
        { projectId: 'p1', detail: 'Free-form note no arrow', createdAt: daysAgo(3) },
        { projectId: 'p1', detail: 'Statut changé: Draft → Kickoff', createdAt: daysAgo(10) },
        { projectId: 'p1', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(7) },
      ]);

      const result = await service.getPhaseVelocity();

      const rows = result.value!;
      expect(rows).toHaveLength(1);
      expect(rows[0].phase).toBe('Kickoff');
      expect(rows[0].avgDays).toBe(3);
    });

    it('writes the computed result to cache on miss', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([]);

      await service.getPhaseVelocity();

      expect(mockCache.set).toHaveBeenCalledWith('phase_velocity', []);
    });
  });

  // ── getBottleneckHeatmap ───────────────────────────────────────────────────

  describe('getBottleneckHeatmap', () => {
    it('returns cached value without recomputing', async () => {
      const cached = [{ phase: 'Kickoff', currentCount: 4, avgDays: 8, severity: 'high' as const }];
      mockCache.get.mockResolvedValueOnce(cached); // bottleneck_heatmap

      const result = await service.getBottleneckHeatmap();

      expect(result.value).toEqual(cached);
      expect(mockPrisma.projectActivity.findMany).not.toHaveBeenCalled();
    });

    it('returns empty when there is no velocity data', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([]);
      mockPrisma.project.groupBy.mockResolvedValue([]);

      const result = await service.getBottleneckHeatmap();

      expect(result.value).toEqual([]);
      expect(mockCache.set).toHaveBeenCalledWith('bottleneck_heatmap', []);
    });

    it('classifies severity high (>1.5x mean), medium (>mean), low otherwise; sorts by avgDays desc', async () => {
      // Build 3 phase rows with avg durations that yield mean = 10.
      // Slow=21 (>15=1.5*10 → high), Mid=12 (>10 → medium), Fast=2 (<10 → low)
      //
      // The service derives velocity via status_change activities. We build
      // one transition per project per phase so each phase has 1 sample
      // exactly equal to the target duration.
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        // Slow: 21 days in Kickoff (p1)
        { projectId: 'p1', detail: 'Statut changé: Draft → Kickoff',          createdAt: daysAgo(25) },
        { projectId: 'p1', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(4) },
        // Mid: 12 days in CadrageTechnique (p2)
        { projectId: 'p2', detail: 'Statut changé: Draft → CadrageTechnique',     createdAt: daysAgo(15) },
        { projectId: 'p2', detail: 'Statut changé: CadrageTechnique → Environnement', createdAt: daysAgo(3) },
        // Fast: 2 days in Environnement (p3)
        { projectId: 'p3', detail: 'Statut changé: Draft → Environnement',  createdAt: daysAgo(5) },
        { projectId: 'p3', detail: 'Statut changé: Environnement → Parametrage', createdAt: daysAgo(3) },
      ]);

      mockPrisma.project.groupBy.mockResolvedValue([
        { status: 'Kickoff', _count: 7 },
        { status: 'CadrageTechnique', _count: 3 },
        { status: 'Environnement', _count: 0 },
      ]);

      const result = await service.getBottleneckHeatmap();

      const rows = result.value!;
      expect(rows).toHaveLength(3);
      // Sorted desc by avgDays
      expect(rows[0].phase).toBe('Kickoff');
      expect(rows[0].severity).toBe('high');
      expect(rows[0].currentCount).toBe(7);
      expect(rows[1].phase).toBe('CadrageTechnique');
      expect(rows[1].severity).toBe('medium');
      expect(rows[1].currentCount).toBe(3);
      expect(rows[2].phase).toBe('Environnement');
      expect(rows[2].severity).toBe('low');
      expect(rows[2].currentCount).toBe(0);
    });

    it('uses currentCount=0 when the phase is not present in groupBy result', async () => {
      mockPrisma.projectActivity.findMany.mockResolvedValue([
        { projectId: 'p1', detail: 'Statut changé: Draft → Kickoff', createdAt: daysAgo(10) },
        { projectId: 'p1', detail: 'Statut changé: Kickoff → CadrageTechnique', createdAt: daysAgo(5) },
      ]);
      mockPrisma.project.groupBy.mockResolvedValue([]);

      const result = await service.getBottleneckHeatmap();

      expect(result.value![0].currentCount).toBe(0);
    });
  });

  // ── getDeadlineRisk ────────────────────────────────────────────────────────

  describe('getDeadlineRisk', () => {
    it('returns cached value without hitting Prisma', async () => {
      const cached = [{ projectId: 'p1', projectName: 'X', status: 'Kickoff', pmName: 'Alice PM', daysRemaining: 10, riskScore: 67 }];
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getDeadlineRisk();

      expect(result.value).toEqual(cached);
      expect(mockPrisma.project.findMany).not.toHaveBeenCalled();
    });

    it('returns 100 risk for overdue projects', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'Overdue',
          status: 'Kickoff',
          endDate: daysAgo(5),
          projectManager: { firstName: 'Alice', lastName: 'PM' },
        },
      ]);

      const result = await service.getDeadlineRisk();

      expect(result.value).toHaveLength(1);
      expect(result.value![0].riskScore).toBe(100);
      expect(result.value![0].daysRemaining).toBeLessThan(0);
      expect(result.value![0].pmName).toBe('Alice PM');
    });

    it('returns 0 risk for projects > 30 days out', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'Future', status: 'Draft',
          endDate: daysFromNow(60),
          projectManager: { firstName: 'A', lastName: 'B' },
        },
      ]);

      const result = await service.getDeadlineRisk();

      expect(result.value![0].riskScore).toBe(0);
    });

    it('returns null pmName when projectManager is null', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'No PM', status: 'Draft',
          endDate: daysFromNow(10),
          projectManager: null,
        },
      ]);

      const result = await service.getDeadlineRisk();

      expect(result.value![0].pmName).toBeNull();
    });

    it('sorts results by riskScore desc (worst first)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 'p1', name: 'Low',  status: 'Draft', endDate: daysFromNow(60), projectManager: null },
        { id: 'p2', name: 'High', status: 'Draft', endDate: daysAgo(2),       projectManager: null },
        { id: 'p3', name: 'Mid',  status: 'Draft', endDate: daysFromNow(10),  projectManager: null },
      ]);

      const result = await service.getDeadlineRisk();

      const ids = result.value!.map((r) => r.projectId);
      expect(ids).toEqual(['p2', 'p3', 'p1']);
    });

    it('passes status:notIn TERMINAL_STATUSES to Prisma', async () => {
      mockPrisma.project.findMany.mockResolvedValue([]);

      await service.getDeadlineRisk();

      const call = mockPrisma.project.findMany.mock.calls[0][0];
      expect(call.where.isDeleted).toBe(false);
      expect(call.where.status.notIn).toEqual(['Completed', 'Archived']);
      expect(call.take).toBe(500);
    });

    it('computes a mid-range risk score between 0 and 100 (15 days out → ~50)', async () => {
      mockPrisma.project.findMany.mockResolvedValue([
        { id: 'p1', name: 'Mid', status: 'Draft', endDate: daysFromNow(15), projectManager: null },
      ]);

      const result = await service.getDeadlineRisk();

      const score = result.value![0].riskScore;
      expect(score).toBeGreaterThanOrEqual(45);
      expect(score).toBeLessThanOrEqual(55);
    });
  });

  // ── getTeamWorkload ────────────────────────────────────────────────────────

  describe('getTeamWorkload', () => {
    it('returns cached value without hitting Prisma', async () => {
      const cached = [{ pmId: 'pm1', pmName: 'A B', active: 3, overdue: 1, completed: 2, upcoming: 0 }];
      mockCache.get.mockResolvedValue(cached);

      const result = await service.getTeamWorkload();

      expect(result.value).toEqual(cached);
      expect(mockPrisma.appUser.findMany).not.toHaveBeenCalled();
    });

    it('returns empty array when no managers exist', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);

      const result = await service.getTeamWorkload();

      expect(result.value).toEqual([]);
    });

    it('counts active, overdue, completed (within 90 days), upcoming (next 14 days) per PM', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([
        {
          id: 'pm1', firstName: 'Alice', lastName: 'PM',
          managedProjects: [
            // active + upcoming (endDate within 14 days, active status)
            { status: 'Kickoff',          endDate: daysFromNow(7),  updatedAt: daysAgo(2) },
            // active + overdue (endDate in past, active status)
            { status: 'CadrageTechnique', endDate: daysAgo(3),       updatedAt: daysAgo(5) },
            // active, not upcoming (>14 days out)
            { status: 'Recette',          endDate: daysFromNow(60), updatedAt: daysAgo(1) },
            // completed within 90 days (updatedAt 30 days ago)
            { status: 'Completed',        endDate: daysAgo(60),      updatedAt: daysAgo(30) },
            // completed but TOO OLD (>90 days ago) — must not count
            { status: 'Completed',        endDate: daysAgo(200),     updatedAt: daysAgo(120) },
            // archived — not active, not completed → ignored
            { status: 'Archived',         endDate: daysAgo(300),     updatedAt: daysAgo(200) },
          ],
        },
      ]);

      const result = await service.getTeamWorkload();

      expect(result.value).toHaveLength(1);
      const row = result.value![0];
      expect(row.pmId).toBe('pm1');
      expect(row.pmName).toBe('Alice PM');
      expect(row.active).toBe(3);     // Kickoff, CadrageTechnique, Recette
      expect(row.overdue).toBe(1);    // CadrageTechnique (active + past endDate)
      expect(row.completed).toBe(1);  // only the recent Completed
      expect(row.upcoming).toBe(1);   // Kickoff (active + within 14 days, not past)
    });

    it('sorts results by active desc, then overdue desc', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([
        {
          id: 'pm-low', firstName: 'Low', lastName: 'A',
          managedProjects: [{ status: 'Kickoff', endDate: daysFromNow(30), updatedAt: daysAgo(1) }],
        },
        {
          id: 'pm-high', firstName: 'High', lastName: 'B',
          managedProjects: [
            { status: 'Kickoff', endDate: daysFromNow(30), updatedAt: daysAgo(1) },
            { status: 'Recette', endDate: daysFromNow(30), updatedAt: daysAgo(1) },
          ],
        },
        {
          id: 'pm-tied', firstName: 'Tied', lastName: 'C',
          managedProjects: [
            // Same active count as pm-low (1) but with an overdue → ranks above pm-low
            { status: 'Kickoff', endDate: daysAgo(1), updatedAt: daysAgo(1) },
          ],
        },
      ]);

      const result = await service.getTeamWorkload();

      expect(result.value!.map((r) => r.pmId)).toEqual(['pm-high', 'pm-tied', 'pm-low']);
    });

    it('only queries ProjectManager + active users', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);

      await service.getTeamWorkload();

      const call = mockPrisma.appUser.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ role: 'ProjectManager', isActive: true });
      expect(call.take).toBe(500);
    });
  });
});
