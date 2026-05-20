import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SystemStatusService } from './system-status.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  $queryRaw: jest.fn(),
  appUser: { count: jest.fn(), aggregate: jest.fn() },
  project: { count: jest.fn(), groupBy: jest.fn() },
  auditLog: { count: jest.fn(), findMany: jest.fn() },
};

// No TRANSCRIPTION_URL → checkTranscription short-circuits to 'Désactivé' (no fetch).
const mockConfig = { get: jest.fn(() => undefined) };

/** Set sane defaults for the security/error queries so each test only sets what it asserts. */
function defaultSecurityMocks(): void {
  // appUser.count order: total, active, locked, attacked
  mockPrisma.appUser.aggregate.mockResolvedValue({ _sum: { failedLoginAttempts: 0 } });
  mockPrisma.auditLog.count.mockResolvedValue(0);
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
}

describe('SystemStatusService', () => {
  let service: SystemStatusService;

  beforeEach(async () => {
    jest.clearAllMocks();
    defaultSecurityMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemStatusService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<SystemStatusService>(SystemStatusService);
  });

  describe('getStatus', () => {
    it('returns Connecté and aggregated counts on the happy path', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockPrisma.appUser.count
        .mockResolvedValueOnce(50) // total
        .mockResolvedValueOnce(42) // active
        .mockResolvedValueOnce(0) // locked
        .mockResolvedValueOnce(0); // attacked
      mockPrisma.project.count.mockResolvedValueOnce(10);
      mockPrisma.project.groupBy.mockResolvedValue([
        { status: 'Active', _count: { _all: 6 } },
        { status: 'Completed', _count: { _all: 3 } },
        { status: 'Draft', _count: { _all: 1 } },
      ]);

      const result = await service.getStatus();

      expect(result).toMatchObject({
        serverStatus: 'up',
        databaseStatus: 'Connecté',
        transcriptionStatus: 'Désactivé',
        userTotal: 50,
        userActive: 42,
        projectTotal: 10,
        projectByStatus: { Active: 6, Completed: 3, Draft: 1 },
      });
      expect(result.security).toMatchObject({ lockedAccounts: 0, accountsUnderAttack: 0, logins24h: 0 });
      expect(result.errors).toMatchObject({ recent: [] });
      expect(typeof result.uptimeSeconds).toBe('number');
      expect(mockPrisma.appUser.count).toHaveBeenCalledTimes(4);
      expect(mockPrisma.project.count).toHaveBeenCalledWith({ where: { isDeleted: false } });
    });

    it('returns Erreur for databaseStatus when $queryRaw rejects', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));
      mockPrisma.appUser.count.mockResolvedValue(0);
      mockPrisma.project.count.mockResolvedValue(0);
      mockPrisma.project.groupBy.mockResolvedValue([]);

      const result = await service.getStatus();

      expect(result.databaseStatus).toBe('Erreur');
    });

    it('returns an empty projectByStatus object when there are no projects', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      mockPrisma.appUser.count.mockResolvedValue(0);
      mockPrisma.project.count.mockResolvedValueOnce(0);
      mockPrisma.project.groupBy.mockResolvedValue([]);

      const result = await service.getStatus();

      expect(result.projectByStatus).toEqual({});
      expect(result.projectTotal).toBe(0);
    });

    it('groupBy is scoped to non-deleted projects', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{}]);
      mockPrisma.appUser.count.mockResolvedValue(1);
      mockPrisma.project.count.mockResolvedValueOnce(1);
      mockPrisma.project.groupBy.mockResolvedValue([{ status: 'Active', _count: { _all: 1 } }]);

      await service.getStatus();

      const groupArgs = mockPrisma.project.groupBy.mock.calls[0][0] as {
        where: { isDeleted: boolean };
        by: string[];
      };
      expect(groupArgs.where.isDeleted).toBe(false);
      expect(groupArgs.by).toEqual(['status']);
    });
  });
});
