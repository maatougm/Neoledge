import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'

export interface MemberRow {
  id: string
  userId: string
  label: string
  createdAt: Date
  user: {
    id: string
    firstName: string
    lastName: string
    email: string
    avatarPath: string | null
    role: string
  }
}

@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name)

  constructor(private readonly prisma: PrismaService) {}

  async findAll(projectId: string): Promise<Result<MemberRow[]>> {
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarPath: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    return Result.ok(rows as MemberRow[])
  }

  async add(projectId: string, userId: string, label: string): Promise<Result<{ id: string }>> {
    try {
      const row = await this.prisma.projectMember.create({
        data: {
          id: crypto.randomUUID(),
          projectId,
          userId,
          label,
        },
        select: { id: true },
      })
      return Result.ok({ id: row.id })
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') return Result.fail('Ce membre est déjà dans le projet')
        if (err.code === 'P2003') return Result.fail('Utilisateur introuvable')
      }
      this.logger.error(`add member failed: ${err instanceof Error ? err.message : String(err)}`)
      return Result.fail('Erreur lors de l\'ajout du membre')
    }
  }

  async updateLabel(memberId: string, label: string): Promise<Result<void>> {
    try {
      await this.prisma.projectMember.update({
        where: { id: memberId },
        data: { label },
      })
      return Result.ok()
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return Result.fail('Membre introuvable')
      }
      this.logger.error(`updateLabel failed: ${err instanceof Error ? err.message : String(err)}`)
      return Result.fail('Erreur lors de la mise à jour')
    }
  }

  async remove(memberId: string): Promise<Result<void>> {
    try {
      await this.prisma.projectMember.delete({ where: { id: memberId } })
      return Result.ok()
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return Result.fail('Membre introuvable')
      }
      this.logger.error(`remove member failed: ${err instanceof Error ? err.message : String(err)}`)
      return Result.fail('Erreur lors de la suppression')
    }
  }
}
