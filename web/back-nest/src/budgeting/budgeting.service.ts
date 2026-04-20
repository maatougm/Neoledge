import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { TimeTrackingService } from '../time-tracking/time-tracking.service.js';

// Money arithmetic helpers — keep everything as Prisma.Decimal until
// the final serialisation boundary. `toDec(v)` accepts number | string |
// Decimal | null | undefined and returns a Decimal (defaulting to 0).
type DecimalInput = Prisma.Decimal | number | string | null | undefined;
const toDec = (v: DecimalInput): Prisma.Decimal => {
  if (v === null || v === undefined) return new Prisma.Decimal(0);
  if (v instanceof Prisma.Decimal) return v;
  return new Prisma.Decimal(v);
};

@Injectable()
export class BudgetingService {
  private readonly logger = new Logger(BudgetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeTracking: TimeTrackingService,
  ) {}

  async getBudget(projectId: string) {
    try {
      const budget = await this.prisma.projectBudget.findUnique({
        where: { projectId },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
      return Result.ok(budget);
    } catch (e) {
      this.logger.error('getBudget failed', e);
      return Result.fail('Échec du chargement du budget.');
    }
  }

  /**
   * Optimistic-concurrency `upsert`. Client sends `expectedVersion` (the version
   * it last read). If the DB has advanced we reject with ConflictException so the
   * caller can refetch. New budgets start at version 0.
   */
  async upsertBudget(
    projectId: string,
    dto: { laborBudget?: number | string; materialBudget?: number | string; currency?: string; notes?: string | null; expectedVersion?: number },
  ) {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.projectBudget.findUnique({ where: { projectId } });

        if (!existing) {
          return tx.projectBudget.create({
            data: {
              projectId,
              laborBudget: toDec(dto.laborBudget),
              materialBudget: toDec(dto.materialBudget),
              currency: dto.currency ?? 'EUR',
              notes: dto.notes ?? null,
              version: 1,
            },
            include: { lineItems: { orderBy: { position: 'asc' } } },
          });
        }

        if (
          typeof dto.expectedVersion === 'number' &&
          dto.expectedVersion !== existing.version
        ) {
          throw new ConflictException(
            `Le budget a été modifié par un autre utilisateur (version ${existing.version}, vue ${dto.expectedVersion}). Veuillez recharger.`,
          );
        }

        // Guarded update: only applies if `version` still matches. If another
        // transaction bumped it between our read and write, `count === 0` and
        // we reject with 409.
        const guarded = await tx.projectBudget.updateMany({
          where: { projectId, version: existing.version },
          data: {
            laborBudget: dto.laborBudget !== undefined ? toDec(dto.laborBudget) : undefined,
            materialBudget: dto.materialBudget !== undefined ? toDec(dto.materialBudget) : undefined,
            currency: dto.currency ?? undefined,
            notes: 'notes' in dto ? dto.notes : undefined,
            version: { increment: 1 },
          },
        });
        if (guarded.count === 0) {
          throw new ConflictException('Le budget a été modifié par un autre utilisateur. Veuillez recharger.');
        }

        return tx.projectBudget.findUnique({
          where: { projectId },
          include: { lineItems: { orderBy: { position: 'asc' } } },
        });
      });

      return Result.ok(result);
    } catch (e) {
      if (e instanceof ConflictException) {
        // Surface the precise message for the controller to map to HTTP 409.
        return Result.fail(e.message);
      }
      this.logger.error('upsertBudget failed', e);
      return Result.fail('Échec de la sauvegarde.');
    }
  }

  private async ensureBudget(projectId: string) {
    const b = await this.prisma.projectBudget.findUnique({ where: { projectId } });
    if (b) return b;
    return this.prisma.projectBudget.create({ data: { projectId } });
  }

  async createLineItem(
    projectId: string,
    dto: { description: string; type?: string; kind?: string; unitCost: number | string; units: number | string; position?: number },
  ) {
    try {
      const budget = await this.ensureBudget(projectId);
      const max = await this.prisma.budgetLineItem.aggregate({ where: { budgetId: budget.id }, _max: { position: true } });
      const unitCost = toDec(dto.unitCost);
      const units = toDec(dto.units);
      const total = unitCost.mul(units);
      const kind = dto.kind === 'planned' ? 'planned' : 'actual';
      const item = await this.prisma.budgetLineItem.create({
        data: {
          budgetId: budget.id,
          description: dto.description,
          type: dto.type ?? 'material',
          kind,
          unitCost,
          units,
          total,
          position: dto.position ?? (max._max.position ?? -1) + 1,
        },
      });
      return Result.ok(item);
    } catch (e) {
      this.logger.error('createLineItem failed', e);
      return Result.fail('Échec de la création.');
    }
  }

  async updateLineItem(
    projectId: string,
    id: string,
    dto: { description?: string; type?: string; kind?: string; unitCost?: number | string; units?: number | string; position?: number },
  ) {
    try {
      // Scope by projectId to prevent cross-project IDOR on the line-item id.
      const existing = await this.prisma.budgetLineItem.findFirst({
        where: { id, budget: { projectId } },
      });
      if (!existing) return Result.fail('Ligne introuvable.');
      const unitCost = dto.unitCost !== undefined ? toDec(dto.unitCost) : toDec(existing.unitCost);
      const units = dto.units !== undefined ? toDec(dto.units) : toDec(existing.units);
      const total = unitCost.mul(units);
      const kind = dto.kind !== undefined
        ? (dto.kind === 'planned' ? 'planned' : 'actual')
        : undefined;
      const item = await this.prisma.budgetLineItem.update({
        where: { id },
        data: {
          description: dto.description ?? undefined,
          type: dto.type ?? undefined,
          kind,
          unitCost: dto.unitCost !== undefined ? unitCost : undefined,
          units: dto.units !== undefined ? units : undefined,
          total,
          position: dto.position ?? undefined,
        },
      });
      return Result.ok(item);
    } catch (e) {
      this.logger.error('updateLineItem failed', e);
      return Result.fail('Échec de la mise à jour.');
    }
  }

  async deleteLineItem(projectId: string, id: string) {
    try {
      // Scope by projectId to prevent cross-project IDOR.
      const existing = await this.prisma.budgetLineItem.findFirst({
        where: { id, budget: { projectId } },
      });
      if (!existing) return Result.fail<void>('Ligne introuvable.');
      await this.prisma.budgetLineItem.delete({ where: { id } });
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('deleteLineItem failed', e);
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async getBurnReport(projectId: string) {
    try {
      const budget = await this.prisma.projectBudget.findUnique({ where: { projectId } });
      const labor = toDec(budget?.laborBudget);
      const material = toDec(budget?.materialBudget);
      const totalBudget = labor.add(material);

      // Labor spent = sum(timeEntry.hours * effective rate). Exclude entries
      // whose WP is soft-deleted (null workPackageId still counts — orphan
      // entries belong to the project itself).
      const entries = await this.prisma.timeEntry.findMany({
        where: {
          projectId,
          isBillable: true,
          OR: [{ workPackageId: null }, { workPackage: { isDeleted: false } }],
        },
      });
      let laborSpent = new Prisma.Decimal(0);
      for (const e of entries) {
        const rate = await this.timeTracking.getEffectiveRate(e.userId, projectId, new Date(e.spentOn));
        const rateDec = rate ? toDec(rate.rate) : new Prisma.Decimal(0);
        laborSpent = laborSpent.add(toDec(e.hours).mul(rateDec));
      }
      // Material spent = sum(budgetLineItem.total where type='material' AND kind='actual').
      // Planned line items are excluded so they do not double-count as spent.
      const materialSpentRaw = budget
        ? (await this.prisma.budgetLineItem.aggregate({
            where: { budgetId: budget.id, type: 'material', kind: 'actual' },
            _sum: { total: true },
          }))._sum.total
        : null;
      const materialSpent = toDec(materialSpentRaw);

      const spent = laborSpent.add(materialSpent);
      const remaining = totalBudget.sub(spent);
      const percentUsed = totalBudget.gt(0)
        ? Math.round(spent.div(totalBudget).mul(100).toNumber())
        : 0;

      // Serialise Decimals to fixed-precision strings at the boundary so the
      // frontend receives a consistent shape and no IEEE-754 drift.
      return Result.ok({
        totalBudget: totalBudget.toFixed(2),
        labor: labor.toFixed(2),
        material: material.toFixed(2),
        laborSpent: laborSpent.toFixed(2),
        materialSpent: materialSpent.toFixed(2),
        spent: spent.toFixed(2),
        remaining: remaining.toFixed(2),
        percentUsed,
        currency: budget?.currency ?? 'EUR',
      });
    } catch (e) {
      this.logger.error('getBurnReport failed', e);
      return Result.fail('Échec du rapport.');
    }
  }

  async getOverview() {
    try {
      const budgets = await this.prisma.projectBudget.findMany({
        where: { project: { isDeleted: false } },
        include: { project: { select: { id: true, name: true, status: true } }, lineItems: true },
      });
      return Result.ok(budgets);
    } catch (e) {
      this.logger.error('getOverview failed', e);
      return Result.fail('Échec.');
    }
  }
}
