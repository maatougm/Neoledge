import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<AuditService>(AuditService);
  });

  // ── log ────────────────────────────────────────────────────────────────────

  describe('log', () => {
    it('writes an audit row with serialised changes + metadata', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});
      await service.log('Project', 'p1', 'CREATE', 'u1',
        { name: { before: 'old', after: 'new' } },
        { ip: '1.2.3.4' },
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: 'Project',
          entityId: 'p1',
          action: 'CREATE',
          userId: 'u1',
          changes: JSON.stringify({ name: { before: 'old', after: 'new' } }),
          metadata: JSON.stringify({ ip: '1.2.3.4' }),
        }),
      });
    });

    it('persists null userId when omitted', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});
      await service.log('Project', 'p1', 'CREATE');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: null, changes: null, metadata: null }),
      });
    });

    it('truncates metadata JSON to 1000 chars', async () => {
      mockPrisma.auditLog.create.mockResolvedValue({});
      const huge: Record<string, string> = {};
      for (let i = 0; i < 100; i++) huge[`k${i}`] = 'x'.repeat(50);
      await service.log('Project', 'p1', 'UPDATE', 'u1', undefined, huge);
      const call = mockPrisma.auditLog.create.mock.calls[0][0] as {
        data: { metadata: string };
      };
      expect(call.data.metadata.length).toBeLessThanOrEqual(1000);
    });

    it('never throws when prisma rejects (fire-and-forget contract)', async () => {
      mockPrisma.auditLog.create.mockRejectedValue(new Error('DB down'));
      await expect(service.log('Project', 'p1', 'CREATE', 'u1')).resolves.toBeUndefined();
    });
  });

  // ── getForEntity ───────────────────────────────────────────────────────────

  describe('getForEntity', () => {
    it('returns dto-mapped rows with user + parsed JSON', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1', entityType: 'Project', entityId: 'p1', action: 'UPDATE',
          userId: 'u1', user: { id: 'u1', firstName: 'Alice', lastName: 'PM', role: 'ProjectManager' },
          changes: JSON.stringify({ name: { before: 'A', after: 'B' } }),
          metadata: JSON.stringify({ source: 'admin' }),
          createdAt: new Date('2026-01-01'),
        },
      ]);
      const result = await service.getForEntity('Project', 'p1');
      expect(result.isSuccess).toBe(true);
      const items = result.value!;
      expect(items[0]).toEqual({
        id: 'log-1',
        entityType: 'Project',
        entityId: 'p1',
        action: 'UPDATE',
        userId: 'u1',
        user: 'Alice PM',
        userRole: 'ProjectManager',
        changes: { name: { before: 'A', after: 'B' } },
        metadata: { source: 'admin' },
        createdAt: new Date('2026-01-01'),
      });
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'Project', entityId: 'p1' },
        include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
    });

    it('tolerates corrupted JSON in changes / metadata (returns null, not throw)', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1', entityType: 'Project', entityId: 'p1', action: 'CREATE',
          userId: null, user: null,
          changes: '{not valid json',
          metadata: 'also broken',
          createdAt: new Date(),
        },
      ]);
      const result = await service.getForEntity('Project', 'p1');
      expect(result.isSuccess).toBe(true);
      expect(result.value![0].changes).toBeNull();
      expect(result.value![0].metadata).toBeNull();
      expect(result.value![0].user).toBeNull();
      expect(result.value![0].userRole).toBeNull();
    });

    it('returns empty array when no rows', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      const result = await service.getForEntity('Project', 'nope');
      expect(result.value).toEqual([]);
    });
  });

  // ── getForUser ─────────────────────────────────────────────────────────────

  describe('getForUser', () => {
    it('queries by userId, ordered desc, limited to 100', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      await service.getForUser('u1');
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });

    it('maps rows through the dto', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([
        { id: 'l1', entityType: 'User', entityId: 'u1', action: 'LOGIN', userId: 'u1',
          changes: null, metadata: null, createdAt: new Date() },
      ]);
      const result = await service.getForUser('u1');
      expect(result.value![0]).toEqual(expect.objectContaining({
        id: 'l1', action: 'LOGIN', userId: 'u1', user: null, userRole: null,
        changes: null, metadata: null,
      }));
    });
  });

  // ── getRecent ──────────────────────────────────────────────────────────────

  describe('getRecent', () => {
    it('defaults to take=50 when no limit passed', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      await service.getRecent();
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('honours custom limit', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      await service.getRecent(10);
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('includes the user relation', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);
      await service.getRecent();
      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
        }),
      );
    });
  });
});
