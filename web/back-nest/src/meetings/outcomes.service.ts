import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class OutcomesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meetingId: string, type?: string) {
    try {
      const where: Record<string, unknown> = { meetingId };
      if (type) where.type = type;
      const items = await this.prisma.meetingOutcome.findMany({
        where,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          workPackage: { select: { id: true, title: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return Result.ok(items);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async create(meetingId: string, dto: { type: string; description: string; ownerId?: string; dueDate?: string }) {
    try {
      const item = await this.prisma.meetingOutcome.create({
        data: {
          meetingId,
          type: dto.type,
          description: dto.description,
          ownerId: dto.ownerId ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async update(id: string, dto: { type?: string; description?: string; ownerId?: string | null; dueDate?: string | null }) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.type !== undefined) data.type = dto.type;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
      if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      const item = await this.prisma.meetingOutcome.update({ where: { id }, data });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.meetingOutcome.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async convertToWorkPackage(outcomeId: string, projectId: string, authorId: string) {
    try {
      const outcome = await this.prisma.meetingOutcome.findUnique({ where: { id: outcomeId } });
      if (!outcome) return Result.fail('Issue introuvable.');

      const wp = await this.prisma.workPackage.create({
        data: {
          projectId,
          title: outcome.description.slice(0, 255),
          description: outcome.description,
          type: outcome.type === 'Risk' ? 'Bug' : 'Task',
          status: 'New',
          priority: outcome.type === 'Risk' ? 'High' : 'Normal',
          authorId,
          assigneeId: outcome.ownerId,
          dueDate: outcome.dueDate,
        },
      });

      await this.prisma.meetingOutcome.update({
        where: { id: outcomeId },
        data: { workPackageId: wp.id },
      });

      return Result.ok(wp);
    } catch {
      return Result.fail('Échec de la conversion.');
    }
  }
}
