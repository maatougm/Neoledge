import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { TotpService } from './totp.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { forgotPasswordEmail } from '../mail/mail.templates.js';
import { getJwtSecret } from './jwt-secret.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const TEMP_TOKEN_EXPIRES_IN = '5m';
const BCRYPT_ROUNDS = 12;

// Precomputed bcrypt hash of a value no real user will ever supply. We run
// `bcrypt.compare` against it when the email is unknown so the login endpoint
// takes the same wall-clock time whether or not the user exists — closes a
// user-enumeration timing side-channel.
const DUMMY_BCRYPT_HASH =
  '$2a$12$CwTycUXWue0Thq9StjUM0uJ8oNO.KsVqxjB5lK5OoT0uU4cEO4SGu';

type LoginResult =
  | { jwt: string; requiresTotp?: never }
  | { requiresTotp: true; tempToken: string; jwt?: never };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly totpService: TotpService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const dbUser = await this.prisma.appUser.findUnique({
      where: { email },
    });

    if (dbUser) {
      return this.authenticateDbUser(dbUser, password);
    }

    // Equalise response time for unknown emails with the
    // bcrypt.compare executed on the happy path. Without this, an attacker can
    // enumerate valid accounts by measuring the faster failure timing.
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);

    throw new UnauthorizedException(this.authFailureMessage('Invalid email or password'));
  }

  async loginWithTotp(
    tempToken: string,
    code: string,
  ): Promise<{ jwt: string }> {
    let payload: { sub: string; totpPending: boolean; aud?: string };

    try {
      payload = this.jwtService.verify<{
        sub: string;
        totpPending: boolean;
        aud?: string;
      }>(tempToken, { secret: getJwtSecret(this.configService) });
    } catch {
      throw new UnauthorizedException(this.authFailureMessage('Token expiré ou invalide.'));
    }

    // Temp token must carry our `aud: 'totp'` claim AND `totpPending: true`.
    // Reject access-audience tokens and legacy tokens missing the claim —
    // this is a defence-in-depth check on top of `JwtStrategy`.
    if (payload.aud !== 'totp' || !payload.totpPending) {
      throw new UnauthorizedException(this.authFailureMessage('Token non valide pour la 2FA.'));
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException(this.authFailureMessage('Utilisateur introuvable ou inactif.'));
    }

    // TOTP path must honour the same lockout window as the password path —
    // otherwise an attacker who captured a temp token could brute-force the
    // 6-digit code without rate limiting.
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(this.authFailureMessage('Account is locked. Please try again later.'));
    }

    if (!user.totpSecret || !user.totpEnabled) {
      throw new UnauthorizedException(this.authFailureMessage('La 2FA n\'est pas activée pour ce compte.'));
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);

    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
        },
      });
      throw new UnauthorizedException(this.authFailureMessage('Code TOTP invalide.'));
    }

    await this.prisma.appUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const jwt = await this.generateTokenForUser({
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    return { jwt };
  }

  async setupTotp(userId: string): Promise<{ secret: string; qrCode: string }> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    const { secret, otpauthUrl } = this.totpService.generateSecret(user.email);
    const qrCode = await this.totpService.generateQrCode(otpauthUrl);

    // Store pending secret (totpEnabled remains false until confirmed)
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { totpSecret: secret },
    });

    return { secret, qrCode };
  }

  async enableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });

    if (!user || !user.totpSecret) {
      throw new UnauthorizedException(this.authFailureMessage('Aucun secret 2FA en attente. Veuillez d\'abord lancer la configuration.'));
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);

    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException(this.authFailureMessage('Code TOTP invalide.'));
    }

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        totpVerifiedAt: new Date(),
        failedLoginAttempts: 0,
      },
    });
  }

  async disableTotp(userId: string, code: string): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException(this.authFailureMessage('Utilisateur introuvable.'));
    }

    // No secret at all → already disabled. Return idempotently so the UI
    // doesn't get stuck when the client state is ahead of the server state.
    if (!user.totpSecret) {
      if (user.totpEnabled || user.totpVerifiedAt) {
        await this.prisma.appUser.update({
          where: { id: userId },
          data: { totpEnabled: false, totpVerifiedAt: null },
        });
      }
      return;
    }

    // If 2FA setup started but never enabled (totpEnabled=false, secret present),
    // we still let the user clear the orphan secret WITHOUT a code — it's a
    // stuck state, not an active protection.
    if (!user.totpEnabled) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: {
          totpEnabled: false,
          totpSecret: null,
          totpVerifiedAt: null,
          failedLoginAttempts: 0,
        },
      });
      return;
    }

    // Actively-enabled 2FA → require a valid current code
    const isValid = await this.totpService.verify(code, user.totpSecret);
    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException(this.authFailureMessage('Code TOTP invalide.'));
    }

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        totpEnabled: false,
        totpSecret: null,
        totpVerifiedAt: null,
        failedLoginAttempts: 0,
      },
    });
  }

  async getTotpStatus(userId: string): Promise<{ totpEnabled: boolean }> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { totpEnabled: true },
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    return { totpEnabled: user.totpEnabled };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(this.authFailureMessage('User not found'));
    }

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException(this.authFailureMessage('Current password is incorrect'));
    }

    // Reject re-using the current password as the new one. Runs BEFORE the
    // expensive bcrypt.genSalt/hash path so the cheap check fails fast.
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from current password');
    }

    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const newHash = await bcrypt.hash(newPassword, salt);

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        tokenVersion: { increment: 1 },
      },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { email } });

    // Always return success to avoid leaking whether the email exists.
    if (!user || !user.isActive) return;

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.appUser.update({
      where: { id: user.id },
      data: { passwordResetToken: tokenHash, passwordResetTokenExpiry: expiry },
    });

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    void this.mail
      .send(user.email, 'Réinitialisation de votre mot de passe NeoLeadge', forgotPasswordEmail(user.firstName, resetUrl))
      .catch((e) => this.logger.error('forgotPassword email failed', e));
  }

  async resetPasswordByToken(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const user = await this.prisma.appUser.findFirst({
      where: {
        passwordResetToken: tokenHash,
        passwordResetTokenExpiry: { gt: new Date() },
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(this.authFailureMessage('Lien de réinitialisation invalide ou expiré.'));
    }

    const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const newHash = await bcrypt.hash(newPassword, salt);

    await this.prisma.appUser.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordResetToken: null,
        passwordResetTokenExpiry: null,
        tokenVersion: { increment: 1 },
      },
    });
  }

  private async authenticateDbUser(
    user: {
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
    },
    password: string,
  ): Promise<LoginResult> {
    if (!user.isActive) {
      throw new UnauthorizedException(this.authFailureMessage('Account is deactivated'));
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        this.authFailureMessage('Account is locked. Please try again later.'),
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      const updatedAttempts = user.failedLoginAttempts + 1;

      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = {
        failedLoginAttempts: updatedAttempts,
      };

      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date();
        lockUntil.setMinutes(lockUntil.getMinutes() + LOCK_DURATION_MINUTES);
        updateData.lockedUntil = lockUntil;

        this.logger.warn(
          `Account locked for ${user.email} after ${MAX_FAILED_ATTEMPTS} failed attempts`,
        );
      }

      await this.prisma.appUser.update({
        where: { id: user.id },
        data: updateData,
      });

      throw new UnauthorizedException(this.authFailureMessage('Invalid email or password'));
    }

    // If TOTP is enabled, issue a short-lived temp token instead of the full JWT.
    // Reset the failed-login counter at this point — the password has already
    // been validated — so a subsequent wrong TOTP code cannot compound with
    // prior password mistakes and prematurely lock the account. Audit-log the
    // partial success so security forensics can see "password OK / TOTP pending".
    if (user.totpEnabled) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      const tempToken = this.jwtService.sign(
        { sub: user.id, totpPending: true, aud: 'totp' },
        {
          secret: getJwtSecret(this.configService),
          expiresIn: TEMP_TOKEN_EXPIRES_IN,
        },
      );

      void this.audit.log('AppUser', user.id, 'LOGIN', user.id, undefined, {
        stage: 'password-ok-totp-pending',
      }).catch((e) => this.logger.error('audit login totp-pending failed', e));

      return { requiresTotp: true, tempToken };
    }

    // Reset failed attempts on successful login
    await this.prisma.appUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const jwt = await this.generateTokenForUser({
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    void this.audit.log('AppUser', user.id, 'LOGIN', user.id)
      .catch((e) => this.logger.error('audit login failed', e));
    return { jwt };
  }

  async getMe(userId: string): Promise<{
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
    };
    permissions: { global: string[]; perProject: Record<string, string[]> };
    roles: { id: string; name: string; projectId: string | null }[];
  }> {
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const [assignments, permissionsSet] = await Promise.all([
      this.prisma.userRoleAssignment.findMany({
        where: { userId },
        select: {
          projectId: true,
          role: { select: { id: true, name: true } },
        },
      }),
      this.loadUserPermissions(userId),
    ]);

    return {
      user,
      permissions: permissionsSet,
      roles: assignments.map((a) => ({
        id: a.role.id,
        name: a.role.name,
        projectId: a.projectId,
      })),
    };
  }

  private async loadUserPermissions(
    userId: string,
  ): Promise<{ global: string[]; perProject: Record<string, string[]> }> {
    const rows = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      select: {
        projectId: true,
        role: {
          select: {
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    const global = new Set<string>();
    const perProject = new Map<string, Set<string>>();
    for (const a of rows) {
      const keys = a.role.permissions.map((rp) => rp.permission.key);
      if (a.projectId === null) {
        keys.forEach((k) => global.add(k));
      } else {
        let bucket = perProject.get(a.projectId);
        if (!bucket) {
          bucket = new Set<string>();
          perProject.set(a.projectId, bucket);
        }
        keys.forEach((k) => bucket!.add(k));
      }
    }
    const perProjectObj: Record<string, string[]> = {};
    for (const [pid, set] of perProject.entries()) {
      perProjectObj[pid] = Array.from(set);
    }
    return { global: Array.from(global), perProject: perProjectObj };
  }

  private async generateTokenForUser(user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  }): Promise<string> {
    const { tokenVersion } = await this.prisma.appUser.findUniqueOrThrow({
      where: { id: user.id },
      select: { tokenVersion: true },
    });
    return this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      tokenVersion,
      aud: 'access',
    });
  }

  /**
   * Collapse role-revealing login failure messages down to a generic string
   * in production so an attacker can't distinguish "user not found" from
   * "password wrong" from "account locked". Keeps the verbose message in dev
   * so local debugging stays productive.
   */
  private authFailureMessage(verbose: string): string {
    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    return isProduction ? 'Authentication failed' : verbose;
  }

}
