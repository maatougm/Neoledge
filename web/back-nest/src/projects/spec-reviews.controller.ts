import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../common/guards/permissions.guard.js';
import { RequirePermission } from '../common/decorators/require-permission.decorator.js';
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

@Controller('spec')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SpecReviewsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /spec/pending-reviews
   *
   * Returns the cahier validation queue for the calling SpecificationTeam user.
   * Only projects where the caller is in `ProjectMember` AND has a saved cahier
   * appear. Their `cahierStatus` reflects the user's latest feedback row:
   *   - 'pending' = no feedback yet
   *   - 'approved' = caller approved → row hidden from queue
   *   - 'rejected' = caller rejected the latest cahier → still in queue (PM
   *                  must regenerate)
   */
  @Get('pending-reviews')
  @RequirePermission('project.validate')
  async listPendingReviews(@Req() req: Request): Promise<PendingReviewRow[]> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;
    if (!userId) return [];

    // Step 1: projects where this user is a member AND a cahier has been saved.
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        project: { isDeleted: false, aiOutput: { not: null } },
      },
      select: {
        project: {
          select: {
            id: true,
            name: true,
            clientName: true,
            status: true,
            aiOutput: true,
            updatedAt: true,
            projectManager: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    if (memberships.length === 0) return [];

    const projectIds = memberships.map((m) => m.project.id);

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
    for (const m of memberships) {
      const p = m.project;
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
}
