import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { passwordResetEmail } from '../mail/mail.templates.js';
import { Result } from '../common/result.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

export interface UserResponseDto {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly skip: number;
  readonly take: number;
}

const BCRYPT_ROUNDS = 10;
const TEMP_PASSWORD_LENGTH = 12;
const TEMP_PASSWORD_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*';

function toUserResponse(user: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}): UserResponseDto {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

function generateTempPassword(): string {
  const bytes = crypto.randomBytes(TEMP_PASSWORD_LENGTH);
  return Array.from(bytes)
    .map((b) => TEMP_PASSWORD_CHARS[b % TEMP_PASSWORD_CHARS.length])
    .join('');
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async getAll(
    skip: number,
    take: number,
    search?: string,
    role?: string,
  ): Promise<Result<PaginatedResult<UserResponseDto>>> {
    const where: Record<string, unknown> = {};

    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    }

    if (role) {
      where.role = role;
    }

    const [users, total] = await Promise.all([
      this.prisma.appUser.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.appUser.count({ where }),
    ]);

    return Result.ok<PaginatedResult<UserResponseDto>>({
      items: users.map(toUserResponse),
      total,
      skip,
      take,
    });
  }

  async getById(id: string): Promise<Result<UserResponseDto>> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    return Result.ok(toUserResponse(user));
  }

  async getByRole(role: string): Promise<Result<UserResponseDto[]>> {
    const users = await this.prisma.appUser.findMany({
      where: { role, isActive: true },
      orderBy: { lastName: 'asc' },
    });

    return Result.ok(users.map(toUserResponse));
  }

  async create(dto: CreateUserDto): Promise<Result<UserResponseDto>> {
    const existingUser = await this.prisma.appUser.findFirst({
      where: { email: { equals: dto.email } },
    });

    if (existingUser) {
      return Result.fail('Un utilisateur avec cet email existe déjà.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.appUser.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        passwordHash,
        role: dto.role,
      },
    });

    return Result.ok(toUserResponse(user));
  }

  async update(
    id: string,
    dto: UpdateUserDto,
  ): Promise<Result<UserResponseDto>> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    if (dto.email && dto.email.toLowerCase() !== user.email.toLowerCase()) {
      const existingUser = await this.prisma.appUser.findFirst({
        where: {
          email: { equals: dto.email },
          id: { not: id },
        },
      });

      if (existingUser) {
        return Result.fail('Un utilisateur avec cet email existe déjà.');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;

    const updated = await this.prisma.appUser.update({
      where: { id },
      data,
    });

    return Result.ok(toUserResponse(updated));
  }

  async resetPassword(
    id: string,
  ): Promise<Result<{ tempPassword: string }>> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    await this.prisma.appUser.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });

    // Fire-and-forget: send email with temp password — never throws
    void this.mail
      .send(
        user.email,
        'Réinitialisation de votre mot de passe NeoLeadge',
        passwordResetEmail(tempPassword),
      )
      .catch(() => undefined);

    return Result.ok({ tempPassword });
  }

  async deactivate(
    id: string,
    requestingUserId: string,
  ): Promise<Result> {
    if (id === requestingUserId) {
      return Result.fail('Vous ne pouvez pas désactiver votre propre compte.');
    }

    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    await this.prisma.appUser.update({
      where: { id },
      data: { isActive: false },
    });

    return Result.ok();
  }

  async reactivate(id: string): Promise<Result> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    await this.prisma.appUser.update({
      where: { id },
      data: { isActive: true },
    });

    return Result.ok();
  }
}
