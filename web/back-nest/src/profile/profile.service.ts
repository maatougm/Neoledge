import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
const ALLOWED_AVATAR_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function sniffImageMime(buffer: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  // WebP: "RIFF"...."WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}
const DEFAULT_PREFERENCES = {
  emailNotificationsEnabled: true,
  darkMode: false,
  language: 'fr',
  timeZone: 'Europe/Paris',
  customSettings: null,
};

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail<any>('Utilisateur non trouvé.');
    return Result.ok({
      id: user.id, firstName: user.firstName, lastName: user.lastName,
      email: user.email, role: user.role, avatarPath: user.avatarPath,
      jobTitle: user.jobTitle, phoneNumber: user.phoneNumber, department: user.department,
      createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
    });
  }

  async updateProfile(
    userId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      phoneNumber?: string;
      department?: string;
    },
  ) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail<any>('Utilisateur non trouvé.');

    const updated = await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.jobTitle !== undefined && { jobTitle: dto.jobTitle }),
        ...(dto.phoneNumber !== undefined && { phoneNumber: dto.phoneNumber }),
        ...(dto.department !== undefined && { department: dto.department }),
      },
    });

    return Result.ok({
      id: updated.id, firstName: updated.firstName, lastName: updated.lastName,
      email: updated.email, role: updated.role, avatarPath: updated.avatarPath,
      jobTitle: updated.jobTitle, phoneNumber: updated.phoneNumber, department: updated.department,
      createdAt: updated.createdAt, lastLoginAt: updated.lastLoginAt,
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return Result.fail('Mot de passe actuel incorrect.');

    // Complexity: min 8 chars, at least one uppercase, one digit, one special character.
    const complexityRe = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!complexityRe.test(newPassword)) {
      return Result.fail(
        'Le mot de passe doit contenir au moins 8 caractères, une majuscule, un chiffre et un caractère spécial.',
      );
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        tokenVersion: { increment: 1 },
      },
    });

    return Result.ok();
  }

  async uploadAvatar(userId: string, base64Image: string, fileExtension: string) {
    const buffer = Buffer.from(base64Image, 'base64');
    if (buffer.length > 2 * 1024 * 1024) return Result.fail<string>('Image trop volumineuse (max 2 Mo).');

    // Normalise & allow-list extension — user input must never flow raw into path.join.
    const rawExt = typeof fileExtension === 'string' ? fileExtension.toLowerCase() : '';
    const ext = rawExt.startsWith('.') ? rawExt : `.${rawExt}`;
    if (!ALLOWED_AVATAR_EXT.has(ext)) {
      return Result.fail<string>('Extension non autorisée (jpg, jpeg, png, webp uniquement).');
    }

    // Magic-bytes sniff to prevent MIME spoofing.
    const sniffed = sniffImageMime(buffer.subarray(0, 12));
    if (!sniffed) {
      return Result.fail<string>('Fichier image invalide.');
    }
    const extMatchesSniff =
      (sniffed === 'png' && ext === '.png') ||
      (sniffed === 'jpeg' && (ext === '.jpg' || ext === '.jpeg')) ||
      (sniffed === 'webp' && ext === '.webp');
    if (!extMatchesSniff) {
      return Result.fail<string>('Le contenu du fichier ne correspond pas à son extension.');
    }

    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const fileName = `${userId}-${randomUUID()}${ext}`;
    const filePath = path.join(AVATAR_DIR, fileName);

    // Path-traversal containment: reject anything that resolves outside AVATAR_DIR.
    const resolved = path.resolve(filePath);
    const avatarRoot = path.resolve(AVATAR_DIR);
    if (!resolved.startsWith(avatarRoot + path.sep) && resolved !== avatarRoot) {
      return Result.fail<string>('Invalid path');
    }

    fs.writeFileSync(filePath, buffer);

    const avatarPath = `/uploads/avatars/${fileName}`;
    await this.prisma.appUser.update({ where: { id: userId }, data: { avatarPath } });
    return Result.ok(avatarPath);
  }

  async getAvatarPath(userId: string) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { avatarPath: true } });
    if (!user || !user.avatarPath) return Result.fail<string>('Avatar non trouvé.');
    const filePath = path.join(process.cwd(), user.avatarPath);
    if (!fs.existsSync(filePath)) return Result.fail<string>('Fichier avatar introuvable.');
    return Result.ok(user.avatarPath);
  }

  async getPreferences(userId: string) {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId }, select: { preferences: true } });
    if (!user) return Result.fail<any>('Utilisateur non trouvé.');
    if (!user.preferences) return Result.ok({ ...DEFAULT_PREFERENCES });
    try {
      return Result.ok(JSON.parse(user.preferences));
    } catch {
      // Corrupted preferences blob — fall back to defaults rather than crashing the endpoint.
      return Result.ok({ ...DEFAULT_PREFERENCES });
    }
  }

  async updatePreferences(userId: string, prefs: Record<string, unknown>) {
    // Merge with existing preferences rather than replacing — ValidationPipe may
    // strip unknown keys, but existing persisted preferences must not be lost.
    const user = await this.prisma.appUser.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) return Result.fail('Utilisateur non trouvé.');

    const current: Record<string, unknown> = user.preferences
      ? (JSON.parse(user.preferences) as Record<string, unknown>)
      : {};
    const merged = { ...current, ...prefs };

    await this.prisma.appUser.update({
      where: { id: userId },
      data: { preferences: JSON.stringify(merged) },
    });
    return Result.ok();
  }
}
