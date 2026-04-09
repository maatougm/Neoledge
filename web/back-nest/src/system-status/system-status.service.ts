import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface SystemStatusDto {
  databaseStatus: string;
  userTotal: number;
  userActive: number;
  projectTotal: number;
  projectByStatus: Record<string, number>;
}

@Injectable()
export class SystemStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(): Promise<SystemStatusDto> {
    // Verify DB connectivity
    let databaseStatus = 'Connecté';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseStatus = 'Erreur';
    }

    const [userTotal, userActive, projectTotal, projectsByStatus] =
      await Promise.all([
        this.prisma.appUser.count(),
        this.prisma.appUser.count({ where: { isActive: true } }),
        this.prisma.project.count(),
        this.prisma.project.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

    const projectByStatus: Record<string, number> = {};
    for (const row of projectsByStatus) {
      projectByStatus[row.status] = row._count._all;
    }

    return {
      databaseStatus,
      userTotal,
      userActive,
      projectTotal,
      projectByStatus,
    };
  }
}
