import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';
import { NotificationsService } from '../notifications/notifications.service.js';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface GenerateTokenDto {
  label?: string;
  expiresInDays: number;
}

export interface SubmitSignoffDto {
  clientName: string;
  clientEmail?: string;
  comment?: string;
  isApproved: boolean;
}

// ─── Read-only portal project shape ──────────────────────────────────────────

export interface PortalProjectView {
  projectName: string;
  clientName: string;
  status: string;
  startDate: Date;
  endDate: Date;
  fieldValues: Array<{ label: string; value: string | null }>;
  signoffs: Array<{
    id: string;
    clientName: string;
    isApproved: boolean;
    comment: string | null;
    signedAt: Date;
  }>;
}

export interface TokenSummary {
  id: string;
  token: string;
  label: string | null;
  url: string;
  expiresAt: Date;
  isRevoked: boolean;
  accessCount: number;
  lastAccessedAt: Date | null;
  createdAt: Date;
  signoffCount: number;
}

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async generateToken(
    projectId: string,
    createdById: string,
    dto: GenerateTokenDto,
  ): Promise<Result<{ id: string; token: string; url: string; expiresAt: Date }>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
    });
    if (!project) return Result.fail('Projet non trouvé.');

    const daysValid = Math.min(Math.max(dto.expiresInDays, 1), 365);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysValid);

    const token = crypto.randomBytes(32).toString('hex');

    const record = await this.prisma.portalToken.create({
      data: {
        id: crypto.randomUUID(),
        projectId,
        token,
        createdById,
        label: dto.label ?? null,
        expiresAt,
      },
    });

    return Result.ok({
      id: record.id,
      token: record.token,
      url: `/portal/${record.token}`,
      expiresAt: record.expiresAt,
    });
  }

  async listTokens(projectId: string): Promise<Result<TokenSummary[]>> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, isDeleted: false },
    });
    if (!project) return Result.fail('Projet non trouvé.');

    const tokens = await this.prisma.portalToken.findMany({
      where: { projectId },
      include: { _count: { select: { signoffs: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return Result.ok(
      tokens.map((t) => ({
        id: t.id,
        token: t.token,
        label: t.label,
        url: `/portal/${t.token}`,
        expiresAt: t.expiresAt,
        isRevoked: t.isRevoked,
        accessCount: t.accessCount,
        lastAccessedAt: t.lastAccessedAt,
        createdAt: t.createdAt,
        signoffCount: t._count.signoffs,
      })),
    );
  }

  async revokeToken(tokenId: string): Promise<Result<void>> {
    const existing = await this.prisma.portalToken.findUnique({ where: { id: tokenId } });
    if (!existing) return Result.fail('Lien non trouvé.');

    await this.prisma.portalToken.update({
      where: { id: tokenId },
      data: { isRevoked: true },
    });

    return Result.ok();
  }

  async validateAndFetchProject(token: string): Promise<PortalProjectView> {
    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      include: {
        project: {
          include: {
            fieldValues: { include: { field: true } },
          },
        },
        signoffs: {
          orderBy: { signedAt: 'desc' },
        },
      },
    });

    if (!record) throw new NotFoundException('Ce lien est invalide ou n\'existe pas.');
    if (record.isRevoked) throw new ForbiddenException('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) throw new ForbiddenException('Ce lien a expiré.');
    if (record.project.isDeleted) throw new NotFoundException('Le projet associé n\'existe plus.');

    // Track access
    await this.prisma.portalToken.update({
      where: { id: record.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });

    const project = record.project;

    // Build safe read-only shape — no user IDs or internal emails
    return {
      projectName: project.name,
      clientName: project.clientName,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      fieldValues: project.fieldValues
        .filter((fv) => fv.value !== null && fv.value !== '')
        .map((fv) => ({
          label: fv.field.label,
          value: fv.value,
        })),
      signoffs: record.signoffs.map((s) => ({
        id: s.id,
        clientName: s.clientName,
        isApproved: s.isApproved,
        comment: s.comment,
        signedAt: s.signedAt,
      })),
    };
  }

  async submitSignoff(
    token: string,
    dto: SubmitSignoffDto,
    ipAddress: string | undefined,
  ): Promise<Result<{ id: string }>> {
    if (!dto.clientName?.trim()) return Result.fail('Le nom est requis.');

    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      include: {
        project: {
          select: { id: true, name: true, projectManagerId: true, isDeleted: true },
        },
      },
    });

    if (!record) return Result.fail('Lien invalide.');
    if (record.isRevoked) return Result.fail('Ce lien a été révoqué.');
    if (record.expiresAt < new Date()) return Result.fail('Ce lien a expiré.');
    if (record.project.isDeleted) return Result.fail('Le projet associé n\'existe plus.');

    const signoff = await this.prisma.portalSignoff.create({
      data: {
        id: crypto.randomUUID(),
        portalTokenId: record.id,
        clientName: dto.clientName.trim(),
        clientEmail: dto.clientEmail?.trim() || null,
        comment: dto.comment?.trim() || null,
        isApproved: dto.isApproved,
        ipAddress: ipAddress ?? null,
      },
    });

    // Notify the project manager if assigned
    if (record.project.projectManagerId) {
      const decision = dto.isApproved ? 'approuvé' : 'refusé';
      void this.notifications.notify(
        record.project.projectManagerId,
        'portal_signoff',
        'Avis client reçu',
        `${dto.clientName} a ${decision} le projet "${record.project.name}" via le portail client.`,
        record.project.id,
      );
    }

    return Result.ok({ id: signoff.id });
  }
}
