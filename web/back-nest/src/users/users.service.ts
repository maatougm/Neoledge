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
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly skip: number;
  readonly take: number;
}

const BCRYPT_ROUNDS = 12;
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
  ): Promise<Result<{ success: true }>> {
    const user = await this.prisma.appUser.findUnique({ where: { id } });

    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    await this.prisma.appUser.update({
      where: { id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });

    // Fire-and-forget: send email with temp password — never throws.
    // The temp password must only leave the server via email (or a dev log),
    // never in the HTTP response body.
    void this.mail
      .send(
        user.email,
        'Réinitialisation de votre mot de passe NeoLeadge',
        passwordResetEmail(tempPassword),
      )
      .catch(() => undefined);

    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        `[dev] Reset password for ${user.email}: tempPassword=${tempPassword}`,
      );
    }

    return Result.ok({ success: true });
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
      data: {
        isActive: false,
        tokenVersion: { increment: 1 },
      },
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

  /**
   * Hard delete an account. Most history relations on AppUser are
   * `onDelete: NoAction` so the DB will refuse the delete if the user
   * has authored projects/WPs, logged time, posted comments, or uploaded
   * attachments. We count the blocking references up front and return a
   * descriptive error instead of letting Prisma throw a P2003.
   *
   * The relations configured with Cascade / SetNull (notifications,
   * watchers, project memberships, role assignments, cahier feedback,
   * meeting attendance, …) are cleaned up automatically by the DB.
   */
  async delete(id: string, requestingUserId: string): Promise<Result> {
    if (id === requestingUserId) {
      return Result.fail('Vous ne pouvez pas supprimer votre propre compte.');
    }

    const user = await this.prisma.appUser.findUnique({ where: { id } });
    if (!user) {
      return Result.fail('Utilisateur non trouvé.');
    }

    // Count history rows that would block the delete (FK = NoAction).
    const [
      managedProjects,
      createdProjects,
      authoredWps,
      timeEntries,
      projectComments,
      wpComments,
      projectAttachments,
      wpAttachments,
    ] = await Promise.all([
      this.prisma.project.count({ where: { projectManagerId: id } }),
      this.prisma.project.count({ where: { createdByAdminId: id } }),
      this.prisma.workPackage.count({ where: { authorId: id } }),
      this.prisma.timeEntry.count({ where: { userId: id } }),
      this.prisma.projectComment.count({ where: { userId: id } }),
      this.prisma.workPackageComment.count({ where: { userId: id } }),
      this.prisma.projectAttachment.count({ where: { uploadedByUserId: id } }),
      this.prisma.workPackageAttachment.count({
        where: { uploadedByUserId: id },
      }),
    ]);

    const blockers: string[] = [];
    if (managedProjects > 0) blockers.push(`${managedProjects} projet(s) géré(s)`);
    if (createdProjects > 0) blockers.push(`${createdProjects} projet(s) créé(s)`);
    if (authoredWps > 0) blockers.push(`${authoredWps} tâche(s) créée(s)`);
    if (timeEntries > 0) blockers.push(`${timeEntries} entrée(s) de temps`);
    if (projectComments + wpComments > 0) {
      blockers.push(`${projectComments + wpComments} commentaire(s)`);
    }
    if (projectAttachments + wpAttachments > 0) {
      blockers.push(`${projectAttachments + wpAttachments} pièce(s) jointe(s)`);
    }

    if (blockers.length > 0) {
      return Result.fail(
        `Suppression impossible — l'utilisateur a ${blockers.join(', ')}. Désactivez-le plutôt pour préserver l'historique.`,
      );
    }

    try {
      await this.prisma.appUser.delete({ where: { id } });
    } catch (e) {
      // Defence-in-depth: if a relation we did not count above still
      // holds the row, surface a clean error instead of a 500.
      const msg = e instanceof Error ? e.message : String(e);
      return Result.fail(
        `Suppression refusée par la base : ${msg}. Désactivez l'utilisateur à la place.`,
      );
    }

    return Result.ok();
  }
}
