import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { AutomationService } from '../automation/automation.service.js';
import { CollaborationGateway } from '../collaboration/collaboration.gateway.js';

const DEFAULT_COLUMNS = [
  { name: 'New', mapStatus: 'New', position: 0 },
  { name: 'In Progress', mapStatus: 'InProgress', position: 1 },
  { name: 'Resolved', mapStatus: 'Resolved', position: 2 },
  { name: 'Closed', mapStatus: 'Closed', position: 3 },
];

@Injectable()
export class AgileService {
  private readonly logger = new Logger(AgileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly automation: AutomationService,
    private readonly collab: CollaborationGateway,
  ) {}

  private async triggerAutomation(boardId: string, event: string, context: Record<string, unknown>): Promise<void> {
    try {
      const board = await this.prisma.board.findUnique({ where: { id: boardId }, select: { projectId: true } });
      if (board) void this.automation.executeRulesForEvent(board.projectId, event, context);
    } catch {
      // Never break the caller.
    }
  }

  async listBoards(projectId: string) {
    try {
      const boards = await this.prisma.board.findMany({
        where: { projectId },
        include: { _count: { select: { columns: true, sprints: true } } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      if (boards.length === 0) {
        const r = await this.createBoard(projectId, { name: 'Default Board', type: 'Kanban', isDefault: true });
        if (r.isSuccess && r.value) {
          return this.listBoards(projectId);
        }
      }
      return Result.ok(boards);
    } catch (e) {
      this.logger.error('listBoards failed', e);
      return Result.fail('Échec du chargement des boards.');
    }
  }

  async getBoard(boardId: string) {
    try {
      const board = await this.prisma.board.findUnique({
        where: { id: boardId },
        include: {
          columns: {
            orderBy: { position: 'asc' },
            include: {
              workPackages: {
                where: { isDeleted: false },
                orderBy: { position: 'asc' },
                include: {
                  assignee: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
                },
              },
            },
          },
        },
      });
      if (!board) return Result.fail('Board introuvable.');
      return Result.ok(board);
    } catch (e) {
      this.logger.error('getBoard failed', e);
      return Result.fail('Échec du chargement du board.');
    }
  }

  async createBoard(projectId: string, dto: { name: string; type?: string; isDefault?: boolean }) {
    try {
      if (dto.isDefault) {
        await this.prisma.board.updateMany({ where: { projectId, isDefault: true }, data: { isDefault: false } });
      }
      const board = await this.prisma.board.create({
        data: {
          projectId,
          name: dto.name,
          type: dto.type ?? 'Kanban',
          isDefault: dto.isDefault ?? false,
          columns: { create: DEFAULT_COLUMNS },
        },
        include: { columns: { orderBy: { position: 'asc' } } },
      });
      return Result.ok(board);
    } catch (e) {
      this.logger.error('createBoard failed', e);
      return Result.fail('Échec de la création du board.');
    }
  }

  async updateBoard(boardId: string, dto: { name?: string; type?: string; isDefault?: boolean }) {
    try {
      const b = await this.prisma.board.update({ where: { id: boardId }, data: dto });
      return Result.ok(b);
    } catch {
      return Result.fail('Échec de la mise à jour du board.');
    }
  }

  async deleteBoard(boardId: string) {
    try {
      await this.prisma.board.delete({ where: { id: boardId } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async createColumn(boardId: string, dto: { name: string; wipLimit?: number; mapStatus?: string }) {
    try {
      const max = await this.prisma.boardColumn.aggregate({ where: { boardId }, _max: { position: true } });
      const col = await this.prisma.boardColumn.create({
        data: { boardId, name: dto.name, wipLimit: dto.wipLimit, mapStatus: dto.mapStatus, position: (max._max.position ?? -1) + 1 },
      });
      return Result.ok(col);
    } catch {
      return Result.fail('Échec de la création de la colonne.');
    }
  }

  async updateColumn(columnId: string, dto: { name?: string; wipLimit?: number | null; mapStatus?: string | null }) {
    try {
      const col = await this.prisma.boardColumn.update({ where: { id: columnId }, data: dto });
      return Result.ok(col);
    } catch {
      return Result.fail('Échec de la mise à jour.');
    }
  }

  async deleteColumn(columnId: string) {
    try {
      await this.prisma.boardColumn.delete({ where: { id: columnId } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async reorderColumns(boardId: string, order: string[]) {
    try {
      await Promise.all(order.map((id, idx) =>
        this.prisma.boardColumn.update({ where: { id }, data: { position: idx } }),
      ));
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec du réordonnancement.');
    }
  }

  async moveCard(workPackageId: string, boardColumnId: string | null, position: number) {
    try {
      const col = boardColumnId ? await this.prisma.boardColumn.findUnique({ where: { id: boardColumnId } }) : null;
      const data: Record<string, unknown> = { boardColumnId, position };
      if (col?.mapStatus) data.status = col.mapStatus;
      const wp = await this.prisma.workPackage.update({ where: { id: workPackageId }, data });
      // Broadcast to other connected clients so their board updates live.
      this.collab.broadcastCardMoved(wp.projectId, {
        workPackageId: wp.id,
        boardColumnId: wp.boardColumnId,
        status: wp.status,
      });
      return Result.ok(wp);
    } catch (e) {
      this.logger.error('moveCard failed', e);
      return Result.fail('Échec du déplacement.');
    }
  }

  async listSprints(boardId: string) {
    try {
      const sprints = await this.prisma.sprint.findMany({
        where: { boardId },
        include: { _count: { select: { workPackages: true } } },
        orderBy: { startDate: 'desc' },
      });
      return Result.ok(sprints);
    } catch {
      return Result.fail('Échec du chargement des sprints.');
    }
  }

  async createSprint(boardId: string, dto: { name: string; startDate: string; endDate: string; goal?: string; capacity?: number }) {
    try {
      const s = await this.prisma.sprint.create({
        data: {
          boardId,
          name: dto.name,
          goal: dto.goal ?? null,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          capacity: dto.capacity ?? null,
          status: 'Planning',
        },
      });
      return Result.ok(s);
    } catch (e) {
      this.logger.error('createSprint failed', e);
      return Result.fail('Échec de la création du sprint.');
    }
  }

  async updateSprint(id: string, dto: { name?: string; startDate?: string; endDate?: string; goal?: string; capacity?: number; status?: string }) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.goal !== undefined) data.goal = dto.goal;
      if (dto.capacity !== undefined) data.capacity = dto.capacity;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
      const s = await this.prisma.sprint.update({ where: { id }, data });
      return Result.ok(s);
    } catch {
      return Result.fail('Échec de la mise à jour du sprint.');
    }
  }

  async deleteSprint(id: string) {
    try {
      await this.prisma.sprint.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async startSprint(id: string) {
    const r = await this.updateSprint(id, { status: 'Active' });
    const sprint = r.value as { boardId?: string; name?: string } | undefined;
    if (r.isSuccess && sprint?.boardId) {
      void this.triggerAutomation(sprint.boardId, 'sprint_started', { sprintId: id, name: sprint.name });
    }
    return r;
  }

  async closeSprint(id: string) {
    const r = await this.updateSprint(id, { status: 'Closed' });
    const sprint = r.value as { boardId?: string; name?: string } | undefined;
    if (r.isSuccess && sprint?.boardId) {
      void this.triggerAutomation(sprint.boardId, 'sprint_closed', { sprintId: id, name: sprint.name });
    }
    return r;
  }

  async addWpToSprint(sprintId: string, workPackageIds: string[]) {
    try {
      await this.prisma.workPackage.updateMany({
        where: { id: { in: workPackageIds } },
        data: { sprintId },
      });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de l\'ajout au sprint.');
    }
  }

  async removeWpFromSprint(sprintId: string, workPackageId: string) {
    try {
      await this.prisma.workPackage.update({ where: { id: workPackageId }, data: { sprintId: null } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec du retrait.');
    }
  }

  async getBurndown(sprintId: string) {
    try {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: sprintId },
        include: { workPackages: { select: { estimatedHours: true, status: true, createdAt: true, updatedAt: true, percentDone: true } } },
      });
      if (!sprint) return Result.fail('Sprint introuvable.');

      const start = new Date(sprint.startDate);
      const end = new Date(sprint.endDate);
      const days: { date: string; ideal: number; remaining: number }[] = [];
      const totalHours = sprint.workPackages.reduce((s, wp) => s + (Number(wp.estimatedHours) || 0), 0);
      const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));

      for (let i = 0; i <= totalDays; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const ideal = totalHours - (totalHours * i) / totalDays;
        const remaining = sprint.workPackages
          .filter((wp) => new Date(wp.updatedAt) >= d || wp.status !== 'Closed')
          .reduce((s, wp) => s + (Number(wp.estimatedHours) || 0) * (1 - wp.percentDone / 100), 0);
        days.push({ date: d.toISOString().slice(0, 10), ideal: Math.max(0, ideal), remaining: Math.max(0, remaining) });
      }
      return Result.ok({ sprint, days });
    } catch (e) {
      this.logger.error('getBurndown failed', e);
      return Result.fail('Échec du burndown.');
    }
  }
}
