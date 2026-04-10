import { Injectable, Logger } from '@nestjs/common';
import type { AutomationRule } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export interface CreateRuleDto {
  name: string;
  triggerEvent: string;
  triggerCondition?: Record<string, unknown> | null;
  actionType: string;
  actionConfig: Record<string, unknown>;
}

export interface UpdateRuleDto {
  name?: string;
  triggerEvent?: string;
  triggerCondition?: Record<string, unknown> | null;
  actionType?: string;
  actionConfig?: Record<string, unknown>;
}

export interface EventContext {
  [key: string]: unknown;
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRule(projectId: string, dto: CreateRuleDto) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const rule = await this.prisma.automationRule.create({
      data: {
        projectId,
        name: dto.name,
        triggerEvent: dto.triggerEvent,
        triggerCondition: dto.triggerCondition ? JSON.stringify(dto.triggerCondition) : null,
        actionType: dto.actionType,
        actionConfig: JSON.stringify(dto.actionConfig),
      },
    });

    return Result.ok(this.toRuleDto(rule));
  }

  async listRules(projectId: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return Result.ok(rules.map((r) => this.toRuleDto(r)));
  }

  async updateRule(ruleId: string, dto: UpdateRuleDto) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    const updated = await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.triggerEvent !== undefined && { triggerEvent: dto.triggerEvent }),
        ...(dto.triggerCondition !== undefined && {
          triggerCondition: dto.triggerCondition ? JSON.stringify(dto.triggerCondition) : null,
        }),
        ...(dto.actionType !== undefined && { actionType: dto.actionType }),
        ...(dto.actionConfig !== undefined && { actionConfig: JSON.stringify(dto.actionConfig) }),
      },
    });

    return Result.ok(this.toRuleDto(updated));
  }

  async deleteRule(ruleId: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    await this.prisma.automationRule.delete({ where: { id: ruleId } });
    return Result.ok();
  }

  async toggleRule(ruleId: string, isActive: boolean) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id: ruleId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    const updated = await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { isActive },
    });

    return Result.ok(this.toRuleDto(updated));
  }

  async executeRulesForEvent(projectId: string, event: string, context: EventContext) {
    const rules = await this.prisma.automationRule.findMany({
      where: { projectId, triggerEvent: event, isActive: true },
    });

    for (const rule of rules) {
      await this.executeRule(rule, projectId, context);
    }
  }

  async getLogs(projectId: string, limit = 50) {
    const logs = await this.prisma.automationLog.findMany({
      where: { projectId },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });
    return Result.ok(logs);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  async isProjectManager(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false, projectManagerId: userId },
      select: { id: true },
    });
    return project !== null;
  }

  private async executeRule(rule: AutomationRule, projectId: string, context: EventContext) {
    let triggerCondition: Record<string, unknown> | null = null;
    try {
      triggerCondition = rule.triggerCondition ? JSON.parse(rule.triggerCondition as string) : null;
    } catch {
      this.logger.warn(`Rule ${rule.id}: invalid triggerCondition JSON`);
    }

    if (triggerCondition && !this.evaluateCondition(triggerCondition, context)) {
      await this.logExecution(rule.id, projectId, 'skipped', 'Condition non satisfaite');
      return;
    }

    let actionConfig: Record<string, unknown> = {};
    try {
      actionConfig = JSON.parse(rule.actionConfig as string);
    } catch {
      await this.logExecution(rule.id, projectId, 'failed', 'actionConfig JSON invalide');
      return;
    }

    try {
      await this.executeAction(rule.actionType, actionConfig, projectId, rule.name);

      await this.prisma.automationRule.update({
        where: { id: rule.id },
        data: {
          executionCount: { increment: 1 },
          lastExecutedAt: new Date(),
        },
      });

      await this.logExecution(rule.id, projectId, 'success', null);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Erreur inconnue';
      this.logger.error(`Rule ${rule.id} execution failed: ${detail}`);
      await this.logExecution(rule.id, projectId, 'failed', detail.slice(0, 490));
    }
  }

  private evaluateCondition(condition: Record<string, unknown>, context: EventContext): boolean {
    const { field, operator, value } = condition as {
      field?: string;
      operator?: string;
      value?: unknown;
    };
    if (!field || !operator) return true;

    const contextValue = context[field];
    switch (operator) {
      case 'equals': return contextValue === value;
      case 'not_equals': return contextValue !== value;
      case 'contains':
        return typeof contextValue === 'string' && contextValue.includes(String(value));
      default: return true;
    }
  }

  private async executeAction(
    actionType: string,
    actionConfig: Record<string, unknown>,
    projectId: string,
    ruleName: string,
  ) {
    if (actionType === 'send_notification') {
      const userId = actionConfig['userId'] as string | undefined;
      const message = (actionConfig['message'] as string | undefined) ?? ruleName;

      if (!userId) {
        this.logger.warn(`send_notification: missing userId in actionConfig`);
        return;
      }

      await this.prisma.notification.create({
        data: {
          userId,
          type: 'automation',
          title: ruleName,
          message: message.slice(0, 499),
          projectId,
        },
      });
      return;
    }

    if (actionType === 'update_field') {
      const fieldId = actionConfig['fieldId'] as string | undefined;
      const value = actionConfig['value'] as string | undefined;

      if (!fieldId) {
        this.logger.warn(`update_field: missing fieldId in actionConfig`);
        return;
      }

      await this.prisma.projectFieldValue.upsert({
        where: { projectId_projectFieldId: { projectId, projectFieldId: fieldId } },
        update: { value: value ?? null },
        create: { projectId, projectFieldId: fieldId, value: value ?? null },
      });
      return;
    }

    this.logger.warn(`Unknown actionType: ${actionType} — logged as skipped`);
    throw new Error(`Action type "${actionType}" non pris en charge`);
  }

  private async logExecution(
    ruleId: string,
    projectId: string,
    status: 'success' | 'failed' | 'skipped',
    detail: string | null,
  ) {
    await this.prisma.automationLog.create({
      data: { ruleId, projectId, status, detail },
    });
  }

  private toRuleDto(rule: AutomationRule) {
    return {
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      triggerEvent: rule.triggerEvent,
      triggerCondition: rule.triggerCondition
        ? (() => { try { return JSON.parse(rule.triggerCondition); } catch { return null; } })()
        : null,
      actionType: rule.actionType,
      actionConfig: (() => { try { return JSON.parse(rule.actionConfig); } catch { return {}; } })(),
      isActive: rule.isActive,
      executionCount: rule.executionCount,
      lastExecutedAt: rule.lastExecutedAt,
      createdAt: rule.createdAt,
    };
  }
}
