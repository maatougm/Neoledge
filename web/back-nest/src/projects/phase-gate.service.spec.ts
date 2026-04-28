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
      expect(result).toContain('InProgress');
      expect(result).toContain('Archived');
      expect(result).not.toContain('Draft');
    });

    it('returns forward statuses plus Archived from InProgress', () => {
      const result = service.getValidNextStatuses('InProgress');
      expect(result).toContain('SpecificationValidation');
      expect(result).toContain('Realization');
      expect(result).toContain('DeploymentValidation');
      expect(result).toContain('Completed');
      expect(result).toContain('Archived');
      expect(result).not.toContain('Draft');
      expect(result).not.toContain('InProgress');
    });

    it('returns only Archived from Completed', () => {
      const result = service.getValidNextStatuses('Completed');
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
      const statuses = ['Draft', 'InProgress', 'SpecificationValidation', 'Realization', 'DeploymentValidation', 'Completed'];

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
    it('blocks InProgress → Draft', async () => {
      const result = await service.canTransition('proj-1', 'InProgress', 'Draft');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('blocks Realization → InProgress', async () => {
      const result = await service.canTransition('proj-1', 'Realization', 'InProgress');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
    });

    it('blocks Completed → Draft', async () => {
      const result = await service.canTransition('proj-1', 'Completed', 'Draft');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('impossible de revenir');
    });
  });

  // ── canTransition — free transitions (no gate) ───────────────────────────

  describe('canTransition — free transitions', () => {
    it('allows Draft → InProgress without any approval check', async () => {
      const result = await service.canTransition('proj-1', 'Draft', 'InProgress');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('allows InProgress → SpecificationValidation without approval check', async () => {
      const result = await service.canTransition('proj-1', 'InProgress', 'SpecificationValidation');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });

    it('allows Realization → DeploymentValidation without approval check', async () => {
      const result = await service.canTransition('proj-1', 'Realization', 'DeploymentValidation');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.projectValidation.count).not.toHaveBeenCalled();
    });
  });

  // ── canTransition — SpecificationValidation → Realization gate ───────────

  describe('canTransition — SpecificationValidation → Realization gate', () => {
    it('blocks when no SpecificationTeam approval exists', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(0);

      const result = await service.canTransition('proj-1', 'SpecificationValidation', 'Realization');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('SpecificationTeam');
      expect(mockPrisma.projectValidation.count).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          phase: 'SpecificationValidation',
          isApproved: true,
          validatedByRole: 'SpecificationTeam',
        },
      });
    });

    it('allows when at least 1 SpecificationTeam approval exists', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(1);

      const result = await service.canTransition('proj-1', 'SpecificationValidation', 'Realization');

      expect(result.isSuccess).toBe(true);
    });

    it('allows when multiple SpecificationTeam approvals exist', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(3);

      const result = await service.canTransition('proj-1', 'SpecificationValidation', 'Realization');

      expect(result.isSuccess).toBe(true);
    });
  });

  // ── canTransition — DeploymentValidation → Completed gate ────────────────

  describe('canTransition — DeploymentValidation → Completed gate', () => {
    it('bloque si aucune approbation ProjectManager n\'existe', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(0);

      const result = await service.canTransition('proj-1', 'DeploymentValidation', 'Completed');

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('ProjectManager');
      expect(mockPrisma.projectValidation.count).toHaveBeenCalledWith({
        where: {
          projectId: 'proj-1',
          phase: 'DeploymentValidation',
          isApproved: true,
          validatedByRole: 'ProjectManager',
        },
      });
    });

    it('autorise si au moins 1 approbation ProjectManager existe', async () => {
      mockPrisma.projectValidation.count.mockResolvedValue(1);

      const result = await service.canTransition('proj-1', 'DeploymentValidation', 'Completed');

      expect(result.isSuccess).toBe(true);
    });
  });
});
