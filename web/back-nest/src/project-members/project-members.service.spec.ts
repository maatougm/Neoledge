import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ProjectMembersService } from './project-members.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const mockPrisma = {
  project: { findUnique: jest.fn() },
  appUser: { findUnique: jest.fn() },
  projectMember: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workPackage: { count: jest.fn(), updateMany: jest.fn() },
  timeEntry: { count: jest.fn() },
  workPackageWatcher: { count: jest.fn() },
  meetingAttendee: { count: jest.fn() },
  $transaction: jest.fn(),
};

const mockNotifications = {
  notifyEnhanced: jest.fn().mockResolvedValue(undefined),
};

function knownError(code: string) {
  // Construct a real Prisma.PrismaClientKnownRequestError so instanceof passes.
  const err = new (Prisma.PrismaClientKnownRequestError as unknown as new (
    msg: string,
    args: { code: string; clientVersion: string },
  ) => Error)('boom', { code, clientVersion: '7.0.0' });
  return err;
}

describe('ProjectMembersService', () => {
  let service: ProjectMembersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectMembersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(ProjectMembersService);
  });

  describe('findAll', () => {
    it('returns members with the projectManagerId', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ projectManagerId: 'pm1' });
      mockPrisma.projectMember.findMany.mockResolvedValue([
        { id: 'm1', userId: 'u1', label: 'Dev', createdAt: new Date(), user: { id: 'u1' } },
      ]);
      const r = await service.findAll('p1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.projectManagerId).toBe('pm1');
      expect(r.value.members).toHaveLength(1);
    });

    it('handles projectManagerId null', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.projectMember.findMany.mockResolvedValue([]);
      const r = await service.findAll('p1');
      expect(r.isSuccess).toBe(true);
      expect(r.value.projectManagerId).toBeNull();
    });
  });

  describe('add', () => {
    it('rejects when project missing', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      const r = await service.add('missing', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Projet introuvable');
    });

    it('rejects when project is soft-deleted', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', isDeleted: true });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Projet introuvable');
    });

    it('rejects when target user missing', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const r = await service.add('p1', 'missing', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Utilisateur introuvable');
    });

    it('rejects inactive user', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: false, role: 'Member' });
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Cet utilisateur est désactivé');
    });

    it('rejects Admin role', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Admin' });
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
    });

    it('rejects adding the PM as a member', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'pm1', isActive: true, role: 'ProjectManager' });
      const r = await service.add('p1', 'pm1', '');
      expect(r.isFailure).toBe(true);
    });

    it('happy path inserts a row and fires notify', async () => {
      mockPrisma.project.findUnique.mockResolvedValueOnce({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      mockPrisma.projectMember.create.mockResolvedValue({ id: 'mem-1' });
      // The fire-and-forget notify also fetches project name:
      mockPrisma.project.findUnique.mockResolvedValueOnce({ name: 'Proj' });

      const r = await service.add('p1', 'u1', 'Dev');
      expect(r.isSuccess).toBe(true);
      expect(r.value.id).toBe('mem-1');
      // Allow the fire-and-forget promise to resolve before assertion.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockNotifications.notifyEnhanced).toHaveBeenCalled();
    });

    it('returns "déjà dans le projet" on P2002', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      mockPrisma.projectMember.create.mockRejectedValue(knownError('P2002'));
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Ce membre est déjà dans le projet');
    });

    it('returns "introuvable" on P2003 FK error', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      mockPrisma.projectMember.create.mockRejectedValue(knownError('P2003'));
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Utilisateur introuvable');
    });

    it('generic failure path', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ id: 'p1', projectManagerId: 'pm1', isDeleted: false });
      mockPrisma.appUser.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'Member' });
      mockPrisma.projectMember.create.mockRejectedValue(new Error('DB down'));
      const r = await service.add('p1', 'u1', '');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/Erreur lors/);
    });
  });

  describe('updateLabel', () => {
    it('happy path', async () => {
      mockPrisma.projectMember.update.mockResolvedValue({});
      const r = await service.updateLabel('m1', 'Lead');
      expect(r.isSuccess).toBe(true);
    });
    it('returns introuvable on P2025', async () => {
      mockPrisma.projectMember.update.mockRejectedValue(knownError('P2025'));
      const r = await service.updateLabel('missing', 'Lead');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Membre introuvable');
    });
    it('generic error', async () => {
      mockPrisma.projectMember.update.mockRejectedValue(new Error('boom'));
      const r = await service.updateLabel('m1', 'Lead');
      expect(r.isFailure).toBe(true);
    });
  });

  describe('remove', () => {
    function setupTxNoBlockers() {
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(0), updateMany: mockPrisma.workPackage.updateMany },
          timeEntry: { count: jest.fn().mockResolvedValue(0) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: { findUnique: jest.fn().mockResolvedValue({ id: 'new' }), delete: jest.fn() },
        });
      });
    }

    it('fails when member not found', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue(null);
      const r = await service.remove('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Membre introuvable');
    });

    it('returns BLOCKERS error when work-related rows exist and no force/reassign', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({
        id: 'm1', projectId: 'p1', userId: 'u1', project: { name: 'Proj' },
      });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(3), updateMany: jest.fn() },
          timeEntry: { count: jest.fn().mockResolvedValue(2) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: { findUnique: jest.fn(), delete: jest.fn() },
        });
      });
      const r = await service.remove('m1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/^BLOCKERS:/);
      const json = JSON.parse(r.error.replace('BLOCKERS:', ''));
      expect(json).toEqual({ workPackages: 3, timeEntries: 2, watchers: 0, attendees: 0 });
    });

    it('reassigns WPs to new member then deletes (force=false, reassignTo set)', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({
        id: 'm1', projectId: 'p1', userId: 'u1', project: { name: 'Proj' },
      });
      const updateMany = jest.fn().mockResolvedValue({ count: 2 });
      const deleteFn = jest.fn();
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(2), updateMany },
          timeEntry: { count: jest.fn().mockResolvedValue(0) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: {
            findUnique: jest.fn().mockResolvedValue({ id: 'new-member' }),
            delete: deleteFn,
          },
        });
      });

      const r = await service.remove('m1', { reassignTo: 'u2', actorId: 'admin' });
      expect(r.isSuccess).toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', assigneeId: 'u1' },
        data: { assigneeId: 'u2', updatedAt: expect.any(Date) },
      });
      expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'm1' } });
      await new Promise((resolve) => setImmediate(resolve));
      // Two notifications: removed-user + takeover.
      expect(mockNotifications.notifyEnhanced).toHaveBeenCalledTimes(2);
    });

    it('rejects when reassignTo is not a project member', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({
        id: 'm1', projectId: 'p1', userId: 'u1', project: { name: 'Proj' },
      });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(1), updateMany: jest.fn() },
          timeEntry: { count: jest.fn().mockResolvedValue(0) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: { findUnique: jest.fn().mockResolvedValue(null), delete: jest.fn() },
        });
      });
      const r = await service.remove('m1', { reassignTo: 'u2' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toMatch(/remplacement/);
    });

    it('force=true nulls out assignee then deletes', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({
        id: 'm1', projectId: 'p1', userId: 'u1', project: { name: 'Proj' },
      });
      const updateMany = jest.fn().mockResolvedValue({ count: 4 });
      const deleteFn = jest.fn();
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(4), updateMany },
          timeEntry: { count: jest.fn().mockResolvedValue(0) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: { findUnique: jest.fn(), delete: deleteFn },
        });
      });

      const r = await service.remove('m1', { force: true });
      expect(r.isSuccess).toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', assigneeId: 'u1' },
        data: { assigneeId: null, updatedAt: expect.any(Date) },
      });
      expect(deleteFn).toHaveBeenCalled();
    });

    it('no-blocker happy path deletes without WP update', async () => {
      mockPrisma.projectMember.findUnique.mockResolvedValue({
        id: 'm1', projectId: 'p1', userId: 'u1', project: { name: 'Proj' },
      });
      const updateMany = jest.fn();
      const deleteFn = jest.fn();
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
        await fn({
          workPackage: { count: jest.fn().mockResolvedValue(0), updateMany },
          timeEntry: { count: jest.fn().mockResolvedValue(0) },
          workPackageWatcher: { count: jest.fn().mockResolvedValue(0) },
          meetingAttendee: { count: jest.fn().mockResolvedValue(0) },
          projectMember: { findUnique: jest.fn(), delete: deleteFn },
        });
      });

      const r = await service.remove('m1');
      expect(r.isSuccess).toBe(true);
      expect(updateMany).not.toHaveBeenCalled();
      expect(deleteFn).toHaveBeenCalled();
    });
  });
});
