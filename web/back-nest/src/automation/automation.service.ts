import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AutomationRule } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import {
  CreateRuleDto,
  UpdateRuleDto,
  SendNotificationConfig,
  UpdateFieldConfig,
  KNOWN_ACTION_TYPES,
  KNOWN_TRIGGER_EVENTS,
  KNOWN_OPERATORS,
  isSafeField,
  isUnsafeKey,
} from './dto/automation.dto.js';

export { CreateRuleDto, UpdateRuleDto };

export interface EventContext {
  [key: string]: unknown;
}

interface RuleExecutionFrame {
  depth: number;
}

const MAX_RULE_DEPTH = 3;

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);
  private readonly executionStorage = new AsyncLocalStorage<RuleExecutionFrame>();

  constructor(private readonly prisma: PrismaService) {}

  async createRule(projectId: string, dto: CreateRuleDto): Promise<Result<unknown>> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, isDeleted: false } });
    if (!project) return Result.fail('Projet non trouvé.');

    const validationError = await this.validateActionConfig(dto.actionType, dto.actionConfig);
    if (validationError) return Result.fail(validationError);

    if (dto.actionType === 'send_notification') {
      const userId = (dto.actionConfig as { userId?: string }).userId;
      if (userId) {
        const memberError = await this.assertProjectMember(userId, projectId);
        if (memberError) return Result.fail(memberError);
      }
    }

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

  async updateRule(ruleId: string, projectId: string, dto: UpdateRuleDto): Promise<Result<unknown>> {
    // Defense-in-depth: confirm ruleId belongs to projectId (Sprint 2's ProjectAccessGuard
    // already blocks cross-project access at the controller layer).
    const rule = await this.prisma.automationRule.findFirst({ where: { id: ruleId, projectId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    const effectiveActionType = dto.actionType ?? rule.actionType;
    if (dto.actionConfig !== undefined) {
      const validationError = await this.validateActionConfig(effectiveActionType, dto.actionConfig);
      if (validationError) return Result.fail(validationError);

      if (effectiveActionType === 'send_notification') {
        const userId = (dto.actionConfig as { userId?: string }).userId;
        if (userId) {
          const memberError = await this.assertProjectMember(userId, projectId);
          if (memberError) return Result.fail(memberError);
        }
      }
    }

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

  async deleteRule(ruleId: string, projectId: string) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id: ruleId, projectId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    await this.prisma.automationRule.delete({ where: { id: ruleId } });
    return Result.ok();
  }

  async toggleRule(ruleId: string, projectId: string, isActive: boolean) {
    const rule = await this.prisma.automationRule.findFirst({ where: { id: ruleId, projectId } });
    if (!rule) return Result.fail('Règle non trouvée.');

    const updated = await this.prisma.automationRule.update({
      where: { id: ruleId },
      data: { isActive },
    });

    return Result.ok(this.toRuleDto(updated));
  }

  async executeRulesForEvent(projectId: string, event: string, context: EventContext): Promise<void> {
    const parentFrame = this.executionStorage.getStore();
    const nextDepth = (parentFrame?.depth ?? 0) + 1;

    if (nextDepth > MAX_RULE_DEPTH) {
      this.logger.warn(
        `Rule execution rejected: depth ${nextDepth} exceeds MAX_RULE_DEPTH=${MAX_RULE_DEPTH} for project ${projectId}, event ${event}`,
      );
      return;
    }

    await this.executionStorage.run({ depth: nextDepth }, async () => {
      const rules = await this.prisma.automationRule.findMany({
        where: { projectId, triggerEvent: event, isActive: true },
      });

      for (const rule of rules) {
        await this.executeRule(rule, projectId, context);
      }
    });
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

  /**
   * Verify `userId` has access to `projectId` — Admin, the assigned PM,
   * or a row in ProjectMember. Returns null on success, an error message
   * on failure.
   */
  private async assertProjectMember(userId: string, projectId: string): Promise<string | null> {
    const user = await this.prisma.appUser.findFirst({
      where: { id: userId, isActive: true },
      select: { id: true, role: true },
    });
    if (!user) return 'Utilisateur cible introuvable ou désactivé.';
    if (user.role === 'Admin') return null;

    const [asPm, asMember] = await Promise.all([
      this.prisma.project.findFirst({
        where: { id: projectId, isDeleted: false, projectManagerId: userId },
        select: { id: true },
      }),
      this.prisma.projectMember.findFirst({
        where: { userId, projectId },
        select: { id: true },
      }),
    ]);

    if (!asPm && !asMember) {
      return 'Utilisateur cible n\'a pas accès à ce projet.';
    }
    return null;
  }

  /** Validate `actionConfig` against the schema corresponding to `actionType`. */
  private async validateActionConfig(
    actionType: string,
    actionConfig: Record<string, unknown>,
  ): Promise<string | null> {
    // Reject prototype-polluting top-level keys up front.
    for (const key of Object.keys(actionConfig)) {
      if (isUnsafeKey(key)) {
        return `Clé interdite dans actionConfig: ${key}`;
      }
    }

    if (!(KNOWN_ACTION_TYPES as readonly string[]).includes(actionType)) {
      return `actionType inconnu: ${actionType}`;
    }

    if (actionType === 'send_notification') {
      const instance = plainToInstance(SendNotificationConfig, actionConfig, {
        excludeExtraneousValues: false,
      });
      const errs = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      if (errs.length > 0) {
        return `actionConfig invalide: ${errs.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ')}`;
      }
      return null;
    }

    if (actionType === 'update_field') {
      const instance = plainToInstance(UpdateFieldConfig, actionConfig, {
        excludeExtraneousValues: false,
      });
      const errs = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      if (errs.length > 0) {
        return `actionConfig invalide: ${errs.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; ')}`;
      }
      return null;
    }

    return `actionType non pris en charge: ${actionType}`;
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

    // Reject prototype-polluting / unsafe keys BEFORE bracket-access.
    if (!isSafeField(field)) {
      this.logger.warn(`evaluateCondition: unsafe field rejected: ${field}`);
      return false;
    }

    // Use hasOwnProperty to guarantee we never pick up inherited / prototype values.
    if (!Object.prototype.hasOwnProperty.call(context, field)) {
      return false;
    }

    if (!(KNOWN_OPERATORS as readonly string[]).includes(operator)) {
      this.logger.warn(`evaluateCondition: unknown operator "${operator}" — fail-closed`);
      return false;
    }

    const contextValue = context[field];
    switch (operator) {
      case 'equals':
        return contextValue === value;
      case 'not_equals':
        return contextValue !== value;
      case 'contains':
        return typeof contextValue === 'string' && contextValue.includes(String(value));
      default:
        // Unreachable due to the allow-list check above; fail-closed for safety.
        return false;
    }
  }

  private async executeAction(
    actionType: string,
    actionConfig: Record<string, unknown>,
    projectId: string,
    ruleName: string,
  ) {
    // Defense-in-depth: reject any prototype-polluting keys that somehow bypassed
    // the DTO layer (e.g. legacy rules persisted before this guard existed).
    for (const key of Object.keys(actionConfig)) {
      if (isUnsafeKey(key)) {
        throw new Error(`Clé interdite dans actionConfig: ${key}`);
      }
    }

    if (actionType === 'send_notification') {
      const getOwn = <T>(obj: Record<string, unknown>, key: string): T | undefined =>
        Object.prototype.hasOwnProperty.call(obj, key) ? (obj[key] as T) : undefined;

      let userId = getOwn<string>(actionConfig, 'userId');
      const message = getOwn<string>(actionConfig, 'message') ?? ruleName;

      // Fallback to the project's assigned project manager when userId is not set
      if (!userId) {
        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { projectManagerId: true },
        });
        userId = project?.projectManagerId ?? undefined;
      }

      if (!userId) {
        this.logger.debug(`send_notification: no userId and no PM assigned for project ${projectId}; skipping.`);
        return;
      }

      // Defense-in-depth: re-verify the recipient belongs to the project at
      // execution time (rule config can be stale if the user was removed).
      const memberError = await this.assertProjectMember(userId, projectId);
      if (memberError) {
        throw new Error(`send_notification: ${memberError}`);
      }

      await this.prisma.notification.create({
        data: {
          userId,
          type: 'automation',
          title: ruleName,
          message: safeTruncate(message, 499),
          projectId,
        },
      });
      return;
    }

    if (actionType === 'update_field') {
      const getOwn = <T>(obj: Record<string, unknown>, key: string): T | undefined =>
        Object.prototype.hasOwnProperty.call(obj, key) ? (obj[key] as T) : undefined;

      const fieldId = getOwn<string>(actionConfig, 'fieldId');
      const value = getOwn<string>(actionConfig, 'value');

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
    let triggerCondition: unknown = null;
    let configCorrupted = false;

    if (rule.triggerCondition) {
      try {
        triggerCondition = JSON.parse(rule.triggerCondition);
      } catch (err) {
        this.logger.warn(`toRuleDto: rule ${rule.id} has invalid triggerCondition JSON: ${String(err)}`);
        configCorrupted = true;
        triggerCondition = null;
      }
    }

    let actionConfig: Record<string, unknown> = {};
    try {
      actionConfig = JSON.parse(rule.actionConfig);
    } catch (err) {
      this.logger.error(`toRuleDto: rule ${rule.id} has invalid actionConfig JSON: ${String(err)}`);
      configCorrupted = true;
      actionConfig = {};
    }

    return {
      id: rule.id,
      projectId: rule.projectId,
      name: rule.name,
      triggerEvent: rule.triggerEvent,
      triggerCondition,
      actionType: rule.actionType,
      actionConfig,
      isActive: rule.isActive,
      executionCount: rule.executionCount,
      lastExecutedAt: rule.lastExecutedAt,
      createdAt: rule.createdAt,
      configCorrupted,
    };
  }
}

/**
 * Grapheme-aware truncation: uses `Array.from` to split on UTF-16 surrogate
 * pairs so emoji/high-codepoint characters are not cut in half.
 */
function safeTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const chars = Array.from(text);
  return chars.slice(0, maxLength).join('');
}

// Keep KNOWN_TRIGGER_EVENTS referenced so tree-shaking doesn't drop it in builds.
void KNOWN_TRIGGER_EVENTS;
