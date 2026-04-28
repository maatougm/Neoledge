import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnalyticsCacheService } from './analytics-cache.service.js';
import { Result } from '../common/result.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PhaseVelocityRow {
  phase: string;
  avgDays: number;
  minDays: number;
  maxDays: number;
  projectCount: number;
}

export interface BottleneckRow {
  phase: string;
  currentCount: number;
  avgDays: number;
  severity: 'high' | 'medium' | 'low';
}

export interface DeadlineRiskRow {
  projectId: string;
  projectName: string;
  status: string;
  pmName: string | null;
  daysRemaining: number;
  riskScore: number;
}

export interface TeamWorkloadRow {
  pmId: string;
  pmName: string;
  active: number;
  overdue: number;
  completed: number;
  upcoming: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL = 15; // minutes
const ACTIVE_STATUSES = ['Draft', 'Kickoff', 'CadrageTechnique', 'Environnement', 'Parametrage', 'Integration', 'Recette', 'MEP'];
const TERMINAL_STATUSES = ['Completed', 'Archived'];

// Detail field pattern: "Statut changé: <from> → <to>"
const STATUS_CHANGE_RE = /Statut\s+chang[ée]\s*:\s*(\S+)\s*[→>]\s*(\S+)/i;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  // ─── Phase Velocity ─────────────────────────────────────────────────────────

