import { Test, TestingModule } from '@nestjs/testing';
import { AttendeesService } from './attendees.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  meetingAttendee: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('AttendeesService', () => {
  let service: AttendeesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendeesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<AttendeesService>(AttendeesService);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns attendees ordered by createdAt with user details', async () => {
      const rows = [
        { id: 'at1', meetingId: 'm1', user: { id: 'u1', firstName: 'A', lastName: 'B', email: 'a@x.com', avatarPath: null } },
      ];
      mockPrisma.meetingAttendee.findMany.mockResolvedValue(rows);

      const r = await service.list('m1');

      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(rows);
      expect(mockPrisma.meetingAttendee.findMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1' },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });

    it('returns failure when Prisma throws', async () => {
      mockPrisma.meetingAttendee.findMany.mockRejectedValue(new Error('DB down'));
      const r = await service.list('m1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── add ───────────────────────────────────────────────────────────────────

  describe('add', () => {
    it('creates an internal-user attendee with all fields', async () => {
      mockPrisma.meetingAttendee.create.mockResolvedValue({ id: 'at-new' });
      const r = await service.add('m1', { userId: 'u1', role: 'Reviewer', isPresent: true });
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAttendee.create).toHaveBeenCalledWith({
        data: {
          meetingId: 'm1',
          userId: 'u1',
          externalName: null,
          externalEmail: null,
          role: 'Reviewer',
          isPresent: true,
        },
      });
    });

    it('creates an external attendee with name + email and isPresent defaulting to false', async () => {
      mockPrisma.meetingAttendee.create.mockResolvedValue({ id: 'at-new' });
      await service.add('m1', { externalName: 'Alice Ext', externalEmail: 'alice@ext.com' });
      const call = mockPrisma.meetingAttendee.create.mock.calls[0][0] as { data: { userId: unknown; externalName: string; externalEmail: string; isPresent: boolean; role: unknown } };
      expect(call.data.userId).toBeNull();
      expect(call.data.externalName).toBe('Alice Ext');
      expect(call.data.externalEmail).toBe('alice@ext.com');
      expect(call.data.isPresent).toBe(false);
      expect(call.data.role).toBeNull();
    });

    it('returns failure when Prisma rejects (e.g. duplicate)', async () => {
      mockPrisma.meetingAttendee.create.mockRejectedValue(new Error('unique violation'));
      const r = await service.add('m1', { userId: 'u1' });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('forwards the patch (isPresent + role)', async () => {
      mockPrisma.meetingAttendee.update.mockResolvedValue({ id: 'at1', isPresent: true });
      const r = await service.update('at1', { isPresent: true, role: 'Lead' });
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAttendee.update).toHaveBeenCalledWith({
        where: { id: 'at1' },
        data: { isPresent: true, role: 'Lead' },
      });
    });

    it('supports clearing the role with role: null', async () => {
      mockPrisma.meetingAttendee.update.mockResolvedValue({ id: 'at1', role: null });
      await service.update('at1', { role: null });
      const call = mockPrisma.meetingAttendee.update.mock.calls[0][0] as { data: { role: null } };
      expect(call.data.role).toBeNull();
    });

    it('returns failure when row not found', async () => {
      mockPrisma.meetingAttendee.update.mockRejectedValue(new Error('P2025'));
      const r = await service.update('missing', { isPresent: true });
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the row by id', async () => {
      mockPrisma.meetingAttendee.delete.mockResolvedValue({});
      const r = await service.remove('at1');
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAttendee.delete).toHaveBeenCalledWith({ where: { id: 'at1' } });
    });

    it('returns failure when row not found', async () => {
      mockPrisma.meetingAttendee.delete.mockRejectedValue(new Error('P2025'));
      const r = await service.remove('missing');
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });
  });

  // ── bulkMarkPresent ───────────────────────────────────────────────────────

  describe('bulkMarkPresent', () => {
    it('updates only rows scoped to the meeting (no cross-meeting leakage)', async () => {
      mockPrisma.meetingAttendee.updateMany.mockResolvedValue({ count: 2 });
      const r = await service.bulkMarkPresent('m1', ['at1', 'at2'], true);
      expect(r.isSuccess).toBe(true);
      expect(mockPrisma.meetingAttendee.updateMany).toHaveBeenCalledWith({
        where: { meetingId: 'm1', id: { in: ['at1', 'at2'] } },
        data: { isPresent: true },
      });
    });

    it('handles the false-flip path (mark absent)', async () => {
      mockPrisma.meetingAttendee.updateMany.mockResolvedValue({ count: 1 });
      await service.bulkMarkPresent('m1', ['at1'], false);
      const call = mockPrisma.meetingAttendee.updateMany.mock.calls[0][0] as { data: { isPresent: boolean } };
      expect(call.data.isPresent).toBe(false);
    });

    it('returns failure when Prisma rejects', async () => {
      mockPrisma.meetingAttendee.updateMany.mockRejectedValue(new Error('DB down'));
      const r = await service.bulkMarkPresent('m1', ['at1'], true);
      expect(r.isFailure).toBe(true);
      expect(r.error).toBe('Échec.');
    });

    it('accepts an empty ids array as a no-op success', async () => {
      mockPrisma.meetingAttendee.updateMany.mockResolvedValue({ count: 0 });
      const r = await service.bulkMarkPresent('m1', [], true);
      expect(r.isSuccess).toBe(true);
    });
  });
});
