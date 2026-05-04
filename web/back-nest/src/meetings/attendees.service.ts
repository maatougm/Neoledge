import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class AttendeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meetingId: string) {
    try {
      const items = await this.prisma.meetingAttendee.findMany({
        where: { meetingId },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return Result.ok(items);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async add(meetingId: string, dto: { userId?: string; externalName?: string; externalEmail?: string; role?: string; isPresent?: boolean }) {
    try {
      const item = await this.prisma.meetingAttendee.create({
        data: {
          meetingId,
          userId: dto.userId ?? null,
          externalName: dto.externalName ?? null,
          externalEmail: dto.externalEmail ?? null,
          role: dto.role ?? null,
          isPresent: dto.isPresent ?? false,
        },
      });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async update(id: string, dto: { isPresent?: boolean; role?: string | null }) {
    try {
      const item = await this.prisma.meetingAttendee.update({ where: { id }, data: dto });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.meetingAttendee.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async bulkMarkPresent(meetingId: string, ids: string[], isPresent: boolean) {
    try {
      await this.prisma.meetingAttendee.updateMany({
        where: { meetingId, id: { in: ids } },
        data: { isPresent },
      });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }
}
