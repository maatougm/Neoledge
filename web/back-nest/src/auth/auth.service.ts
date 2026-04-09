import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { TotpService } from './totp.service.js';
import { AuditService } from '../audit/audit.service.js';

interface TestUser {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
  mustChangePassword: boolean;
}

const TEST_USERS: readonly TestUser[] = [
  {
    id: 'test-admin-001',
    email: 'admin@neoleadge.com',
    password: 'Admin@123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'Admin',
    mustChangePassword: false,
  },
  {
    id: 'test-pm-001',
    email: 'pm@neoleadge.com',
    password: 'Pm@123',
    firstName: 'Project',
    lastName: 'Manager',
    role: 'ProjectManager',
    mustChangePassword: false,
  },
  {
    id: 'test-pm-002',
    email: 'pm2@neoleadge.com',
    password: 'Pm2@123',
    firstName: 'Project',
    lastName: 'Manager2',
    role: 'ProjectManager',
    mustChangePassword: false,
  },
  {
    id: 'test-deploy-001',
    email: 'valid@neoleadge.com',
    password: 'Valid@123',
    firstName: 'Deploy',
    lastName: 'Team',
    role: 'DeploymentTeam',
    mustChangePassword: false,
  },
  {
    id: 'test-viewer-001',
    email: 'newuser@neoleadge.com',
    password: 'Temp@123',
    firstName: 'New',
    lastName: 'User',
    role: 'Viewer',
    mustChangePassword: true,
  },
] as const;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const TEMP_TOKEN_EXPIRES_IN = '5m';

type LoginResult =
  | { jwt: string; mustChangePassword: boolean; requiresTotp?: never }
  | { requiresTotp: true; tempToken: string; jwt?: never; mustChangePassword?: never };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly totpService: TotpService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const dbUser = await this.prisma.appUser.findUnique({
      where: { email },
    });

    if (dbUser) {
      return this.authenticateDbUser(dbUser, password);
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    if (!isProduction) {
      const testUser = TEST_USERS.find((u) => u.email === email);

      if (testUser && testUser.password === password) {
        this.logger.warn(`Dev login for test user: ${email}`);

        const jwt = this.generateToken({
          sub: testUser.id,
          email: testUser.email,
          role: testUser.role,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
        });

        return { jwt, mustChangePassword: testUser.mustChangePassword };
      }
    }

    throw new UnauthorizedException('Invalid email or password');
  }

  async loginWithTotp(
    tempToken: string,
    code: string,
  ): Promise<{ jwt: string; mustChangePassword: boolean }> {
    let payload: { sub: string; totpPending: boolean };

    try {
      payload = this.jwtService.verify<{ sub: string; totpPending: boolean }>(
        tempToken,
        { secret: this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me') },
      );
    } catch {
      throw new UnauthorizedException('Token expiré ou invalide.');
    }

    if (!payload.totpPending) {
      throw new UnauthorizedException('Token non valide pour la 2FA.');
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur introuvable ou inactif.');
    }

    if (!user.totpSecret || !user.totpEnabled) {
      throw new UnauthorizedException('La 2FA n\'est pas activée pour ce compte.');
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);

    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
        },
      });
      throw new UnauthorizedException('Code TOTP invalide.');
    }

    await this.prisma.appUser.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const jwt = this.generateToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    return { jwt, mustChangePassword: user.mustChangePassword };
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
      throw new UnauthorizedException('Aucun secret 2FA en attente. Veuillez d\'abord lancer la configuration.');
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);

    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code TOTP invalide.');
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

    if (!user || !user.totpSecret || !user.totpEnabled) {
      throw new UnauthorizedException('La 2FA n\'est pas activée pour ce compte.');
    }

    const isValid = await this.totpService.verify(code, user.totpSecret);

    if (!isValid) {
      await this.prisma.appUser.update({
        where: { id: userId },
        data: { failedLoginAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Code TOTP invalide.');
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
      throw new UnauthorizedException('User not found');
    }

    const isCurrentValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );

    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
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
      mustChangePassword: boolean;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
      totpEnabled: boolean;
      totpSecret: string | null;
    },
    password: string,
  ): Promise<LoginResult> {
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(
        'Account is locked. Please try again later.',
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

      throw new UnauthorizedException('Invalid email or password');
    }

    // If TOTP is enabled, issue a short-lived temp token instead of the full JWT
    if (user.totpEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, totpPending: true },
        {
          secret: this.configService.get<string>('JWT_SECRET', 'dev-secret-change-me'),
          expiresIn: TEMP_TOKEN_EXPIRES_IN,
        },
      );
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

    const jwt = this.generateToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    void this.audit.log('AppUser', user.id, 'LOGIN', user.id);
    return { jwt, mustChangePassword: user.mustChangePassword };
  }

  private generateToken(payload: {
    sub: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  }): string {
    return this.jwtService.sign(payload);
  }
}
