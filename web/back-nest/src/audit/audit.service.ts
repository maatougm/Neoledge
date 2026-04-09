import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'STATUS_CHANGE' | 'ASSIGN' | 'VALIDATE' | 'RESET_PASSWORD' | 'TOTP_ENABLED' | 'TOTP_DISABLED';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget — never throws. Call without await from other services. */
  async log(
    entityType: string,
    entityId: string,
    action: AuditAction,
    userId?: string,
    changes?: Record<string, { before: unknown; after: unknown }>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType,
          entityId,
          action,
          userId: userId ?? null,
          changes: changes ? JSON.stringify(changes) : null,
          metadata: metadata ? JSON.stringify(metadata).slice(0, 1000) : null,
        },
      });
    } catch {
      // Audit failure must never break business logic
    }
  }

  async getForEntity(entityType: string, entityId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Result.ok(logs.map((l) => this.toDto(l)));
  }

  async getForUser(userId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Result.ok(logs.map((l) => this.toDto(l)));
  }

  async getRecent(limit = 50) {
    const logs = await this.prisma.auditLog.findMany({
      include: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return Result.ok(logs.map((l) => this.toDto(l)));
  }

  private toDto(log: any) {
    return {
      id: log.id,
      entityType: log.entityType,
      entityId: log.entityId,
      action: log.action,
      userId: log.userId,
      user: log.user ? `${log.user.firstName} ${log.user.lastName}` : null,
      userRole: log.user?.role ?? null,
      changes: log.changes ? (() => { try { return JSON.parse(log.changes); } catch { return null; } })() : null,
      metadata: log.metadata ? (() => { try { return JSON.parse(log.metadata); } catch { return null; } })() : null,
      createdAt: log.createdAt,
    };
  }
}
