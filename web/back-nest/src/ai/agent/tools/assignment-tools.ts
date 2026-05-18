/**
 * @file assignment-tools.ts — read tools for the AI-assisted assignment
 * agent. The agent reads project members + their labels + current load +
 * recent resolved WPs to recommend assignees.
 *
 * Tools take projectId from the closure so the model never has to pass
 * it manually (closure pattern, mirrors transcript-tools / copilot-tools).
 */

import type { ToolDefinition, ToolContext } from '../agent-types.js'
import { obj, str, int } from '../json-schema.js'
import type { PrismaService } from '../../../prisma/prisma.service.js'

interface MemberContext {
  memberId: string
  userId: string
  fullName: string
  email: string
  /** Platform role — coarse signal ("Member" / "SpecificationTeam" / "ProjectManager"). */
  label: string
  /** Free-text job title (e.g. "Senior Backend Engineer", "QA Lead") — strongest skill signal when set. */
  jobTitle: string | null
  /** Free-text department / team (e.g. "Front-end", "Data") — secondary skill signal. */
  department: string | null
  /** Open WPs currently assigned, project-wide (to spot overload). */
  inProgressCount: number
  /** All-time WP count on this project — proxy for familiarity. */
  totalAssignedThisProject: number
  /** Titles of up to 3 most recent Resolved/Closed WPs on this project — strongest signal of what they actually ship. */
  recentResolvedTitles: string[]
}

interface CandidateWp {
  id: string
  title: string
  description: string
  type: string
  priority: string
  estimatedHours: number | null
  sprintName: string | null
}

interface ResolvedSample {
  title: string
  type: string
  estimatedHours: number | null
  resolvedAt: string | null
}

