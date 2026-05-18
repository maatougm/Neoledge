/**
 * @file profile.service.spec.ts — unit tests for ProfileService.
 *
 * fs operations are mocked so the suite never touches the real filesystem.
 * bcrypt runs real round-12 hashes so the password-change happy-path is
 * end-to-end correct.
 */

import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { ProfileService } from './profile.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

const mockPrisma = {
  appUser: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

function makeUser(overrides: Partial<{
  id: string; firstName: string; lastName: string; email: string;
  role: string; avatarPath: string | null; jobTitle: string | null;
  phoneNumber: string | null; department: string | null;
  createdAt: Date; lastLoginAt: Date | null;
  passwordHash: string; preferences: string | null;
}> = {}) {
  return {
    id: 'u1',
    firstName: 'Alice',
    lastName: 'PM',
    email: 'alice@example.com',
    role: 'ProjectManager',
    avatarPath: null as string | null,
    jobTitle: 'Engineer',
    phoneNumber: '0123456789',
    department: 'Eng',
    createdAt: new Date('2026-01-01'),
    lastLoginAt: null as Date | null,
    passwordHash: bcrypt.hashSync('OldP@ssw0rd', 4), // round 4 = fast in tests
    preferences: null as string | null,
    ...overrides,
  };
}

// Build PNG buffer (magic bytes 89 50 4E 47) — used in avatar happy path.
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const PNG_BASE64 = PNG_HEADER.toString('base64');

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<ProfileService>(ProfileService);
  });

  // ── getProfile ─────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('returns the dto when the user exists', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      const result = await service.getProfile('u1');
      expect(result.isSuccess).toBe(true);
      expect(result.value).toEqual({
        id: 'u1', firstName: 'Alice', lastName: 'PM', email: 'alice@example.com',
        role: 'ProjectManager', avatarPath: null,
        jobTitle: 'Engineer', phoneNumber: '0123456789', department: 'Eng',
        createdAt: user.createdAt, lastLoginAt: null,
      });
    });

    it('fails when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const result = await service.getProfile('nope');
      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Utilisateur non trouvé.');
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────

  describe('updateProfile', () => {
    it('only patches the fields actually provided', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser());
      mockPrisma.appUser.update.mockResolvedValue(makeUser({ firstName: 'Renamed' }));
      await service.updateProfile('u1', { firstName: 'Renamed' });
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { firstName: 'Renamed' },
      });
    });

    it('forwards every field when all provided', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser());
      mockPrisma.appUser.update.mockResolvedValue(makeUser());
      await service.updateProfile('u1', {
        firstName: 'A', lastName: 'B', jobTitle: 'C', phoneNumber: 'D', department: 'E',
      });
      const data = mockPrisma.appUser.update.mock.calls[0][0].data;
      expect(data).toEqual({ firstName: 'A', lastName: 'B', jobTitle: 'C', phoneNumber: 'D', department: 'E' });
    });

    it('fails when the user is missing (no update call)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const result = await service.updateProfile('nope', { firstName: 'X' });
      expect(result.isFailure).toBe(true);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('hashes the new password and bumps tokenVersion on success', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValue(user);
      mockPrisma.appUser.update.mockResolvedValue({});
      const result = await service.changePassword('u1', 'OldP@ssw0rd', 'NewP@ssw0rd1');
      expect(result.isSuccess).toBe(true);
      const data = mockPrisma.appUser.update.mock.calls[0][0].data as {
        passwordHash: string; tokenVersion: { increment: number };
      };
      expect(data.passwordHash).toMatch(/^\$2[abxy]\$/);
      expect(data.tokenVersion).toEqual({ increment: 1 });
    });

    it('fails when the current password is wrong (no update)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser());
      const result = await service.changePassword('u1', 'wrong', 'NewP@ssw0rd1');
      expect(result.isFailure).toBe(true);
      expect(result.error).toBe('Mot de passe actuel incorrect.');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('fails on a weak new password (no uppercase / digit / special)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(makeUser());
      const result = await service.changePassword('u1', 'OldP@ssw0rd', 'simple');
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('majuscule');
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('fails when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const result = await service.changePassword('nope', 'x', 'y');
      expect(result.isFailure).toBe(true);
    });
  });

  // ── uploadAvatar ───────────────────────────────────────────────────────────

  describe('uploadAvatar', () => {
    beforeEach(() => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.writeFileSync.mockImplementation(() => undefined);
      mockedFs.mkdirSync.mockImplementation(() => undefined as never);
    });

    it('writes the file and updates avatarPath on a valid PNG', async () => {
      mockPrisma.appUser.update.mockResolvedValue({});
      const result = await service.uploadAvatar('u1', PNG_BASE64, 'png');
      expect(result.isSuccess).toBe(true);
      expect(result.value).toMatch(/^\/uploads\/avatars\/u1-.+\.png$/);
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { avatarPath: result.value },
      });
    });

    it('accepts extensions with or without a leading dot', async () => {
      mockPrisma.appUser.update.mockResolvedValue({});
      const r1 = await service.uploadAvatar('u1', PNG_BASE64, '.png');
      expect(r1.isSuccess).toBe(true);
      const r2 = await service.uploadAvatar('u1', PNG_BASE64, 'png');
      expect(r2.isSuccess).toBe(true);
    });

    it('rejects oversized images (> 2 MB)', async () => {
      const big = Buffer.alloc(2 * 1024 * 1024 + 100).toString('base64');
      const result = await service.uploadAvatar('u1', big, 'png');
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('volumineuse');
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('rejects disallowed extensions (e.g. .svg)', async () => {
      const result = await service.uploadAvatar('u1', PNG_BASE64, 'svg');
      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Extension non autorisée');
    });

    it('rejects files whose magic bytes do not match the extension (MIME spoofing)', async () => {
      const fakePng = Buffer.from('not actually an image but pretending').toString('base64');
      const result = await service.uploadAvatar('u1', fakePng, 'png');
      expect(result.isFailure).toBe(true);
    });

    it('mkdirs the avatar directory when missing', async () => {
      mockedFs.existsSync.mockReturnValueOnce(false); // AVATAR_DIR check
      mockPrisma.appUser.update.mockResolvedValue({});
      await service.uploadAvatar('u1', PNG_BASE64, 'png');
      expect(mockedFs.mkdirSync).toHaveBeenCalled();
    });
  });

  // ── getAvatarPath ──────────────────────────────────────────────────────────

  describe('getAvatarPath', () => {
    it('returns the absolute path when stored row is sane', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ avatarPath: '/uploads/avatars/u1-x.png' });
      mockedFs.existsSync.mockReturnValue(true);
      const result = await service.getAvatarPath('u1');
      expect(result.isSuccess).toBe(true);
      expect(result.value).toMatch(/uploads[\\/]avatars[\\/]u1-x\.png$/);
    });

    it('fails when user is missing', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const r = await service.getAvatarPath('u1');
      expect(r.isFailure).toBe(true);
    });

    it('fails when avatarPath is null', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ avatarPath: null });
      const r = await service.getAvatarPath('u1');
      expect(r.isFailure).toBe(true);
    });

    it('fails when the file does not exist on disk', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ avatarPath: '/uploads/avatars/u1.png' });
      mockedFs.existsSync.mockReturnValue(false);
      const r = await service.getAvatarPath('u1');
      expect(r.isFailure).toBe(true);
    });

    it('blocks path-traversal attempts (avatarPath that escapes the upload root)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ avatarPath: '/../../etc/passwd' });
      mockedFs.existsSync.mockReturnValue(true);
      const r = await service.getAvatarPath('u1');
      expect(r.isFailure).toBe(true);
      expect(r.error).toContain('invalide');
    });
  });

  // ── getPreferences ─────────────────────────────────────────────────────────

  describe('getPreferences', () => {
    it('returns parsed preferences when set', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({
        preferences: JSON.stringify({ darkMode: true, language: 'en' }),
      });
      const r = await service.getPreferences('u1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual({ darkMode: true, language: 'en' });
    });

    it('returns DEFAULT_PREFERENCES when preferences blob is null', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ preferences: null });
      const r = await service.getPreferences('u1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(expect.objectContaining({
        emailNotificationsEnabled: true, darkMode: false, language: 'fr',
      }));
    });

    it('returns DEFAULTS when preferences blob is corrupted', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ preferences: '{broken' });
      const r = await service.getPreferences('u1');
      expect(r.isSuccess).toBe(true);
      expect(r.value).toEqual(expect.objectContaining({ darkMode: false }));
    });

    it('fails when user is missing', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const r = await service.getPreferences('nope');
      expect(r.isFailure).toBe(true);
    });
  });

  // ── updatePreferences ──────────────────────────────────────────────────────

  describe('updatePreferences', () => {
    it('merges with existing preferences (does not replace)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({
        preferences: JSON.stringify({ darkMode: false, language: 'fr', customSettings: { x: 1 } }),
      });
      mockPrisma.appUser.update.mockResolvedValue({});
      await service.updatePreferences('u1', { darkMode: true });
      const data = mockPrisma.appUser.update.mock.calls[0][0].data as { preferences: string };
      expect(JSON.parse(data.preferences)).toEqual({
        darkMode: true, language: 'fr', customSettings: { x: 1 },
      });
    });

    it('starts from empty when existing preferences is corrupt', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue({ preferences: '{broken' });
      mockPrisma.appUser.update.mockResolvedValue({});
      await service.updatePreferences('u1', { darkMode: true });
      const data = mockPrisma.appUser.update.mock.calls[0][0].data as { preferences: string };
      expect(JSON.parse(data.preferences)).toEqual({ darkMode: true });
    });

    it('fails when user is missing (no update)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValue(null);
      const r = await service.updatePreferences('u1', { darkMode: true });
      expect(r.isFailure).toBe(true);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });
});
