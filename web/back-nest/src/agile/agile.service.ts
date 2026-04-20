import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { AutomationService } from '../automation/automation.service.js';
import { CollaborationGateway } from '../collaboration/collaboration.gateway.js';

// Prisma unique-constraint violation.
const PRISMA_UNIQUE_VIOLATION = 'P2002';

const DEFAULT_COLUMNS = [
  { name: 'New', mapStatus: 'New', position: 0 },
  { name: 'In Progress', mapStatus: 'InProgress', position: 1 },
  { name: 'Resolved', mapStatus: 'Resolved', position: 2 },
  { name: 'Closed', mapStatus: 'Closed', position: 3 },
];

// Sprint state machine: { current → allowed next }
const SPRINT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  Planning: ['Active', 'Cancelled'],
  Active: ['Closed'],
  Closed: [],
  Cancelled: [],
};

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
      if (board) void this.automation.executeRulesForEvent(board.projectId, event, context).catch((e) => this.logger.error('triggerAutomation executeRulesForEvent failed', e));
    } catch (e) {
      this.logger.error('triggerAutomation failed', e);
    }
  }

  /**
   * Cold-start idempotency: wraps the check-then-create of the default board
   * in a single transaction. The unique (projectId, name) constraint from the
   * Phase 9 migration guards against a concurrent race — we catch P2002 and
   * fall through to re-read.
   */
  async listBoards(projectId: string) {
    try {
      const boards = await this.prisma.board.findMany({
        where: { projectId },
        include: { _count: { select: { columns: true, sprints: true } } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      if (boards.length > 0) return Result.ok(boards);

      // No board yet — try to create the default atomically.
      try {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.board.findFirst({ where: { projectId } });
          if (existing) return;
          await tx.board.create({
            data: {
              projectId,
              name: 'Default Board',
              type: 'Kanban',
              isDefault: true,
              columns: { create: DEFAULT_COLUMNS },
            },
          });
        });
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== PRISMA_UNIQUE_VIOLATION) {
          this.logger.error('listBoards auto-create failed', e);
          return Result.fail('Échec de la création du board par défaut.');
        }
        // Concurrent auto-create — another request won. Fall through to re-read.
      }

      const after = await this.prisma.board.findMany({
        where: { projectId },
        include: { _count: { select: { columns: true, sprints: true } } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      return Result.ok(after);
    } catch (e) {
      this.logger.error('listBoards failed', e);
      return Result.fail('Échec du chargement des boards.');
    }
  }

  async getBoard(boardId: string, projectId?: string) {
    try {
      const where = projectId ? { id: boardId, projectId } : { id: boardId };
      const board = await this.prisma.board.findFirst({
        where,
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
      const type = dto.type ?? 'Kanban';
      const board = await this.prisma.board.create({
        data: {
          projectId,
          name: dto.name,
          type,
          isDefault: dto.isDefault ?? false,
          // Only Kanban boards get the 4 default columns — Scrum/other boards
          // should have columns defined explicitly by the caller.
          ...(type === 'Kanban' ? { columns: { create: DEFAULT_COLUMNS } } : {}),
        },
        include: { columns: { orderBy: { position: 'asc' } } },
      });
      return Result.ok(board);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === PRISMA_UNIQUE_VIOLATION) {
        return Result.fail('Un board avec ce nom existe déjà.');
      }
      this.logger.error('createBoard failed', e);
      return Result.fail('Échec de la création du board.');
    }
  }

  async updateBoard(boardId: string, dto: { name?: string; type?: string; isDefault?: boolean }) {
    try {
      const b = await this.prisma.board.update({ where: { id: boardId }, data: dto });
      return Result.ok(b);
    } catch (e) {
      this.logger.error('updateBoard failed', e);
      return Result.fail('Échec de la mise à jour du board.');
    }
  }

  async deleteBoard(boardId: string) {
    try {
      await this.prisma.board.delete({ where: { id: boardId } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteBoard failed', e);
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
    } catch (e) {
      this.logger.error('createColumn failed', e);
      return Result.fail('Échec de la création de la colonne.');
    }
  }

  async updateColumn(columnId: string, dto: { name?: string; wipLimit?: number | null; mapStatus?: string | null }) {
    try {
      const col = await this.prisma.boardColumn.update({ where: { id: columnId }, data: dto });
      return Result.ok(col);
    } catch (e) {
      this.logger.error('updateColumn failed', e);
      return Result.fail('Échec de la mise à jour.');
    }
  }

  /**
   * Refuse to delete a column that still has cards — the FK is NoAction so a
   * silent catch previously swallowed P2003. Caller must move WPs first.
   */
  async deleteColumn(columnId: string) {
    try {
      const attached = await this.prisma.workPackage.count({
        where: { boardColumnId: columnId, isDeleted: false },
      });
      if (attached > 0) {
        return Result.fail<void>(
          `Colonne non vide (${attached} carte${attached > 1 ? 's' : ''}). Déplacez les cartes avant de supprimer.`,
        );
      }
      await this.prisma.boardColumn.delete({ where: { id: columnId } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteColumn failed', e);
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  /**
   * Atomic reorder: all updates run inside a single transaction. We also
   * assert that `order` is an exact permutation of the board's columns — no
   * subset, no extras, no cross-board IDs.
   */
  async reorderColumns(boardId: string, order: string[]) {
    try {
      if (!Array.isArray(order) || order.length === 0) {
        return Result.fail<void>('Liste d\'ordre invalide.');
      }
      const seen = new Set(order);
      if (seen.size !== order.length) {
        return Result.fail<void>('IDs en double dans l\'ordre.');
      }
      const columns = await this.prisma.boardColumn.findMany({
        where: { boardId },
        select: { id: true },
      });
      const columnIds = new Set(columns.map((c) => c.id));
      if (order.length !== columnIds.size) {
        return Result.fail<void>('L\'ordre doit couvrir exactement les colonnes du board.');
      }
      for (const id of order) {
        if (!columnIds.has(id)) {
          return Result.fail<void>('Une colonne n\'appartient pas à ce board.');
        }
      }
      await this.prisma.$transaction(
        order.map((id, idx) =>
          this.prisma.boardColumn.update({ where: { id }, data: { position: idx } }),
        ),
      );
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('reorderColumns failed', e);
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
    } catch (e) {
      this.logger.error('listSprints failed', e);
      return Result.fail('Échec du chargement des sprints.');
    }
  }

  async createSprint(boardId: string, dto: { name: string; startDate: string; endDate: string; goal?: string; capacity?: number }) {
    try {
      const start = new Date(dto.startDate);
      const end = new Date(dto.endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return Result.fail('Dates invalides.');
      }
      if (end.getTime() <= start.getTime()) {
        return Result.fail('La date de fin doit être après la date de début.');
      }
      const s = await this.prisma.sprint.create({
        data: {
          boardId,
          name: dto.name,
          goal: dto.goal ?? null,
          startDate: start,
          endDate: end,
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
      // Deliberately do NOT accept status here — state transitions must go
      // through startSprint/closeSprint so invariants are enforced.
      if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
      if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
      const s = await this.prisma.sprint.update({ where: { id }, data });
      return Result.ok(s);
    } catch (e) {
      this.logger.error('updateSprint failed', e);
      return Result.fail('Échec de la mise à jour du sprint.');
    }
  }

  async deleteSprint(id: string) {
    try {
      await this.prisma.sprint.delete({ where: { id } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteSprint failed', e);
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  private assertTransition(current: string, next: string): string | null {
    const allowed = SPRINT_TRANSITIONS[current];
    if (!allowed) return `Statut inconnu: "${current}".`;
    if (!allowed.includes(next)) {
      return `Transition interdite: ${current} → ${next}.`;
    }
    return null;
  }

  async startSprint(id: string) {
    try {
      const existing = await this.prisma.sprint.findUnique({ where: { id } });
      if (!existing) return Result.fail('Sprint introuvable.');
      const err = this.assertTransition(existing.status, 'Active');
      if (err) return Result.fail(err);
      const s = await this.prisma.sprint.update({ where: { id }, data: { status: 'Active' } });
      void this.triggerAutomation(s.boardId, 'sprint_started', { sprintId: id, name: s.name });
      return Result.ok(s);
    } catch (e) {
      this.logger.error('startSprint failed', e);
      return Result.fail('Échec du démarrage du sprint.');
    }
  }

  async closeSprint(id: string) {
    try {
      const existing = await this.prisma.sprint.findUnique({ where: { id } });
      if (!existing) return Result.fail('Sprint introuvable.');
      const err = this.assertTransition(existing.status, 'Closed');
      if (err) return Result.fail(err);
      const s = await this.prisma.sprint.update({ where: { id }, data: { status: 'Closed' } });
      void this.triggerAutomation(s.boardId, 'sprint_closed', { sprintId: id, name: s.name });
      return Result.ok(s);
    } catch (e) {
      this.logger.error('closeSprint failed', e);
      return Result.fail('Échec de la clôture du sprint.');
    }
  }

  /**
   * Cross-project defense: verify every WP.projectId matches the sprint's
   * board.projectId before bulk-updating.
   */
  async addWpToSprint(sprintId: string, workPackageIds: string[]) {
    try {
      if (!Array.isArray(workPackageIds) || workPackageIds.length === 0) {
        return Result.fail<void>('Aucun work package fourni.');
      }
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: sprintId },
        include: { board: { select: { projectId: true } } },
      });
      if (!sprint) return Result.fail<void>('Sprint introuvable.');
      const expectedProjectId = sprint.board.projectId;

      const wps = await this.prisma.workPackage.findMany({
        where: { id: { in: workPackageIds } },
        select: { id: true, projectId: true },
      });
      if (wps.length !== workPackageIds.length) {
        return Result.fail<void>('Un ou plusieurs work packages introuvables.');
      }
      const mismatched = wps.filter((wp) => wp.projectId !== expectedProjectId);
      if (mismatched.length > 0) {
        return Result.fail<void>('Un ou plusieurs work packages appartiennent à un autre projet.');
      }

      await this.prisma.workPackage.updateMany({
        where: { id: { in: workPackageIds }, projectId: expectedProjectId },
        data: { sprintId },
      });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('addWpToSprint failed', e);
      return Result.fail<void>('Échec de l\'ajout au sprint.');
    }
  }

  async removeWpFromSprint(sprintId: string, workPackageId: string) {
    try {
      await this.prisma.workPackage.update({ where: { id: workPackageId }, data: { sprintId: null } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('removeWpFromSprint failed', e);
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
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BadRequestException('Dates de sprint invalides.');
      }
      const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      if (totalDays <= 0) {
        throw new BadRequestException('Sprint trop court pour calculer un burndown (durée ≤ 0 jour).');
      }

      const days: { date: string; ideal: number; remaining: number }[] = [];
      const totalHours = sprint.workPackages.reduce((s, wp) => s + (Number(wp.estimatedHours) || 0), 0);
      const DAY_MS = 24 * 60 * 60 * 1000;

      for (let i = 0; i <= totalDays; i++) {
        const d = new Date(start.getTime() + i * DAY_MS);
        const ideal = totalHours - (totalHours * i) / totalDays;
        const remaining = sprint.workPackages
          .filter((wp) => new Date(wp.updatedAt) >= d || wp.status !== 'Closed')
          .reduce((s, wp) => s + (Number(wp.estimatedHours) || 0) * (1 - wp.percentDone / 100), 0);
        days.push({ date: d.toISOString().slice(0, 10), ideal: Math.max(0, ideal), remaining: Math.max(0, remaining) });
      }
      return Result.ok({ sprint, days });
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      this.logger.error('getBurndown failed', e);
      return Result.fail('Échec du burndown.');
    }
  }
}
