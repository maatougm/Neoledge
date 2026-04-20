import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listPortfolios() {
    try {
      const items = await this.prisma.portfolio.findMany({
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { projects: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return Result.ok(items);
    } catch {
      return Result.fail('Échec du chargement.');
    }
  }

  async getPortfolio(id: string) {
    try {
      const p = await this.prisma.portfolio.findUnique({
        where: { id },
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          projects: {
            orderBy: { position: 'asc' },
            include: {
              project: {
                select: {
                  id: true, name: true, clientName: true, status: true, priority: true,
                  startDate: true, endDate: true, projectManagerId: true,
                  projectManager: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      });
      if (!p) return Result.fail('Portfolio introuvable.');
      return Result.ok(p);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async createPortfolio(dto: { name: string; description?: string }, userId: string) {
    try {
      const p = await this.prisma.portfolio.create({
        data: { name: dto.name, description: dto.description ?? null, createdById: userId },
      });
      return Result.ok(p);
    } catch (e) {
      this.logger.error('createPortfolio failed', e);
      return Result.fail('Échec de la création.');
    }
  }

  async updatePortfolio(id: string, dto: { name?: string; description?: string }) {
    try {
      const p = await this.prisma.portfolio.update({ where: { id }, data: dto });
      return Result.ok(p);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async deletePortfolio(id: string) {
    // Verify existence before deletion so we can distinguish 404 from other errors.
    const existing = await this.prisma.portfolio.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!existing) return Result.fail<void>('Portfolio introuvable.');

    try {
      await this.prisma.portfolio.delete({ where: { id } });
      this.logger.log(`Portfolio deleted: id=${id} name="${existing.name}"`);
      return Result.ok<void>();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') return Result.fail<void>('Portfolio introuvable.');
        if (e.code === 'P2003') return Result.fail<void>('Impossible de supprimer : des références existent encore.');
      }
      this.logger.error('deletePortfolio failed', e);
      return Result.fail<void>('Échec de la suppression du portfolio.');
    }
  }

  async addProject(portfolioId: string, projectId: string, position?: number) {
    try {
      const max = await this.prisma.portfolioProject.aggregate({
        where: { portfolioId }, _max: { position: true },
      });
      const pp = await this.prisma.portfolioProject.create({
        data: { portfolioId, projectId, position: position ?? (max._max.position ?? -1) + 1 },
      });
      return Result.ok(pp);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async removeProject(portfolioId: string, projectId: string) {
    try {
      await this.prisma.portfolioProject.deleteMany({ where: { portfolioId, projectId } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async reorderProjects(portfolioId: string, order: string[]) {
    if (!Array.isArray(order) || order.length === 0) {
      return Result.fail<void>('La liste de réordonnancement est invalide.');
    }

    try {
      // Validate that all supplied project IDs actually belong to this portfolio.
      const existing = await this.prisma.portfolioProject.findMany({
        where: { portfolioId },
        select: { projectId: true },
      });
      const knownIds = new Set(existing.map((p) => p.projectId));
      const unknown = order.filter((id) => !knownIds.has(id));
      if (unknown.length > 0) {
        return Result.fail<void>(`Projet(s) inconnu(s) dans ce portfolio : ${unknown.join(', ')}`);
      }

      // Run all position updates atomically.
      await this.prisma.$transaction(
        order.map((projectId, idx) =>
          this.prisma.portfolioProject.updateMany({
            where: { portfolioId, projectId },
            data: { position: idx },
          }),
        ),
      );
      return Result.ok<void>();
    } catch (e) {
      this.logger.error('reorderProjects failed', e);
      return Result.fail<void>('Échec du réordonnancement.');
    }
  }

  async getRoadmap(portfolioId: string) {
    try {
      const pf = await this.prisma.portfolio.findUnique({
        where: { id: portfolioId },
        include: {
          projects: {
            orderBy: { position: 'asc' },
            include: {
              project: {
                select: {
                  id: true, name: true, status: true, startDate: true, endDate: true,
                  versions: true,
                  milestones: true,
                },
              },
            },
          },
        },
      });
      if (!pf) return Result.fail('Portfolio introuvable.');
      return Result.ok(pf);
    } catch {
      return Result.fail('Échec.');
    }
  }

  // Versions
  async listVersions(projectId: string) {
    try {
      const versions = await this.prisma.version.findMany({
        where: { projectId },
        include: { _count: { select: { workPackages: true } } },
        orderBy: { position: 'asc' },
      });
      return Result.ok(versions);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async createVersion(projectId: string, dto: { name: string; description?: string; startDate?: string; endDate?: string }) {
    try {
      const max = await this.prisma.version.aggregate({ where: { projectId }, _max: { position: true } });
      const v = await this.prisma.version.create({
        data: {
          projectId,
          name: dto.name,
          description: dto.description ?? null,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          status: 'Open',
          position: (max._max.position ?? -1) + 1,
        },
      });
      return Result.ok(v);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async updateVersion(id: string, dto: { name?: string; description?: string; startDate?: string; endDate?: string; status?: string }) {
    try {
      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
      if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
      if (dto.status !== undefined) data.status = dto.status;
      const v = await this.prisma.version.update({ where: { id }, data });
      return Result.ok(v);
    } catch {
      return Result.fail('Échec.');
    }
  }

  async deleteVersion(id: string) {
    try {
      await this.prisma.version.delete({ where: { id } });
      return Result.ok<void>();
    } catch {
      return Result.fail<void>('Échec.');
    }
  }

  async lockVersion(id: string) {
    return this.updateVersion(id, { status: 'Locked' });
  }

  async closeVersion(id: string) {
    return this.updateVersion(id, { status: 'Closed' });
  }

  async getVersionProgress(id: string) {
    try {
      const v = await this.prisma.version.findUnique({
        where: { id },
        include: { workPackages: { select: { status: true, spentHours: true, estimatedHours: true } } },
      });
      if (!v) return Result.fail('Version introuvable.');
      const total = v.workPackages.length;
      const done = v.workPackages.filter((wp) => wp.status === 'Closed' || wp.status === 'Resolved').length;
      const spentHours = v.workPackages.reduce((s, wp) => s + Number(wp.spentHours), 0);
      const estimatedHours = v.workPackages.reduce((s, wp) => s + Number(wp.estimatedHours ?? 0), 0);
      return Result.ok({ total, done, spentHours, estimatedHours, percent: total ? Math.round((done / total) * 100) : 0 });
    } catch {
      return Result.fail('Échec.');
    }
  }
}
