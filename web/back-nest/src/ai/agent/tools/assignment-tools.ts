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
  label: string
  inProgressCount: number
  totalAssignedThisProject: number
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
  const readMembers: ToolDefinition<Record<string, never>, { members: MemberContext[] }> = {
    name: 'read_project_members',
    description: "List every member of this project with their label (e.g. 'Senior backend', 'QA', 'Frontend lead'), current in-progress task count, and total tasks ever assigned to them on this project. Use the labels to match skills against task content.",
    parameters: obj({}, {}),
    handler: async (_args, ctx: ToolContext) => {
      const prisma = ctx.prisma as PrismaService
      const members = await prisma.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
      })
      if (members.length === 0) return { members: [] }

      const userIds = members.map((m) => m.userId)
      const [inProgressCounts, totalCounts] = await Promise.all([
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
      ])
      const inProgMap = new Map(inProgressCounts.map((c) => [c.assigneeId, c._count._all]))
      const totalMap = new Map(totalCounts.map((c) => [c.assigneeId, c._count._all]))

      return {
        members: members.map((m) => ({
          memberId: m.id,
          userId: m.userId,
          fullName: `${m.user.firstName} ${m.user.lastName}`.trim(),
          email: m.user.email,
          label: m.label ?? '',
          inProgressCount: inProgMap.get(m.userId) ?? 0,
          totalAssignedThisProject: totalMap.get(m.userId) ?? 0,
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
