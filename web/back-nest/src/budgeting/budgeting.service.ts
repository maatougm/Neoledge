import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { TimeTrackingService } from '../time-tracking/time-tracking.service.js';

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
    } catch {
      return Result.fail('Échec du chargement du budget.');
    }
  }

  async upsertBudget(projectId: string, dto: { laborBudget?: number; materialBudget?: number; currency?: string; notes?: string }) {
    try {
      const b = await this.prisma.projectBudget.upsert({
        where: { projectId },
        create: {
          projectId,
          laborBudget: dto.laborBudget ?? 0,
          materialBudget: dto.materialBudget ?? 0,
          currency: dto.currency ?? 'EUR',
          notes: dto.notes ?? null,
        },
        update: {
          laborBudget: dto.laborBudget ?? undefined,
          materialBudget: dto.materialBudget ?? undefined,
          currency: dto.currency ?? undefined,
          notes: dto.notes ?? undefined,
        },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
      return Result.ok(b);
    } catch (e) {
      this.logger.error('upsertBudget failed', e);
      return Result.fail('Échec de la sauvegarde.');
    }
  }

  private async ensureBudget(projectId: string) {
    const b = await this.prisma.projectBudget.findUnique({ where: { projectId } });
    if (b) return b;
    return this.prisma.projectBudget.create({ data: { projectId } });
  }

  async createLineItem(projectId: string, dto: { description: string; type?: string; unitCost: number; units: number; position?: number }) {
    try {
      const budget = await this.ensureBudget(projectId);
      const max = await this.prisma.budgetLineItem.aggregate({ where: { budgetId: budget.id }, _max: { position: true } });
      const total = dto.unitCost * dto.units;
      const item = await this.prisma.budgetLineItem.create({
        data: {
          budgetId: budget.id,
          description: dto.description,
          type: dto.type ?? 'material',
          unitCost: dto.unitCost,
          units: dto.units,
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

  async updateLineItem(id: string, dto: { description?: string; type?: string; unitCost?: number; units?: number; position?: number }) {
    try {
      const existing = await this.prisma.budgetLineItem.findUnique({ where: { id } });
      if (!existing) return Result.fail('Ligne introuvable.');
      const unitCost = dto.unitCost ?? Number(existing.unitCost);
      const units = dto.units ?? Number(existing.units);
      const item = await this.prisma.budgetLineItem.update({
        where: { id },
        data: {
          description: dto.description ?? undefined,
          type: dto.type ?? undefined,
          unitCost: dto.unitCost ?? undefined,
          units: dto.units ?? undefined,
          total: unitCost * units,
          position: dto.position ?? undefined,
        },
      });
      return Result.ok(item);
    } catch {
      return Result.fail('Échec de la mise à jour.');
    }
  }

  async deleteLineItem(id: string) {
    try {
      await this.prisma.budgetLineItem.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec de la suppression.');
    }
  }

  async getBurnReport(projectId: string) {
    try {
      const budget = await this.prisma.projectBudget.findUnique({ where: { projectId } });
      const labor = Number(budget?.laborBudget ?? 0);
      const material = Number(budget?.materialBudget ?? 0);
      const totalBudget = labor + material;

      // Labor spent = sum(timeEntry.hours * effective rate)
      const entries = await this.prisma.timeEntry.findMany({ where: { projectId, isBillable: true } });
      let laborSpent = 0;
      for (const e of entries) {
        const rate = await this.timeTracking.getEffectiveRate(e.userId, projectId, new Date(e.spentOn));
        laborSpent += Number(e.hours) * (rate ? Number(rate.rate) : 0);
      }
      // Material spent = sum(budgetLineItem.total where type='material' and position=0 — i.e. actuals)
      const materialSpent = budget
        ? (await this.prisma.budgetLineItem.aggregate({
            where: { budgetId: budget.id, type: 'material' },
            _sum: { total: true },
          }))._sum.total ?? 0
        : 0;

      const spent = laborSpent + Number(materialSpent);
      const remaining = totalBudget - spent;
      const percentUsed = totalBudget > 0 ? Math.round((spent / totalBudget) * 100) : 0;

      return Result.ok({
        totalBudget, labor, material, laborSpent, materialSpent: Number(materialSpent),
        spent, remaining, percentUsed,
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
        include: { project: { select: { id: true, name: true, status: true } }, lineItems: true },
      });
      return Result.ok(budgets);
    } catch {
      return Result.fail('Échec.');
    }
  }
}
