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
}

@Controller('spec')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SpecReviewsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /spec/pending-reviews
   *
   * Returns projects whose cahier des charges has been generated
   * but the caller (a SpecificationTeam reviewer) has not yet submitted
   * a ProjectValidation for the current phase.
   */
  @Get('pending-reviews')
  @RequirePermission('project.validate')
  async listPendingReviews(@Req() req: Request): Promise<PendingReviewRow[]> {
    const userId = (req as unknown as { user?: { userId?: string } }).user?.userId;
    if (!userId) return [];

    const projects = await this.prisma.project.findMany({
      where: {
        isDeleted: false,
        aiOutput: { not: null },
      },
      select: {
        id: true,
        name: true,
        clientName: true,
        status: true,
        aiOutput: true,
        projectManager: { select: { firstName: true, lastName: true } },
        validations: {
          where: { validatedByUserId: userId },
          select: { phase: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const rows: PendingReviewRow[] = [];
    for (const p of projects) {
      const alreadyValidated = p.validations.some((v) => v.phase === p.status);
      if (alreadyValidated) continue;

      let cahierSavedAt: string | null = null;
      if (p.aiOutput) {
        try {
          const parsed = JSON.parse(p.aiOutput) as { savedAt?: string };
          cahierSavedAt = parsed.savedAt ?? null;
        } catch {
          cahierSavedAt = null;
        }
      }

      rows.push({
        projectId: p.id,
        projectName: p.name,
        clientName: p.clientName,
        phase: p.status,
        cahierSavedAt,
        managerName: p.projectManager
          ? `${p.projectManager.firstName} ${p.projectManager.lastName}`
          : null,
      });
    }

    return rows;
  }
}
