import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meetingId: string) {
    try {
      const items = await this.prisma.meetingAgendaItem.findMany({
        where: { meetingId },
        include: { responsible: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { position: 'asc' },
      });
      return Result.ok(items);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async create(meetingId: string, dto: { title: string; duration?: number; responsibleId?: string; notes?: string }) {
    try {
      const max = await this.prisma.meetingAgendaItem.aggregate({ where: { meetingId }, _max: { position: true } });
      const item = await this.prisma.meetingAgendaItem.create({
        data: {
          meetingId,
          title: dto.title,
          duration: dto.duration ?? null,
          responsibleId: dto.responsibleId ?? null,
          notes: dto.notes ?? null,
          position: (max._max.position ?? -1) + 1,
        },
      });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec de la création.');
    }
  }

  async update(id: string, dto: { title?: string; duration?: number | null; responsibleId?: string | null; notes?: string; position?: number }) {
    try {
      const item = await this.prisma.meetingAgendaItem.update({ where: { id }, data: dto });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.meetingAgendaItem.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async reorder(meetingId: string, order: string[]) {
    try {
      // Validate all ids belong to this meeting before mutating.
      const existing = await this.prisma.meetingAgendaItem.findMany({
        where: { id: { in: order }, meetingId },
        select: { id: true },
      });
      const validIds = new Set(existing.map((e) => e.id));
      const foreign = order.filter((id) => !validIds.has(id));
      if (foreign.length > 0) {
        return Result.fail<void>('Certains éléments n\'appartiennent pas à cette réunion.');
      }

      // Atomic batch update — positions are only committed if all succeed.
      await this.prisma.$transaction(
        order.map((id, idx) =>
          this.prisma.meetingAgendaItem.update({ where: { id, meetingId }, data: { position: idx } })
        )
      );
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }
}
