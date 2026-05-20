import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { ErrorTracker, type TrackedError } from '../common/error-tracker.js';

export interface SecurityEventDto {
  action: string;
  userEmail: string | null;
  createdAt: string;
}

export interface SystemStatusDto {
  // Server health
  serverStatus: 'up';
  uptimeSeconds: number;
  memoryUsedMb: number;
  nodeVersion: string;
  // Dependencies
  databaseStatus: string; // 'Connecté' | 'Erreur'
  transcriptionStatus: string; // 'Connecté' | 'Injoignable' | 'Désactivé'
  // Users
  userTotal: number;
  userActive: number;
  // Projects
  projectTotal: number;
  projectByStatus: Record<string, number>;
  // Security / attack surface
  security: {
    lockedAccounts: number;
    accountsUnderAttack: number; // accounts with >0 failed attempts (not yet locked)
    logins24h: number;
    failedLoginsCurrent: number; // sum of pending failed attempts across accounts
    recentEvents: SecurityEventDto[];
  };
  // Server errors (5xx) captured since boot — in-process, resets on restart.
  errors: {
    totalSinceBoot: number;
    recentCount: number;
    recent: TrackedError[];
  };
}

@Injectable()
export class SystemStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(): Promise<SystemStatusDto> {
    // ── DB connectivity ──────────────────────────────────────────────────────
    let databaseStatus = 'Connecté';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'Erreur';
    }

    // ── Transcription service reachability ─────────────────────────────────────
    const transcriptionStatus = await this.checkTranscription();

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      userTotal,
      userActive,
      projectTotal,
      projectsByStatus,
      lockedAccounts,
      attackedAccounts,
      logins24h,
      failedAgg,
      recent,
    ] = await Promise.all([
      this.prisma.appUser.count(),
      this.prisma.appUser.count({ where: { isActive: true } }),
      this.prisma.project.count({ where: { isDeleted: false } }),
      this.prisma.project.groupBy({
        by: ['status'],
        where: { isDeleted: false },
        _count: { _all: true },
      }),
      this.prisma.appUser.count({ where: { lockedUntil: { gt: new Date() } } }),
      this.prisma.appUser.count({ where: { failedLoginAttempts: { gt: 0 } } }),
      this.prisma.auditLog.count({ where: { action: 'LOGIN', createdAt: { gte: since24h } } }),
      this.prisma.appUser.aggregate({ _sum: { failedLoginAttempts: true } }),
      this.prisma.auditLog.findMany({
        where: { action: { in: ['LOGIN', 'LOGOUT', 'RESET_PASSWORD', 'TOTP_ENABLED', 'TOTP_DISABLED'] } },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { action: true, createdAt: true, user: { select: { email: true } } },
      }),
    ]);

    const projectByStatus: Record<string, number> = {};
    for (const row of projectsByStatus) {
      projectByStatus[row.status] = row._count._all;
    }

    return {
      serverStatus: 'up',
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      nodeVersion: process.version,
      databaseStatus,
      transcriptionStatus,
      userTotal,
      userActive,
      projectTotal,
      projectByStatus,
      security: {
        lockedAccounts,
        accountsUnderAttack: attackedAccounts,
        logins24h,
        failedLoginsCurrent: failedAgg._sum.failedLoginAttempts ?? 0,
        recentEvents: recent.map((e) => ({
          action: e.action,
          userEmail: e.user?.email ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
      },
      errors: ErrorTracker.snapshot(),
    };
  }

  private async checkTranscription(): Promise<string> {
    const url = this.config.get<string>('TRANSCRIPTION_URL');
    if (!url) return 'Désactivé';
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok ? 'Connecté' : 'Injoignable';
    } catch {
      return 'Injoignable';
    }
  }
}
