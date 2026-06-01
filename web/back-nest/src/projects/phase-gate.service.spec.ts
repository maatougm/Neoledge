import { Test, TestingModule } from '@nestjs/testing';
import { PhaseGateService } from './phase-gate.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  projectValidation: {
    count: jest.fn(),
  },
  project: {
    findUnique: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhaseGateService', () => {
  let service: PhaseGateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: no phaseEnteredAt filter — preserves legacy semantics in tests.
    mockPrisma.project.findUnique.mockResolvedValue({ currentPhaseEnteredAt: null });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhaseGateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PhaseGateService>(PhaseGateService);
  });

  // ── getValidNextStatuses ───────────────────────────────────────────────────

  describe('getValidNextStatuses', () => {
    it('returns all forward statuses and Archived from Draft', () => {
      const result = service.getValidNextStatuses('Draft');
      expect(result).toContain('Kickoff');
      expect(result).toContain('Archived');
      expect(result).not.toContain('Draft');
    });

    it('returns forward statuses plus Archived from Kickoff', () => {
      const result = service.getValidNextStatuses('Kickoff');
      expect(result).toContain('Realisation');
      expect(result).toContain('Cloture');
      expect(result).toContain('Archived');
      expect(result).not.toContain('Draft');
      expect(result).not.toContain('Kickoff');
    });

    it('returns only Archived from Cloture', () => {
      const result = service.getValidNextStatuses('Cloture');
      expect(result).toEqual(['Archived']);
    });

    it('returns empty array from Archived', () => {
      const result = service.getValidNextStatuses('Archived');
      expect(result).toEqual([]);
    });

    it('returns empty statuses array plus Archived for unknown status', () => {
      const result = service.getValidNextStatuses('UnknownStatus');
      expect(result).toEqual(['Archived']);
    });
  });

  // ── canTransition — always allowed to Archived ────────────────────────────

  describe('canTransition → Archived', () => {
    it('always allows transition to Archived regardless of current status', async () => {
      const statuses = ['Draft', 'Kickoff', 'Realisation', 'Cloture'];

      for (const from of statuses) {
        const result = await service.canTransition('proj-1', from, 'Archived');
        expect(result.isSuccess).toBe(true);
      }

      // Prisma should never be called for Archived transitions
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });
  });

  // ── canTransition — backward transitions ──────────────────────────────────

  describe('canTransition — backward transitions', () => {
    it('blocks Kickoff → Draft', async () => {
      const result = await service.canTransition('proj-1', 'Kickoff', 'Draft');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('blocks Realisation → Kickoff', async () => {
      const result = await service.canTransition('proj-1', 'Realisation', 'Kickoff');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
    });

    it('blocks Cloture → Draft', async () => {
      const result = await service.canTransition('proj-1', 'Cloture', 'Draft');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
    });
  });

  // ── canTransition — free transitions (no gate) ───────────────────────────

  describe('canTransition — free transitions', () => {
    it('allows Draft → Kickoff without any approval check', async () => {
      const result = await service.canTransition('proj-1', 'Draft', 'Kickoff');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('allows Draft → Realisation without approval check', async () => {
      const result = await service.canTransition('proj-1', 'Draft', 'Realisation');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('allows Kickoff → Cloture without approval check', async () => {
      const result = await service.canTransition('proj-1', 'Kickoff', 'Cloture');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });
  });

  // ── canTransition — Kickoff → Realisation gate ───────────────────────────

  describe('canTransition — Kickoff → Realisation gate', () => {
    it('blocks when no SpecificationTeam approval exists', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(0);

      const result = await service.canTransition('proj-1', 'Kickoff', 'Realisation');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('SpecificationTeam');
      expect(mockPrisma.projectValidation.count).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          phase: 'Kickoff',
          isApproved: true,
          validatedByRole: 'SpecificationTeam',
        },
      });
    });

    it('allows when at least 1 SpecificationTeam approval exists', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(1);

      const result = await service.canTransition('proj-1', 'Kickoff', 'Realisation');

      expect(result.isSuccess).toBe(true);
    });

    it('allows when multiple SpecificationTeam approvals exist', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(3);

      const result = await service.canTransition('proj-1', 'Kickoff', 'Realisation');

      expect(result.isSuccess).toBe(true);
    });
  });

  // ── canTransition — Realisation → Cloture gate ───────────────────────────

  describe('canTransition — Realisation → Cloture gate', () => {
    it('bloque si aucune approbation ProjectManager n\'existe', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(0);

      const result = await service.canTransition('proj-1', 'Realisation', 'Cloture');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('ProjectManager');
      expect(mockPrisma.projectValidation.count).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          phase: 'Realisation',
          isApproved: true,
          validatedByRole: 'ProjectManager',
        },
      });
    });

    it('autorise si au moins 1 approbation ProjectManager existe', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(1);

      const result = await service.canTransition('proj-1', 'Realisation', 'Cloture');

      expect(result.isSuccess).toBe(true);
    });
  });
});
