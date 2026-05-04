import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class OutcomesService {
  private readonly logger = new Logger(OutcomesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

  async convertToWorkPackage(outcomeId: string, _urlProjectId: string, authorId: string) {
    try {
      // Load outcome with its parent meeting to get the authoritative projectId server-side.
      const outcome = await this.prisma.meetingOutcome.findUnique({
        where: { id: outcomeId },
        include: { meeting: { select: { projectId: true } } },
      });
      if (!outcome) return Result.fail('Issue introuvable.');

      // Guard: reject if already converted.
      if (outcome.workPackageId) return Result.fail('Outcome déjà converti en tâche.');

      // Use the meeting's projectId — never trust the URL param.
      const projectId = outcome.meeting.projectId;

      const wp = await this.prisma.workPackage.create({
        data: {
          projectId,
          title: outcome.description.slice(0, 255),
          description: outcome.description.slice(0, 10_000),
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

      // Notify the assignee (if set and not the converter themselves) — mirrors
      // the WorkPackagesService.create() path so meeting-converted tasks also
      // surface in the assignee's inbox immediately.
      if (wp.assigneeId && wp.assigneeId !== authorId) {
        void this.notifications
          .notifyEnhanced({
            userId: wp.assigneeId,
            type: 'work_package_assigned',
            title: 'Nouvelle tâche assignée',
            message: `"${wp.title}" vous a été assigné`,
            projectId,
            reason: 'Assignee',
            entityType: 'work_package',
            entityId: wp.id,
            actorId: authorId,
            link: `/app/pm/projects/${projectId}/workpackages`,
          })
          .catch((e) => this.logger.error('notifyEnhanced (outcome → WP) failed', e));
      }

      return Result.ok(wp);
    } catch (err: unknown) {
      return Result.fail('Échec de la conversion.');
    }
  }
}