  async getPhaseVelocity(): Promise<Result<PhaseVelocityRow[]>> {
    const cached = await this.cache.get<PhaseVelocityRow[]>('phase_velocity', CACHE_TTL);
    if (cached) return Result.ok(cached);

    const activities = await this.prisma.projectActivity.findMany({
      where: { action: 'status_change', detail: { not: null } },
      orderBy: [{ projectId: 'asc' }, { createdAt: 'asc' }],
      select: { projectId: true, detail: true, createdAt: true },
    });

    // Group transitions per project, build phase→durations map
    const phaseDurations: Record<string, number[]> = {};

    // Per project, track current phase entry time
    const projectPhaseEntry: Record<string, { phase: string; at: Date }> = {};

    for (const act of activities) {
      if (!act.detail) continue;
      const match = STATUS_CHANGE_RE.exec(act.detail);
      if (!match) continue;

      const fromPhase = match[1];
      const toPhase = match[2];
      const at = act.createdAt;
      const pid = act.projectId;

      // If we have a tracked entry for fromPhase, record the duration
      const entry = projectPhaseEntry[pid];
      if (entry && entry.phase === fromPhase) {
        const days = (at.getTime() - entry.at.getTime()) / 86_400_000;
        if (!phaseDurations[fromPhase]) phaseDurations[fromPhase] = [];
        phaseDurations[fromPhase].push(days);
      }

      // Track entry into toPhase
      projectPhaseEntry[pid] = { phase: toPhase, at };
    }

    const result: PhaseVelocityRow[] = Object.entries(phaseDurations).map(([phase, durations]) => {
      const sorted = [...durations].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, d) => acc + d, 0);
      return {
        phase,
        avgDays: Math.round((sum / sorted.length) * 10) / 10,
        minDays: Math.round(sorted[0] * 10) / 10,
        maxDays: Math.round(sorted[sorted.length - 1] * 10) / 10,
        projectCount: sorted.length,
      };
    });

    await this.cache.set('phase_velocity', result);
    return Result.ok(result);
  }

  // ─── Bottleneck Heatmap ──────────────────────────────────────────────────────

  async getBottleneckHeatmap(): Promise<Result<BottleneckRow[]>> {
    const cached = await this.cache.get<BottleneckRow[]>('bottleneck_heatmap', CACHE_TTL);
    if (cached) return Result.ok(cached);

    const velocityResult = await this.getPhaseVelocity();
    const velocity = velocityResult.value ?? [];

    // Current project counts per status
    const statusGroups = await this.prisma.project.groupBy({
      by: ['status'],
      where: { isDeleted: false },
      _count: true,
    });
    const countByStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count]));

    const avgValues = velocity.map((v) => v.avgDays);
    const overallMean =
      avgValues.length > 0 ? avgValues.reduce((a, b) => a + b, 0) / avgValues.length : 0;

    const result: BottleneckRow[] = velocity.map((v) => {
      let severity: 'high' | 'medium' | 'low' = 'low';
      if (overallMean > 0) {
        if (v.avgDays > overallMean * 1.5) severity = 'high';
        else if (v.avgDays > overallMean) severity = 'medium';
      }

      return {
        phase: v.phase,
        currentCount: countByStatus[v.phase] ?? 0,
        avgDays: v.avgDays,
        severity,
      };
    });

    // Sort by avgDays desc (worst first)
    result.sort((a, b) => b.avgDays - a.avgDays);

    await this.cache.set('bottleneck_heatmap', result);
    return Result.ok(result);
  }

  // ─── Deadline Risk ───────────────────────────────────────────────────────────

  async getDeadlineRisk(): Promise<Result<DeadlineRiskRow[]>> {
    const cached = await this.cache.get<DeadlineRiskRow[]>('deadline_risk', CACHE_TTL);
    if (cached) return Result.ok(cached);

    const now = new Date();

    type ProjectRow = { id: string; name: string; status: string; endDate: Date; projectManager: { firstName: string; lastName: string } | null };
    // take: 500 — safety ceiling; results are cached for CACHE_TTL (15 min) so volume is bounded.
    const projects = await this.prisma.project.findMany({
      where: {
        isDeleted: false,
        status: { notIn: TERMINAL_STATUSES },
      },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
      },
      take: 500,
    }) as unknown as ProjectRow[];

    const result: DeadlineRiskRow[] = projects.map((p) => {
      const daysRemaining = Math.floor((p.endDate.getTime() - now.getTime()) / 86_400_000);
      let riskScore: number;

      if (daysRemaining < 0) {
        riskScore = 100;
      } else {
        riskScore = Math.max(0, Math.min(100, Math.round(((30 - daysRemaining) / 30) * 100)));
      }

      return {
        projectId: p.id,
        projectName: p.name,
        status: p.status,
        pmName: p.projectManager
          ? `${p.projectManager.firstName} ${p.projectManager.lastName}`
          : null,
        daysRemaining,
        riskScore,
      };
    });

    result.sort((a, b) => b.riskScore - a.riskScore);

    await this.cache.set('deadline_risk', result);
    return Result.ok(result);
  }

  // ─── Team Workload ───────────────────────────────────────────────────────────

  async getTeamWorkload(): Promise<Result<TeamWorkloadRow[]>> {
    const cached = await this.cache.get<TeamWorkloadRow[]>('team_workload', CACHE_TTL);
    if (cached) return Result.ok(cached);

    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 86_400_000);

    // take: 500 — safety ceiling; results are cached for CACHE_TTL (15 min) so volume is bounded.
    const managers = await this.prisma.appUser.findMany({
      where: { role: 'ProjectManager', isActive: true },
      include: {
        managedProjects: {
          where: { isDeleted: false },
          select: { status: true, endDate: true, updatedAt: true },
        },
      },
      take: 500,
    });

    const result: TeamWorkloadRow[] = managers.map((m) => {
      const projects = m.managedProjects;

      const active = projects.filter((p) => ACTIVE_STATUSES.includes(p.status)).length;

      const overdue = projects.filter(
        (p) => p.endDate < now && ACTIVE_STATUSES.includes(p.status),
      ).length;

      const completed = projects.filter(
        (p) => p.status === 'Completed' && p.updatedAt >= ninetyDaysAgo,
      ).length;

      const upcoming = projects.filter(
        (p) =>
          ACTIVE_STATUSES.includes(p.status) &&
          p.endDate >= now &&
          p.endDate <= fourteenDaysFromNow,
      ).length;

      return {
        pmId: m.id,
        pmName: `${m.firstName} ${m.lastName}`,
        active,
        overdue,
        completed,
        upcoming,
      };
    });

    // Sort by active desc, then overdue desc
    result.sort((a, b) => b.active - a.active || b.overdue - a.overdue);

    await this.cache.set('team_workload', result);
    return Result.ok(result);
  }
}
