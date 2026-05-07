/**
 * @file project-tools.ts — read-only tools shared by all agents.
 * Each tool fetches a narrow slice of project data so the agent can
 * compose its own context instead of having everything pre-packed.
 */

import type { ToolDefinition } from '../agent-types.js'
import { obj, str, bool, int } from '../json-schema.js'

// ─── Tool: read_project_summary ──────────────────────────────────────────────

interface ProjectSummary {
  id: string
  name: string
  clientName: string
  status: string
  startDate: string
  endDate: string
  projectManager: { firstName: string; lastName: string } | null
  memberCount: number
}

export const readProjectSummaryTool: ToolDefinition<Record<string, never>, ProjectSummary | { error: string }> = {
  name: 'read_project_summary',
  description: 'Get the project name, client, status, dates, PM, and member count. The cheapest way to ground every other reasoning step in the project context.',
  parameters: obj({}, {}),
  handler: async (_args, ctx) => {
    const project = await ctx.prisma.project.findUnique({
      where: { id: ctx.projectId, isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
        _count: { select: { projectMembers: true } },
      },
    })
    if (!project) return { error: 'project_not_found' }
    return {
      id: project.id,
      name: project.name,
      clientName: project.clientName,
      status: project.status,
      startDate: project.startDate.toISOString().slice(0, 10),
      endDate: project.endDate.toISOString().slice(0, 10),
      projectManager: project.projectManager ?? null,
      memberCount: project._count.projectMembers,
    }
  },
}

// ─── Tool: read_questionnaire ────────────────────────────────────────────────

interface QuestionnaireItem {
  label: string
  fieldType: string
  isRequired: boolean
  isBacklogDriver: boolean
  backlogHint: string | null
  value: string | null
}

export const readQuestionnaireTool: ToolDefinition<{ driverOnly?: boolean }, { items: QuestionnaireItem[] }> = {
  name: 'read_questionnaire',
  description: 'List the project\'s questionnaire fields with their answers. Pass `driverOnly: true` to fetch ONLY the fields marked isBacklogDriver=true (recommended for backlog-related work).',
  parameters: obj(
    { driverOnly: bool('When true, return only fields marked isBacklogDriver=true') },
    {},
  ),
  handler: async (args, ctx) => {
    const fields = await ctx.prisma.projectField.findMany({
      where: {
        projectId: ctx.projectId,
        ...(args.driverOnly ? { isBacklogDriver: true } : {}),
      },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    })
    return {
      items: fields.map((f) => ({
        label: f.label,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        isBacklogDriver: f.isBacklogDriver,
        backlogHint: f.backlogHint ?? null,
        value: f.values[0]?.value ?? null,
      })),
    }
  },
}

// ─── Tool: read_validated_cahier ─────────────────────────────────────────────

export const readValidatedCahierTool: ToolDefinition<Record<string, never>, { saved: boolean; aiContent: unknown; savedAt: string | null }> = {
  name: 'read_validated_cahier',
  description: 'Fetch the saved cahier des charges (Project.aiOutput parsed). Returns {saved: false} when no cahier has been generated yet — in that case, do NOT invent epics for non-existent requirements.',
  parameters: obj({}, {}),
  handler: async (_args, ctx) => {
    const project = await ctx.prisma.project.findUnique({
      where: { id: ctx.projectId },
      select: { aiOutput: true },
    })
    if (!project?.aiOutput) return { saved: false, aiContent: null, savedAt: null }
    try {
      const parsed = JSON.parse(project.aiOutput) as { aiContent?: unknown; savedAt?: string }
      return {
        saved: !!parsed.aiContent,
        aiContent: parsed.aiContent ?? null,
        savedAt: parsed.savedAt ?? null,
      }
    } catch {
      return { saved: false, aiContent: null, savedAt: null }
    }
  },
}

// ─── Tool: read_meeting_summaries ────────────────────────────────────────────

interface MeetingSummary {
  date: string
  aiSummary: string
  actionItemsCount: number
  decisionsCount: number
}

export const readMeetingSummariesTool: ToolDefinition<{ limit?: number }, { summaries: MeetingSummary[] }> = {
  name: 'read_meeting_summaries',
  description: 'List the AI-generated summaries of the most recent meetings (default 5, max 10). Lighter than read_meeting_segments — start here unless you need a specific quote or speaker turn.',
  parameters: obj(
    { limit: int({ description: 'Max meetings to return (default 5, max 10)', minimum: 1, maximum: 10 }) },
    {},
  ),
  handler: async (args, ctx) => {
    const limit = Math.min(10, Math.max(1, args.limit ?? 5))
    const transcripts = await ctx.prisma.meetingTranscript.findMany({
      where: {
        projectId: ctx.projectId,
        aiStatus: 'completed',
        aiSummary: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        createdAt: true,
        aiSummary: true,
        _count: { select: { actionItems: true, decisions: true } },
      },
    })
    return {
      summaries: transcripts.map((t) => ({
        date: t.createdAt.toISOString().slice(0, 10),
        aiSummary: (t.aiSummary ?? '').slice(0, 4000),
        actionItemsCount: t._count.actionItems,
        decisionsCount: t._count.decisions,
      })),
    }
  },
}

// ─── Tool: read_past_backlogs ────────────────────────────────────────────────

interface PastWp {
  id: string
  title: string
  type: string
  priority: string
  status: string
  estimatedHours: number | null
  parentId: string | null
}

export const readPastBacklogsTool: ToolDefinition<Record<string, never>, { items: PastWp[] }> = {
  name: 'read_past_backlogs',
  description: 'List existing WorkPackages already created on this project (Epic + Task tree). Use this on re-rolls so you don\'t propose duplicates.',
  parameters: obj({}, {}),
  handler: async (_args, ctx) => {
    const wps = await ctx.prisma.workPackage.findMany({
      where: { projectId: ctx.projectId, isDeleted: false },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      select: {
        id: true, title: true, type: true, priority: true, status: true,
        estimatedHours: true, parentId: true,
      },
    })
    // estimatedHours is Prisma Decimal — coerce to plain number so it serializes cleanly.
    return {
      items: wps.map((w) => ({
        id: w.id,
        title: w.title,
        type: w.type,
        priority: w.priority,
        status: w.status,
        parentId: w.parentId,
        estimatedHours: w.estimatedHours === null ? null : Number(w.estimatedHours),
      })),
    }
  },
}

// ─── Tool: read_validation_feedback ──────────────────────────────────────────

interface FeedbackEntry {
  status: string
  comment: string
  section: string | null
  createdAt: string
}

export const readValidationFeedbackTool: ToolDefinition<{ limit?: number }, { items: FeedbackEntry[] }> = {
  name: 'read_validation_feedback',
  description: 'Read past CahierFeedback rows (rejections/approvals from the spec team). Use this on cahier re-generations to address concrete past complaints.',
  parameters: obj(
    { limit: int({ description: 'Max feedback rows to return (default 10, max 30)', minimum: 1, maximum: 30 }) },
    {},
  ),
  handler: async (args, ctx) => {
    const limit = Math.min(30, Math.max(1, args.limit ?? 10))
    const rows = await ctx.prisma.cahierFeedback.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { status: true, comment: true, section: true, createdAt: true },
    })
    return {
      items: rows.map((r) => ({
        status: r.status,
        comment: r.comment.slice(0, 1000),
        section: r.section,
        createdAt: r.createdAt.toISOString(),
      })),
    }
  },
}
