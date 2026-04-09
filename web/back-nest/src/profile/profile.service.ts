import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

const AVATAR_DIR = path.join(process.cwd(), 'uploads', 'avatars');
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

  async updateProfile(userId: string, dto: any) {
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

    if (!user.mustChangePassword) {
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) return Result.fail('Mot de passe actuel incorrect.');
    }

    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return Result.fail('Le mot de passe doit contenir au moins 8 caractères, une majuscule et un chiffre.');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: false },
    });

    return Result.ok();
  }

  async uploadAvatar(userId: string, base64Image: string, fileExtension: string) {
    const buffer = Buffer.from(base64Image, 'base64');
    if (buffer.length > 2 * 1024 * 1024) return Result.fail<string>('Image trop volumineuse (max 2 Mo).');

    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const fileName = `${userId}${fileExtension}`;
    const filePath = path.join(AVATAR_DIR, fileName);
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
    return Result.ok(user.preferences ? JSON.parse(user.preferences) : { ...DEFAULT_PREFERENCES });
  }

  async updatePreferences(userId: string, prefs: any) {
    await this.prisma.appUser.update({
      where: { id: userId },
      data: { preferences: JSON.stringify(prefs) },
    });
    return Result.ok();
  }
}
