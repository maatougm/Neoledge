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
    jobTitle: string | null
    lastLoginAt: Date | null
    isActive: boolean
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
            jobTitle: true,
            lastLoginAt: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    return Result.ok(rows as MemberRow[])
  }

  async add(projectId: string, userId: string, label: string): Promise<Result<{ id: string }>> {
    // Project-coherence checks before the insert:
    //  - Refuse to add the project's PM (they already have full access — adding
    //    them as a member is meaningless and confusing in the UI).
    //  - Refuse to add inactive users.
    //  - Refuse to add Admins (they're system-wide; per-project label is meaningless).
    const [project, target] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, projectManagerId: true, isDeleted: true },
      }),
      this.prisma.appUser.findUnique({
        where: { id: userId },
        select: { id: true, isActive: true, role: true },
      }),
    ])
    if (!project || project.isDeleted) return Result.fail('Projet introuvable')
    if (!target) return Result.fail('Utilisateur introuvable')
    if (!target.isActive) return Result.fail('Cet utilisateur est désactivé')
    if (target.role === 'Admin') return Result.fail('Les administrateurs n\'ont pas besoin d\'être ajoutés à un projet')
    if (project.projectManagerId === userId) return Result.fail('Le chef de projet n\'a pas besoin d\'être ajouté comme membre')

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

  async remove(memberId: string, opts: { force?: boolean; reassignTo?: string } = {}): Promise<Result<void>> {
    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      select: { id: true, projectId: true, userId: true },
    })
    if (!member) return Result.fail('Membre introuvable')

    // Run blocker check + delete inside a single transaction so a concurrent
    // assignment can't slip in between the count and the delete.
    let blockersForReply: { workPackages: number; timeEntries: number; watchers: number; attendees: number } | null = null

    try {
      await this.prisma.$transaction(async (tx) => {
        const [workPackages, timeEntries, watchers, attendees] = await Promise.all([
          tx.workPackage.count({ where: { projectId: member.projectId, assigneeId: member.userId, isDeleted: false } }),
          tx.timeEntry.count({ where: { projectId: member.projectId, userId: member.userId } }),
          tx.workPackageWatcher.count({ where: { workPackage: { projectId: member.projectId }, userId: member.userId } }),
          tx.meetingAttendee.count({ where: { meeting: { projectId: member.projectId }, userId: member.userId } }),
        ])
        const total = workPackages + timeEntries + watchers + attendees
        if (total > 0 && !opts.force && !opts.reassignTo) {
          blockersForReply = { workPackages, timeEntries, watchers, attendees }
          // Throw a sentinel so the transaction rolls back; we'll convert it below.
          throw new Error('__BLOCKERS__')
        }

        if (opts.reassignTo) {
          // Verify reassignTo is a member of the project
          const newMember = await tx.projectMember.findUnique({
            where: { project_member_uq: { projectId: member.projectId, userId: opts.reassignTo } },
            select: { id: true },
          })
          if (!newMember) throw new Error('Le membre de remplacement n\'est pas dans le projet')

          await tx.workPackage.updateMany({
            where: { projectId: member.projectId, assigneeId: member.userId },
            data: { assigneeId: opts.reassignTo, updatedAt: new Date() },
          })
        } else if (opts.force) {
          // Null out the assignee — task becomes unassigned
          await tx.workPackage.updateMany({
            where: { projectId: member.projectId, assigneeId: member.userId },
            data: { assigneeId: null, updatedAt: new Date() },
          })
        }

        // Always remove the membership row last
        await tx.projectMember.delete({ where: { id: memberId } })
      })
      return Result.ok()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === '__BLOCKERS__' && blockersForReply) {
        return Result.fail(`BLOCKERS:${JSON.stringify(blockersForReply)}`)
      }
      this.logger.error(`remove member failed: ${msg}`)
      return Result.fail(msg.includes('remplacement') ? msg : 'Erreur lors de la suppression')
    }
  }
}
