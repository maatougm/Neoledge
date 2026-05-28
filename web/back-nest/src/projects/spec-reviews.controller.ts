import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface PendingReviewRow {
  projectId: string;
  projectName: string;
  clientName: string;
  phase: string;
  cahierSavedAt: string | null;
  managerName: string | null;
  cahierStatus: 'pending' | 'approved' | 'rejected';
  myLastFeedbackAt: string | null;
}

interface MyReviewRow {
  projectId: string;
  projectName: string;
  clientName: string;
  phase: string;
  verdict: 'approved' | 'rejected';
  comment: string | null;
  reviewedAt: string;
  cahierSavedAt: string | null;
  // false when the PM re-saved the cahier after this verdict (verdict is stale).
  isCurrent: boolean;
}

@Controller('spec')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpecReviewsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /spec/pending-reviews
   *
   * Returns the cahier validation queue for the calling SpecificationTeam user.
   * The spec team is global — a small group handles every project — so ALL
   * non-deleted projects with a saved cahier appear (no per-project assignment).
   * Their `cahierStatus` reflects the user's latest feedback row:
   *   - 'pending' = no feedback yet
   *   - 'approved' = caller approved → row hidden from queue
   *   - 'rejected' = caller rejected the latest cahier → still in queue (PM
   *                  must regenerate)
   */
  @Get('pending-reviews')
  @Roles('Admin', 'SpecificationTeam')
  async listPendingReviews(@Req() req: Request): Promise<PendingReviewRow[]> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;
    if (!userId) return [];

    // Step 1: every non-deleted project that has a saved cahier (global spec team).
    const projects = await this.prisma.project.findMany({
      where: { isDeleted: false, aiOutput: { not: null } },
      select: {
        id: true,
        name: true,
        clientName: true,
        status: true,
        aiOutput: true,
        updatedAt: true,
        projectManager: { select: { firstName: true, lastName: true } },
      },
    });

    if (projects.length === 0) return [];

    const projectIds = projects.map((p) => p.id);

    // Step 2: fetch the caller's most recent feedback per project.
    const feedback = await this.prisma.cahierFeedback.findMany({
      where: { userId, projectId: { in: projectIds } },
      orderBy: { createdAt: 'desc' },
      select: { projectId: true, status: true, createdAt: true },
    });
    const latestByProject = new Map<string, { status: string; createdAt: Date }>();
    for (const f of feedback) {
      if (!latestByProject.has(f.projectId)) {
        latestByProject.set(f.projectId, { status: f.status, createdAt: f.createdAt });
      }
    }

    const rows: PendingReviewRow[] = [];
    for (const p of projects) {
      let cahierSavedAt: string | null = null;
      if (p.aiOutput) {
        try {
          const parsed = JSON.parse(p.aiOutput) as { savedAt?: string };
          cahierSavedAt = parsed.savedAt ?? null;
        } catch {
          /* ignore malformed cahier */
        }
      }

      const last = latestByProject.get(p.id);
      let status: 'pending' | 'approved' | 'rejected' = 'pending';
      let myLastFeedbackAt: string | null = null;
      if (last) {
        myLastFeedbackAt = last.createdAt.toISOString();
        // If cahier was re-saved AFTER the last feedback, treat as pending again.
        if (cahierSavedAt && new Date(cahierSavedAt) > last.createdAt) {
          status = 'pending';
        } else if (last.status === 'approved') {
          status = 'approved';
        } else if (last.status === 'rejected') {
          status = 'rejected';
        }
      }

      // Hide rows the caller already approved (no further action needed).
      if (status === 'approved') continue;

      rows.push({
        projectId: p.id,
        projectName: p.name,
        clientName: p.clientName,
        phase: p.status,
        cahierSavedAt,
        managerName: p.projectManager
          ? `${p.projectManager.firstName} ${p.projectManager.lastName}`
          : null,
        cahierStatus: status,
        myLastFeedbackAt,
      });
    }

    // Most recent cahier first.
    rows.sort((a, b) => (b.cahierSavedAt ?? '').localeCompare(a.cahierSavedAt ?? ''));
    return rows;
  }

  /**
   * GET /spec/my-reviews
   *
   * The calling SpecificationTeam user's review history — every cahier they
   * have approved or rejected, one row per project (their latest verdict).
   * Unlike `/spec/pending-reviews`, approved cahiers are NOT hidden here: this
   * is the "Mes validations" surface where reviewers look back at what they
   * already validated. `isCurrent` is false when the PM re-saved the cahier
   * after the verdict, so the UI can flag that the verdict no longer applies.
   */
  @Get('my-reviews')
  @Roles('Admin', 'SpecificationTeam')
  async listMyReviews(@Req() req: Request): Promise<MyReviewRow[]> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;
    if (!userId) return [];

    // The caller's own feedback, newest first, with the project it targeted.
    const feedback = await this.prisma.cahierFeedback.findMany({
      where: { userId, project: { isDeleted: false } },
      orderBy: { createdAt: 'desc' },
      select: {
        projectId: true,
        status: true,
        comment: true,
        createdAt: true,
        project: { select: { name: true, clientName: true, status: true, aiOutput: true } },
      },
    });

    // Collapse to the latest verdict per project (list is already newest-first).
    const seen = new Set<string>();
    const rows: MyReviewRow[] = [];
    for (const f of feedback) {
      if (seen.has(f.projectId)) continue;
      seen.add(f.projectId);

      let cahierSavedAt: string | null = null;
      if (f.project.aiOutput) {
        try {
          const parsed = JSON.parse(f.project.aiOutput) as { savedAt?: string };
          cahierSavedAt = parsed.savedAt ?? null;
        } catch {
          /* ignore malformed cahier */
        }
      }

      rows.push({
        projectId: f.projectId,
        projectName: f.project.name,
        clientName: f.project.clientName,
        phase: f.project.status,
        verdict: f.status === 'approved' ? 'approved' : 'rejected',
        comment: f.comment ?? null,
        reviewedAt: f.createdAt.toISOString(),
        cahierSavedAt,
        isCurrent: !cahierSavedAt || new Date(cahierSavedAt) <= f.createdAt,
      });
    }

    return rows;
  }
}
