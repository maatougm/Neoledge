import { Test, TestingModule } from '@nestjs/testing';
import { TeamsService } from './teams.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  team: {
    findMany: jest.fn(),
  },
};

describe('TeamsService', () => {
  let service: TeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TeamsService>(TeamsService);
  });

  describe('findAll', () => {
    it('returns mapped DTO list ordered by code', async () => {
      const rows = [
        { id: 't1', code: 'ALPHA', name: 'Alpha team', managerUserId: 'u1', createdAt: new Date('2026-01-01') },
        { id: 't2', code: 'BETA',  name: 'Beta',       managerUserId: null, createdAt: new Date('2026-01-02') },
      ];
      mockPrisma.team.findMany.mockResolvedValue(rows);

      const r = await service.findAll();

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual([
        { id: 't1', code: 'ALPHA', name: 'Alpha team', managerUserId: 'u1', createdAt: rows[0].createdAt },
        { id: 't2', code: 'BETA',  name: 'Beta',       managerUserId: null, createdAt: rows[1].createdAt },
      ]);
      expect(mockPrisma.team.findMany).toHaveBeenCalledWith({ orderBy: { code: 'asc' } });
    });

    it('returns empty array when there are no teams', async () => {
      mockPrisma.team.findMany.mockResolvedValue([]);
      const r = await service.findAll();
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual([]);
    });

    it('returns failure with the error message when prisma throws', async () => {
      mockPrisma.team.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.findAll();
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('DB down');
    });

    it('returns failure with a generic message when prisma throws a non-Error', async () => {
      mockPrisma.team.findMany.mockRejectedValue('odd');
      const r = await service.findAll();
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Failed to fetch teams');
    });
  });
});
