// Stub the real TotpService BEFORE any import that transitively loads it —
// the real file pulls in `otplib` → `@scure/base`, which ships as ESM-only
// and breaks ts-jest's CJS transform. We replace it with an Injectable
// stub class so DI still works.
jest.mock('./totp.service', () => {
  class TotpService {
    generateSecret = jest.fn();
    generateQrCode = jest.fn();
    verify = jest.fn();
  }
  return { TotpService };
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';

// ---------------------------------------------------------------------------
// Test fixtures + helpers
// ---------------------------------------------------------------------------

// 32+ char JWT secret — the real getJwtSecret() rejects anything shorter.
const TEST_JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-aaaa';

interface DbUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  passwordHash: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  totpEnabled: boolean;
  totpSecret: string | null;
}

// We compute these once so the bcrypt hashing tax is paid once, not per test.
let SHARED_PASSWORD_HASH: string;
const SHARED_PASSWORD = 'CorrectHorseBatteryStaple1!';
const WRONG_PASSWORD = 'wrong-password';

beforeAll(async () => {
  // Use a cheap salt round in tests so the suite finishes quickly. The
  // service hashes with rounds=12 internally, but the IDENTITY of the hash
  // doesn't matter — only the round-trip (compare succeeds for the right
  // password, fails for the wrong one).
  SHARED_PASSWORD_HASH = await bcrypt.hash(SHARED_PASSWORD, 4);
});

function makeUser(overrides: Partial<DbUser> = {}): DbUser {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    role: 'Member',
    passwordHash: SHARED_PASSWORD_HASH,
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    totpEnabled: false,
    totpSecret: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  appUser: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
    if (key === 'FRONTEND_URL') return 'https://app.example.com';
    if (key === 'NODE_ENV') return 'development';
    return undefined;
  }),
};

const mockTotp = {
  verify: jest.fn(),
  generateSecret: jest.fn(() => ({ secret: 'TOTPSECRET', otpauthUrl: 'otpauth://totp/x' })),
  generateQrCode: jest.fn(async () => 'data:image/png;base64,XYZ'),
};

const mockAudit = {
  log: jest.fn(async () => undefined),
};

const mockMail = {
  send: jest.fn(async () => undefined),
};

// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore default mock returns after clearAllMocks wiped them.
    mockJwt.sign.mockReturnValue('mock.jwt.token');
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
      if (key === 'FRONTEND_URL') return 'https://app.example.com';
      if (key === 'NODE_ENV') return 'development';
      return undefined;
    });
    mockTotp.generateSecret.mockReturnValue({ secret: 'TOTPSECRET', otpauthUrl: 'otpauth://totp/x' });
    mockTotp.generateQrCode.mockResolvedValue('data:image/png;base64,XYZ');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: ConfigService, useValue: mockConfig },
        { provide: TotpService, useValue: mockTotp },
        { provide: AuditService, useValue: mockAudit },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('returns a JWT on correct password (no TOTP)', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});
      mockPrisma.appUser.findUniqueOrThrow.mockResolvedValue({ tokenVersion: 7 });

      const result = await service.login(user.email, SHARED_PASSWORD);

      expect('jwt' in result && result.jwt).toBe('mock.jwt.token');
      // Failed-attempts counter reset on success.
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date),
        }),
      });
      // JWT signed with tokenVersion + aud='access'.
      expect(mockJwt.sign).toHaveBeenCalledWith(expect.objectContaining({
        sub: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: 7,
        aud: 'access',
      }));
      // Audit row written.
      expect(mockAudit.log).toHaveBeenCalledWith('AppUser', user.id, 'LOGIN', user.id);
    });

    it('rejects on wrong password and increments failed attempts', async () => {
      const user = makeUser({ failedLoginAttempts: 2 });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(service.login(user.email, WRONG_PASSWORD)).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: 3 },
      });
    });

    it('locks the account after 5 failed attempts', async () => {
      const user = makeUser({ failedLoginAttempts: 4 });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(service.login(user.email, WRONG_PASSWORD)).rejects.toThrow(UnauthorizedException);

      const call = mockPrisma.appUser.update.mock.calls[0]?.[0] as {
        data: { failedLoginAttempts: number; lockedUntil?: Date };
      };
      expect(call.data.failedLoginAttempts).toBe(5);
      expect(call.data.lockedUntil).toBeInstanceOf(Date);
      // Lock window is 15 minutes from now.
      const minutesAhead = (call.data.lockedUntil!.getTime() - Date.now()) / 60_000;
      expect(minutesAhead).toBeGreaterThan(14);
      expect(minutesAhead).toBeLessThan(16);
    });

    it('rejects when the account is currently locked', async () => {
      const lockedUntil = new Date(Date.now() + 60_000); // locked 1 min in the future
      const user = makeUser({ lockedUntil });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(service.login(user.email, SHARED_PASSWORD)).rejects.toThrow(
        /locked/i,
      );
      // Password compare must NOT have run when the lock guard triggered.
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('rejects when the account is deactivated', async () => {
      const user = makeUser({ isActive: false });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(service.login(user.email, SHARED_PASSWORD)).rejects.toThrow(/deactivated/i);
    });

    it('returns the same generic failure for an unknown email (no user enumeration)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.login('ghost@example.com', WRONG_PASSWORD),
      ).rejects.toThrow(UnauthorizedException);
      // No prisma.update calls — there was no row to touch.
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('collapses the message to "Authentication failed" in production', async () => {
      mockConfig.get.mockImplementation(((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      }) as Parameters<typeof mockConfig.get.mockImplementation>[0]);
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);

      await expect(service.login('ghost@example.com', 'pw')).rejects.toMatchObject({
        message: 'Authentication failed',
      });
    });

    it('issues a temp token (not a JWT) when TOTP is enabled on the account', async () => {
      const user = makeUser({ totpEnabled: true, totpSecret: 'SECRET' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});
      mockJwt.sign.mockReturnValueOnce('temp.totp.token');

      const result = await service.login(user.email, SHARED_PASSWORD);

      expect('requiresTotp' in result && result.requiresTotp).toBe(true);
      expect('tempToken' in result && result.tempToken).toBe('temp.totp.token');
      // Temp token must carry the totpPending + aud:totp claims.
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, totpPending: true, aud: 'totp' }),
        expect.objectContaining({ secret: TEST_JWT_SECRET, expiresIn: '5m' }),
      );
      // Audit row tagged with the partial-success stage.
      expect(mockAudit.log).toHaveBeenCalledWith(
        'AppUser', user.id, 'LOGIN', user.id, undefined,
        { stage: 'password-ok-totp-pending' },
      );
    });
  });

  // ── loginWithTotp ──────────────────────────────────────────────────────────

  describe('loginWithTotp', () => {
    const user = makeUser({ totpEnabled: true, totpSecret: 'SECRET' });

    it('issues a full JWT when temp token + code are valid', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, totpPending: true, aud: 'totp' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(true);
      mockPrisma.appUser.update.mockResolvedValue({});
      mockPrisma.appUser.findUniqueOrThrow.mockResolvedValueOnce({ tokenVersion: 3 });

      const result = await service.loginWithTotp('valid-temp', '123456');

      expect(result.jwt).toBe('mock.jwt.token');
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: expect.any(Date),
        }),
      });
    });

    it('rejects when temp token verification throws', async () => {
      mockJwt.verify.mockImplementationOnce(() => { throw new Error('expired'); });
      await expect(service.loginWithTotp('expired', '000000')).rejects.toThrow(/Token/i);
    });

    it('rejects when the temp token has the wrong audience (defence-in-depth)', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, totpPending: true, aud: 'access' });
      await expect(service.loginWithTotp('wrong-aud', '111111')).rejects.toThrow(/2FA/i);
    });

    it('rejects when totpPending is missing on the token', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, aud: 'totp' });
      await expect(service.loginWithTotp('no-claim', '111111')).rejects.toThrow();
    });

    it('rejects when the user is missing or inactive', async () => {
      mockJwt.verify.mockReturnValue({ sub: user.id, totpPending: true, aud: 'totp' });

      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.loginWithTotp('t', '1')).rejects.toThrow();

      mockPrisma.appUser.findUnique.mockResolvedValueOnce(makeUser({ isActive: false }));
      await expect(service.loginWithTotp('t', '1')).rejects.toThrow();
    });

    it('rejects when the account is locked', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, totpPending: true, aud: 'totp' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(
        makeUser({ totpEnabled: true, totpSecret: 'S', lockedUntil: new Date(Date.now() + 60_000) }),
      );
      await expect(service.loginWithTotp('t', '1')).rejects.toThrow(/locked/i);
    });

    it('rejects when TOTP is not enabled on the user record', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, totpPending: true, aud: 'totp' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(
        makeUser({ totpEnabled: false, totpSecret: null }),
      );
      await expect(service.loginWithTotp('t', '1')).rejects.toThrow(/2FA/i);
    });

    it('increments failed-attempt count on a bad TOTP code', async () => {
      mockJwt.verify.mockReturnValueOnce({ sub: user.id, totpPending: true, aud: 'totp' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(false);

      await expect(service.loginWithTotp('t', '000000')).rejects.toThrow(/TOTP/i);
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    });
  });

  // ── setupTotp / enableTotp / disableTotp / getTotpStatus ───────────────────

  describe('setupTotp', () => {
    it('generates a secret + QR and stores the pending secret', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});

      const result = await service.setupTotp(user.id);

      expect(result.secret).toBe('TOTPSECRET');
      expect(result.qrCode).toBe('data:image/png;base64,XYZ');
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { totpSecret: 'TOTPSECRET' },
      });
      // totpEnabled stays false until enableTotp.
      const call = mockPrisma.appUser.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
      expect(call.data).not.toHaveProperty('totpEnabled');
    });

    it('throws when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.setupTotp('missing')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('enableTotp', () => {
    it('enables 2FA on a valid code', async () => {
      const user = makeUser({ totpSecret: 'SECRET' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(true);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.enableTotp(user.id, '123456');

      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          totpEnabled: true,
          totpVerifiedAt: expect.any(Date),
          failedLoginAttempts: 0,
        }),
      });
    });

    it('rejects when no secret is pending', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(makeUser({ totpSecret: null }));
      await expect(service.enableTotp('user-1', '123456')).rejects.toThrow();
    });

    it('rejects + increments failed attempts on a bad code', async () => {
      const user = makeUser({ totpSecret: 'SECRET' });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(false);

      await expect(service.enableTotp(user.id, '000000')).rejects.toThrow(/TOTP/i);
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    });
  });

  describe('disableTotp', () => {
    it('throws when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.disableTotp('missing', '123')).rejects.toThrow(UnauthorizedException);
    });

    it('is idempotent when no secret at all and TOTP fields are already cleared', async () => {
      const user = makeUser({ totpSecret: null, totpEnabled: false });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(service.disableTotp(user.id, '000000')).resolves.toBeUndefined();
      // No prisma.update — nothing to clean up.
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('clears stale enabled flags when secret is null but flags say enabled', async () => {
      const user = makeUser({
        totpSecret: null,
        totpEnabled: true,
      } as Partial<DbUser> as DbUser);
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.disableTotp(user.id, '000000');
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { totpEnabled: false, totpVerifiedAt: null },
      });
    });

    it('cancels a pending setup with a valid code on the pending secret', async () => {
      const user = makeUser({ totpSecret: 'PENDING', totpEnabled: false });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(true);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.disableTotp(user.id, '123456');

      expect(mockTotp.verify).toHaveBeenCalledWith('123456', 'PENDING');
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          totpEnabled: false,
          totpSecret: null,
          totpVerifiedAt: null,
          failedLoginAttempts: 0,
        }),
      });
    });

    it('rejects a pending-setup cancel with an invalid code (proof-of-possession)', async () => {
      const user = makeUser({ totpSecret: 'PENDING', totpEnabled: false });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(false);

      await expect(service.disableTotp(user.id, '000000')).rejects.toThrow(/TOTP/i);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('disables active 2FA with a valid code', async () => {
      const user = makeUser({ totpSecret: 'SECRET', totpEnabled: true });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(true);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.disableTotp(user.id, '123456');

      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          totpEnabled: false,
          totpSecret: null,
          totpVerifiedAt: null,
        }),
      });
    });

    it('rejects + increments failed attempts on an invalid code against active 2FA', async () => {
      const user = makeUser({ totpSecret: 'SECRET', totpEnabled: true });
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockTotp.verify.mockResolvedValueOnce(false);

      await expect(service.disableTotp(user.id, '000000')).rejects.toThrow(/TOTP/i);
      expect(mockPrisma.appUser.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { failedLoginAttempts: { increment: 1 } },
      });
    });
  });

  describe('getTotpStatus', () => {
    it('returns totpEnabled for the user', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce({ totpEnabled: true });
      const result = await service.getTotpStatus('user-1');
      expect(result).toEqual({ totpEnabled: true });
    });

    it('throws when the user does not exist', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.getTotpStatus('missing')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── changePassword ─────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates the hash and bumps tokenVersion on a valid current password', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.changePassword(user.id, SHARED_PASSWORD, 'NewPassword1!');

      const call = mockPrisma.appUser.update.mock.calls[0]?.[0] as {
        data: { passwordHash: string; tokenVersion: { increment: number } };
      };
      expect(call.data.tokenVersion).toEqual({ increment: 1 });
      expect(typeof call.data.passwordHash).toBe('string');
      // The new hash must verify against the new password.
      await expect(bcrypt.compare('NewPassword1!', call.data.passwordHash)).resolves.toBe(true);
      // And NOT against the old password.
      await expect(bcrypt.compare(SHARED_PASSWORD, call.data.passwordHash)).resolves.toBe(false);
    });

    it('rejects when the current password is wrong', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(
        service.changePassword(user.id, WRONG_PASSWORD, 'NewPassword1!'),
      ).rejects.toThrow(/current password/i);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('rejects when the new password equals the current password', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);

      await expect(
        service.changePassword(user.id, SHARED_PASSWORD, SHARED_PASSWORD),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });

    it('throws when the user is missing', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.changePassword('ghost', 'a', 'b')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('writes a hashed reset token, sends the email, and stays silent on success', async () => {
      const user = makeUser();
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});
      mockMail.send.mockResolvedValue(undefined);

      const promise = service.forgotPassword(user.email);
      await expect(promise).resolves.toBeUndefined();

      // The fire-and-forget mail send happens after the update — let the
      // microtask queue drain before asserting.
      await new Promise((r) => setImmediate(r));

      const updateCall = mockPrisma.appUser.update.mock.calls[0]?.[0] as {
        data: { passwordResetToken: string; passwordResetTokenExpiry: Date };
      };
      // Token stored is a sha256 hex digest (64 chars), NOT the raw token.
      expect(updateCall.data.passwordResetToken).toMatch(/^[a-f0-9]{64}$/);
      // Expiry is ~1 hour in the future.
      const ms = updateCall.data.passwordResetTokenExpiry.getTime() - Date.now();
      expect(ms).toBeGreaterThan(55 * 60_000);
      expect(ms).toBeLessThan(65 * 60_000);

      expect(mockMail.send).toHaveBeenCalled();
      const [toEmail, subject, html] = mockMail.send.mock.calls[0] as unknown as [string, string, string];
      expect(toEmail).toBe(user.email);
      expect(subject).toMatch(/Réinitialisation/);
      // The reset link in the email carries the RAW token, not the hash.
      const linkMatch = /token=([a-f0-9]+)/.exec(html);
      expect(linkMatch).not.toBeNull();
      const rawToken = linkMatch![1];
      // sha256(rawToken) must equal the stored hash — proves we hash before storing.
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');
      expect(updateCall.data.passwordResetToken).toBe(expectedHash);
    });

    it('returns silently for an unknown email (no user enumeration)', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.forgotPassword('ghost@example.com')).resolves.toBeUndefined();
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('returns silently for an inactive user', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(makeUser({ isActive: false }));
      await expect(service.forgotPassword('alice@example.com')).resolves.toBeUndefined();
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── resetPasswordByToken ───────────────────────────────────────────────────

  describe('resetPasswordByToken', () => {
    it('hashes the token, looks up by hash, sets the new password, clears the token, bumps tokenVersion', async () => {
      const rawToken = 'a'.repeat(64);
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');
      const user = makeUser();
      mockPrisma.appUser.findFirst.mockResolvedValueOnce(user);
      mockPrisma.appUser.update.mockResolvedValue({});

      await service.resetPasswordByToken(rawToken, 'NewPassword2!');

      // Lookup query goes by the HASHED token, never raw.
      expect(mockPrisma.appUser.findFirst).toHaveBeenCalledWith({
        where: {
          passwordResetToken: expectedHash,
          passwordResetTokenExpiry: { gt: expect.any(Date) },
          isActive: true,
        },
      });

      const updateCall = mockPrisma.appUser.update.mock.calls[0]?.[0] as {
        data: {
          passwordHash: string;
          passwordResetToken: null;
          passwordResetTokenExpiry: null;
          tokenVersion: { increment: number };
        };
      };
      expect(updateCall.data.passwordResetToken).toBeNull();
      expect(updateCall.data.passwordResetTokenExpiry).toBeNull();
      expect(updateCall.data.tokenVersion).toEqual({ increment: 1 });
      await expect(bcrypt.compare('NewPassword2!', updateCall.data.passwordHash)).resolves.toBe(true);
    });

    it('rejects an invalid / expired token (lookup returned null)', async () => {
      mockPrisma.appUser.findFirst.mockResolvedValueOnce(null);
      await expect(service.resetPasswordByToken('bad', 'pw')).rejects.toThrow(/invalide|expir/i);
      expect(mockPrisma.appUser.update).not.toHaveBeenCalled();
    });
  });

  // ── getMe ──────────────────────────────────────────────────────────────────

  describe('getMe', () => {
    it('returns user + empty permissions/roles for an existing user', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce({
        id: 'user-1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Smith', role: 'Member',
      });

      const result = await service.getMe('user-1');

      expect(result.user.id).toBe('user-1');
      expect(result.permissions).toEqual({ global: [], perProject: {} });
      expect(result.roles).toEqual([]);
    });

    it('throws when the user is missing', async () => {
      mockPrisma.appUser.findUnique.mockResolvedValueOnce(null);
      await expect(service.getMe('ghost')).rejects.toThrow(UnauthorizedException);
    });
  });
});
