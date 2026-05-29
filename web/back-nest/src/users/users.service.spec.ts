import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  tokenVersion: number;
}

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    firstName: 'Alice',
    lastName: 'Doe',
    email: 'alice@example.com',
    passwordHash: '$2a$12$existing-hash',
    role: 'Member',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    tokenVersion: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PrismaService
// ---------------------------------------------------------------------------

const mockPrisma = {
  appUser: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  project: { count: jest.fn() },
  workPackage: { count: jest.fn() },
  timeEntry: { count: jest.fn() },
  projectComment: { count: jest.fn() },
  workPackageComment: { count: jest.fn() },
  projectAttachment: { count: jest.fn() },
  workPackageAttachment: { count: jest.fn() },
};

const mockMail = {
  send: jest.fn(async () => undefined),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // ── getAll ─────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns paginated users mapped to UserResponseDto (passwordHash stripped)', async () => {
      const users = [makeUser(), makeUser({ id: 'user-2', email: 'bob@example.com' })];
      mockPrisma.appUser.findMany.mockResolvedValue(users);
      mockPrisma.appUser.count.mockResolvedValue(2);

      const result = await service.getAll(0, 20);

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual({
        items: [
          {
            id: 'user-1',
            firstName: 'Alice',
            lastName: 'Doe',
            email: 'alice@example.com',
            role: 'Member',
            isActive: true,
            createdAt: users[0].createdAt,
            lastLoginAt: null,
          },
          {
            id: 'user-2',
            firstName: 'Alice',
            lastName: 'Doe',
            email: 'bob@example.com',
            role: 'Member',
            isActive: true,
            createdAt: users[1].createdAt,
            lastLoginAt: null,
          },
        ],
        total: 2,
        skip: 0,
        take: 20,
      });
      // Defence-in-depth: no passwordHash field should leak in the response.
      for (const item of result.value!.items) {
        expect(item).not.toHaveProperty('passwordHash');
        expect(item).not.toHaveProperty('tokenVersion');
      }
    });

    it('builds an OR search filter on firstName/lastName/email when search is provided', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);
      mockPrisma.appUser.count.mockResolvedValue(0);

      await service.getAll(0, 20, 'ali');

      const call = mockPrisma.appUser.findMany.mock.calls[0][0] as {
        where: { OR: Array<Record<string, unknown>> };
      };
      expect(call.where.OR).toEqual([
        { firstName: { contains: 'ali' } },
        { lastName: { contains: 'ali' } },
        { email: { contains: 'ali' } },
      ]);
    });

    it('filters by role when role is provided', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);
      mockPrisma.appUser.count.mockResolvedValue(0);

      await service.getAll(0, 20, undefined, 'Admin');

      const call = mockPrisma.appUser.findMany.mock.calls[0][0] as {
        where: { role: string };
      };
      expect(call.where.role).toBe('Admin');
    });

    it('forwards skip/take to Prisma for pagination', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);
      mockPrisma.appUser.count.mockResolvedValue(0);

      await service.getAll(40, 10);

      const call = mockPrisma.appUser.findMany.mock.calls[0][0] as {
        skip: number;
        take: number;
        orderBy: unknown;
      };
      expect(call.skip).toBe(40);
      expect(call.take).toBe(10);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  // ── getById ───────────────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns the user when found (excludes soft-deleted via findFirst)', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(makeUser());

      const result = await service.getById('user-1');

      expect(result.isSuccess).toBe(true);
      expect(result.value?.id).toBe('user-1');
      expect(result.value).not.toHaveProperty('passwordHash');
      expect(mockPrisma.appUser.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', isDeleted: false },
      });
    });

    it('returns failure when not found (or soft-deleted)', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(null);

      const result = await service.getById('missing');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
    });
  });

  // ── getByRole ─────────────────────────────────────────────────────────────

  describe('getByRole', () => {
    it('returns only active users with the given role, ordered by lastName', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([makeUser()]);

      const result = await service.getByRole('ProjectManager');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toHaveLength(1);
      const call = mockPrisma.appUser.findMany.mock.calls[0][0] as {
        where: { role: string; isActive: boolean; isDeleted: boolean };
        orderBy: { lastName: string };
      };
      expect(call.where).toEqual({ role: 'ProjectManager', isActive: true, isDeleted: false });
      expect(call.orderBy).toEqual({ lastName: 'asc' });
    });

    it('returns an empty array when no users match', async () => {
      mockPrisma.appUser.findMany.mockResolvedValue([]);

      const result = await service.getByRole('SpecificationTeam');

      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual([]);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateUserDto = {
      firstName: 'Bob',
      lastName: 'Smith',
      email: 'bob@example.com',
      password: 'Secret123',
      role: 'Member',
    };

    it('hashes the password and creates the user on the happy path', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(null);
      const created = makeUser({ id: 'user-2', email: dto.email });
      mockPrisma.appUser.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result.isSuccess).toBe(true);
      expect(result.value?.email).toBe('bob@example.com');

      const createCall = mockPrisma.appUser.create.mock.calls[0][0] as {
        data: { passwordHash: string; password?: string };
      };
      // Password hashed (not stored in plaintext), and not present as `password`.
      expect(createCall.data.passwordHash).not.toBe(dto.password);
      expect(typeof createCall.data.passwordHash).toBe('string');
      expect(createCall.data.passwordHash.length).toBeGreaterThan(10);
      expect(createCall.data).not.toHaveProperty('password');

      // The hash must verify against the input password (real bcrypt).
      await expect(bcrypt.compare(dto.password, createCall.data.passwordHash)).resolves.toBe(true);
    });

    it('rejects duplicate emails before hashing', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(makeUser());

      const result = await service.create(dto);

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Un utilisateur avec cet email existe déjà.');
      expect(mockPrisma.appUser.create).not.toHaveBeenCalled();
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('patches only the provided fields (partial update)', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue({ ...user, firstName: 'Alicia' });

      const dto: UpdateUserDto = { firstName: 'Alicia' };
      const result = await service.update('user-1', dto);

      expect(result.isSuccess).toBe(true);
      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      // Only firstName is in the data payload — never password, never email if undefined.
      expect(updateCall.data).toEqual({ firstName: 'Alicia' });
      expect(updateCall.data).not.toHaveProperty('password');
      expect(updateCall.data).not.toHaveProperty('passwordHash');
    });

    it('never overwrites password (no password key in UpdateUserDto)', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue(user);

      // Pass a malicious payload with an extra password field — should be ignored
      // because the service only forwards firstName/lastName/email/role.
      const sneaky = { firstName: 'X', password: 'hacked', passwordHash: 'h' } as UpdateUserDto;
      await service.update('user-1', sneaky);

      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data).not.toHaveProperty('password');
      expect(updateCall.data).not.toHaveProperty('passwordHash');
    });

    it('returns failure when the user is not found', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);

      const result = await service.update('missing', { firstName: 'X' });

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('rejects an email change that collides with another active user', async () => {
      const user = makeUser({ email: 'alice@example.com' });
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.findFirst.mockResolvedValue(
        makeUser({ id: 'other', email: 'taken@example.com' }),
      );

      const result = await service.update('user-1', { email: 'taken@example.com' });

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Un utilisateur avec cet email existe déjà.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('allows updating to the same email (case-insensitive) without a uniqueness check', async () => {
      const user = makeUser({ email: 'Alice@Example.com' });
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue(user);

      await service.update('user-1', { email: 'alice@example.com' });

      expect(mockPrisma.appUser.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.appUser.update).toHaveBeenCalled();
    });

    it('forwards firstName, lastName, email, role when all are provided', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.findFirst.mockResolvedValue(null);
      mockPrisma.appUser.update.mockResolvedValue(user);

      await service.update('user-1', {
        firstName: 'New',
        lastName: 'Name',
        email: 'new@example.com',
        role: 'Admin',
      });

      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data).toEqual({
        firstName: 'New',
        lastName: 'Name',
        email: 'new@example.com',
        role: 'Admin',
      });
    });
  });

  // ── resetPassword ─────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('hashes a fresh temp password, increments tokenVersion, and fires the email (fire-and-forget)', async () => {
      const user = makeUser({ email: 'bob@example.com' });
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue(user);

      const result = await service.resetPassword('user-1');

      expect(result.isSuccess).toBe(true);

      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        data: { passwordHash: string; tokenVersion: { increment: number } };
      };
      expect(updateCall.data.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
      expect(updateCall.data.tokenVersion).toEqual({ increment: 1 });

      expect(mockMail.send).toHaveBeenCalledWith(
        'bob@example.com',
        expect.stringContaining('Réinitialisation'),
        expect.any(String),
      );
    });

    it('returns failure when the user is not found', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);

      const result = await service.resetPassword('missing');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('does not propagate mail-send failures (fire-and-forget)', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue(user);
      mockMail.send.mockRejectedValueOnce(new Error('SMTP down'));

      const result = await service.resetPassword('user-1');

      expect(result.isSuccess).toBe(true);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('refuses self-deactivation', async () => {
      const result = await service.deactivate('admin-1', 'admin-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Vous ne pouvez pas désactiver votre propre compte.');
      expect(mockPrisma.appUser.findUnique).not.toHaveBeenCalled();
    });

    it('flips isActive=false and increments tokenVersion', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser());
      mockPrisma.appUser.update.mockResolvedValue(makeUser({ isActive: false }));

      const result = await service.deactivate('user-1', 'admin-1');

      expect(result.isSuccess).toBe(true);
      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        data: { isActive: boolean; tokenVersion: { increment: number } };
      };
      expect(updateCall.data.isActive).toBe(false);
      expect(updateCall.data.tokenVersion).toEqual({ increment: 1 });
    });

    it('returns failure when the user is not found', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);

      const result = await service.deactivate('missing', 'admin-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── reactivate ────────────────────────────────────────────────────────────

  describe('reactivate', () => {
    it('flips isActive=true on an existing user', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser({ isActive: false }));
      mockPrisma.appUser.update.mockResolvedValue(makeUser({ isActive: true }));

      const result = await service.reactivate('user-1');

      expect(result.isSuccess).toBe(true);
      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        where: { id: string };
        data: { isActive: boolean };
      };
      expect(updateCall.where).toEqual({ id: 'user-1' });
      expect(updateCall.data).toEqual({ isActive: true });
    });

    it('returns failure when the user is not found', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);

      const result = await service.reactivate('missing');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete (soft-delete)', () => {
    it('refuses self-deletion', async () => {
      const result = await service.delete('admin-1', 'admin-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Vous ne pouvez pas supprimer votre propre compte.');
      expect(mockPrisma.appUser.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('returns failure when the user is not found (or already soft-deleted)', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(null);

      const result = await service.delete('missing', 'admin-1');

      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('soft-deletes: sets isDeleted=true, isActive=false, bumps tokenVersion (NO hard delete)', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValue(makeUser());
      mockPrisma.appUser.update.mockResolvedValue(makeUser({ isActive: false }));

      const result = await service.delete('user-1', 'admin-1');

      expect(result.isSuccess).toBe(true);
      // The lookup must exclude already-deleted users.
      expect(mockPrisma.appUser.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', isDeleted: false },
      });
      const updateCall = mockPrisma.appUser.update.mock.calls[0][0] as {
        where: { id: string };
        data: { isDeleted: boolean; isActive: boolean; tokenVersion: { increment: number } };
      };
      expect(updateCall.where).toEqual({ id: 'user-1' });
      expect(updateCall.data.isDeleted).toBe(true);
      expect(updateCall.data.isActive).toBe(false);
      expect(updateCall.data.tokenVersion).toEqual({ increment: 1 });
      // Never hard-deletes — history is preserved.
      expect(mockPrisma.appUser.delete).not.toHaveBeenCalled();
    });

    it('succeeds even for a user with history (no FK-blocker refusal)', async () => {
      // Previously this would refuse with "Suppression impossible". Soft-delete
      // never touches FK-referenced rows, so it always succeeds.
      mockPrisma.appUser.findFirst.mockResolvedValue(makeUser());
      mockPrisma.appUser.update.mockResolvedValue(makeUser({ isActive: false }));

      const result = await service.delete('user-1', 'admin-1');

      expect(result.isSuccess).toBe(true);
      expect(mockPrisma.appUser.delete).not.toHaveBeenCalled();
    });
  });
});