/** Build the assignment tools bound to one project. */
export function buildAssignmentTools(projectId: string, candidateWpIds: string[]): ToolDefinition[] {
  // ── read_candidate_tasks ───────────────────────────────────────────────────
  const readCandidates: ToolDefinition<Record<string, never>, { tasks: CandidateWp[] }> = {
    name: 'read_candidate_tasks',
    description: "List the tasks the PM is trying to assign — title, description, type, priority, estimated hours, sprint. Always start by calling this once.",
    parameters: obj({}, {}),
    handler: async (_args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const wps = await prisma.workPackage.findMany({
        where: { id: { in: candidateWpIds }, projectId, isDeleted: false },
        include: { sprint: { select: { name: true } } },
      })
      return {
        tasks: wps.map((w) => ({
          id: w.id,
          title: w.title,
          description: (w.description ?? '').slice(0, 600),
          type: w.type,
          priority: w.priority,
          estimatedHours: w.estimatedHours === null ? null : Number(w.estimatedHours),
          sprintName: w.sprint?.name ?? null,
        })),
      }
    },
  }

  // ── read_project_members ───────────────────────────────────────────────────
  // Enumerates every user assignable on this project. Per-project team
  // selection was removed, so the eligible set is broad: every active
  // Member / SpecificationTeam user, plus this project's PM (so they can
  // assign themselves). Admins and PMs from OTHER projects are excluded —
  // they have no place on this project's task board. Mirrors the exact
  // union the write path enforces (WorkPackagesService.bulkAssign) so
  // suggestions never name a user the write will reject.
  //
  // We pre-load every signal the model needs in a single payload (jobTitle,
  // department, in-progress load, lifetime project load, up to 3 recent
  // Resolved/Closed WP titles on this project) so it doesn't have to make
  // N follow-up read_member_history calls.
  const readMembers: ToolDefinition<Record<string, never>, { members: MemberContext[] }> = {
    name: 'read_project_members',
    description: "List every user eligible to be assigned a task on this project (Member + SpecificationTeam + the project's own PM; admins and other-project PMs are excluded). Each entry includes: `label` (platform role — coarse signal), `jobTitle` (strongest signal — the user's role at the company), `department`, `inProgressCount` (current open WPs project-wide — avoid overload), `totalAssignedThisProject` (familiarity with this project), and `recentResolvedTitles` (the strongest skill evidence — what they've actually shipped). Lean on jobTitle and recentResolvedTitles. Fall back to read_member_history only when recentResolvedTitles is empty AND jobTitle is ambiguous.",
    parameters: obj({}, {}),
    handler: async (_args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const project = await prisma.project.findFirst({
        where: { id: projectId, isDeleted: false },
        select: { projectManagerId: true },
      })
      if (!project) return { members: [] }

      const users = await prisma.appUser.findMany({
        where: {
          isActive: true,
          OR: [
            { role: { in: ['Member', 'SpecificationTeam'] } },
            ...(project.projectManagerId ? [{ id: project.projectManagerId }] : []),
          ],
        },
        select: {
          id: true, firstName: true, lastName: true, email: true,
          role: true, jobTitle: true, department: true,
        },
        orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      })
      if (users.length === 0) return { members: [] }

      const userIds = users.map((u) => u.id)
      const [inProgressCounts, totalCounts, recentResolved] = await Promise.all([
        prisma.workPackage.groupBy({
          by: ['assigneeId'],
          where: {
            projectId, isDeleted: false,
            status: 'InProgress',
            assigneeId: { in: userIds },
          },
          _count: { _all: true },
        }),
        prisma.workPackage.groupBy({
          by: ['assigneeId'],
          where: {
            projectId, isDeleted: false,
            assigneeId: { in: userIds },
          },
          _count: { _all: true },
        }),
        // 3 most recent Resolved/Closed WP titles per assignee on this
        // project. Fetched in one batched query — we deduplicate + cap
        // client-side. Much cheaper than N read_member_history follow-ups.
        prisma.workPackage.findMany({
          where: {
            projectId, isDeleted: false,
            status: { in: ['Resolved', 'Closed', 'Done'] },
            assigneeId: { in: userIds },
          },
          select: { assigneeId: true, title: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
          take: userIds.length * 3,
        }),
      ])
      const inProgMap = new Map(inProgressCounts.map((c) => [c.assigneeId, c._count._all]))
      const totalMap = new Map(totalCounts.map((c) => [c.assigneeId, c._count._all]))
      const recentByUser = new Map<string, string[]>()
      for (const wp of recentResolved) {
        if (!wp.assigneeId) continue
        const bucket = recentByUser.get(wp.assigneeId) ?? []
        if (bucket.length < 3) {
          bucket.push(wp.title)
          recentByUser.set(wp.assigneeId, bucket)
        }
      }

      return {
        members: users.map((u) => ({
          memberId: u.id,
          userId: u.id,
          fullName: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email,
          label: u.role,
          jobTitle: u.jobTitle ?? null,
          department: u.department ?? null,
          inProgressCount: inProgMap.get(u.id) ?? 0,
          totalAssignedThisProject: totalMap.get(u.id) ?? 0,
          recentResolvedTitles: recentByUser.get(u.id) ?? [],
        })),
      }
    },
  }

  // ── read_member_history ────────────────────────────────────────────────────
  const readHistory: ToolDefinition<{ memberId: string; limit?: number }, { resolved: ResolvedSample[] }> = {
    name: 'read_member_history',
    description: "Recent WPs this member has Resolved or Closed on this project. Use this to assess what kind of work they've done before. Title is the strongest signal.",
    parameters: obj(
      {
        memberId: str({ description: 'A `userId` from read_project_members. NOT the member-row id.' }),
        limit: int({ description: 'Max items to return (default 10, max 20)', minimum: 1, maximum: 20 }),
      },
      { required: ['memberId'] },
    ),
    handler: async (args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const limit = Math.min(20, Math.max(1, args.limit ?? 10))
      const wps = await prisma.workPackage.findMany({
        where: {
          projectId, isDeleted: false,
          assigneeId: args.memberId,
          status: { in: ['Resolved', 'Closed'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: { title: true, type: true, estimatedHours: true, updatedAt: true },
      })
      return {
        resolved: wps.map((w) => ({
          title: w.title,
          type: w.type,
          estimatedHours: w.estimatedHours === null ? null : Number(w.estimatedHours),
          resolvedAt: w.updatedAt?.toISOString() ?? null,
        })),
      }
    },
  }

  return [readCandidates, readMembers, readHistory]
}
