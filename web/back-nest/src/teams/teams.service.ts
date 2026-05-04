import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Result } from '../common/result.js';

export interface TeamDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly managerUserId: string | null;
  readonly createdAt: Date;
}

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Result<TeamDto[]>> {
    try {
      const teams = await this.prisma.team.findMany({
        orderBy: { code: 'asc' },
      });

      const dtos: TeamDto[] = teams.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        managerUserId: t.managerUserId,
        createdAt: t.createdAt,
      }));

      return Result.ok(dtos);
    } catch (err) {
      return Result.fail(err instanceof Error ? err.message : 'Failed to fetch teams');
    }
  }
}
