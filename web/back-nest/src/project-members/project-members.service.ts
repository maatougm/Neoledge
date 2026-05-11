import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service.js'
import { Result } from '../common/result.js'
import { NotificationsService } from '../notifications/notifications.service.js'

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

export interface MembersListResponse {
  members: MemberRow[]
  /** Project's PM userId — the UI hides them from the "add" candidate
   *  dropdown because they already have full access. */
  projectManagerId: string | null
}

@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(projectId: string): Promise<Result<MembersListResponse>> {
    const [project, rows] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { projectManagerId: true },
      }),
      this.prisma.projectMember.findMany({
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
      }),
    ])
    return Result.ok({
      members: rows as MemberRow[],
      projectManagerId: project?.projectManagerId ?? null,
    })
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

      // Welcome notification — without this, members were silently added
      // and had to discover the project on their own from the team-home list.
      void this.prisma.project
        .findUnique({ where: { id: projectId }, select: { name: true } })
        .then((p) => {
          if (!p) return
          return this.notifications.notifyEnhanced({
            userId,
            type: 'project_member_added',
            reason: 'System',
            title: 'Ajouté à un projet',
            message: `Vous avez été ajouté(e) au projet « ${p.name} »${label ? ` en tant que ${label}` : ''}.`,
            projectId,
            entityType: 'project',
            entityId: projectId,
            link: `/app/team/projects/${projectId}`,
          })
        })
        .catch((e) =>
          this.logger.warn(`member-added notify failed: ${e instanceof Error ? e.message : String(e)}`),
        )

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

  async remove(
    memberId: string,
    opts: { force?: boolean; reassignTo?: string; actorId?: string } = {},
  ): Promise<Result<void>> {
    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      select: {
        id: true, projectId: true, userId: true,
        project: { select: { name: true } },
      },
    })
    if (!member) return Result.fail('Membre introuvable')

    // Run blocker check + delete inside a single transaction so a concurrent
    // assignment can't slip in between the count and the delete.
    let blockersForReply: { workPackages: number; timeEntries: number; watchers: number; attendees: number } | null = null
    // Track how many WPs got moved so we can fire notifications *after* the tx.
    let reassignedCount = 0
    let unassignedCount = 0

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

          const r = await tx.workPackage.updateMany({
            where: { projectId: member.projectId, assigneeId: member.userId },
            data: { assigneeId: opts.reassignTo, updatedAt: new Date() },
          })
          reassignedCount = r.count
        } else if (opts.force) {
          // Null out the assignee — task becomes unassigned
          const r = await tx.workPackage.updateMany({
            where: { projectId: member.projectId, assigneeId: member.userId },
            data: { assigneeId: null, updatedAt: new Date() },
          })
          unassignedCount = r.count
        }

        // Always remove the membership row last
        await tx.projectMember.delete({ where: { id: memberId } })
      })

      // Post-transaction notifications — never block the response.
      const projectName = member.project?.name ?? 'le projet'
      // Notify the removed member.
      void this.notifications.notifyEnhanced({
        userId: member.userId,
        type: 'project_member_removed',
        reason: 'System',
        title: 'Retiré du projet',
        message: `Vous avez été retiré du projet « ${projectName} ».`,
        // No projectId here — the scope check would reject (they're no longer
        // a member). The notification still surfaces in their inbox.
        entityType: 'project',
        entityId: member.projectId,
        actorId: opts.actorId ?? null,
        link: null,
      }).catch((e) =>
        this.logger.warn(`remove member notify (removed user) failed: ${e instanceof Error ? e.message : String(e)}`),
      )
      // Notify the takeover assignee that they inherited tasks.
      if (opts.reassignTo && reassignedCount > 0) {
        void this.notifications.notifyEnhanced({
          userId: opts.reassignTo,
          type: 'wp_bulk_assigned',
          reason: 'Assignee',
          title: 'Tâches transférées',
          message: `${reassignedCount} tâche(s) vous ont été transférées sur « ${projectName} » suite au départ d'un membre.`,
          projectId: member.projectId,
          entityType: 'project',
          entityId: member.projectId,
          actorId: opts.actorId ?? null,
          link: `/app/team/my-tasks?projectId=${member.projectId}`,
        }).catch((e) =>
          this.logger.warn(`remove member notify (takeover) failed: ${e instanceof Error ? e.message : String(e)}`),
        )
      }

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
