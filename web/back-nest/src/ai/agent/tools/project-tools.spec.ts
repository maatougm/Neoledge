/**
 * @file project-tools.spec.ts — unit tests for the 6 read-only tools in
 *  `project-tools.ts`. Each tool is a plain `ToolDefinition` object — we
 *  call its `handler(args, ctx)` directly with a stub `ToolContext`
 *  whose `prisma` is a jest-mocked PrismaService.
 */

import { Logger } from '@nestjs/common'
import type { ToolContext } from '../agent-types.js'
import {
  readProjectSummaryTool,
  readQuestionnaireTool,
  readValidatedCahierTool,
  readMeetingSummariesTool,
  readPastBacklogsTool,
  readValidationFeedbackTool,
} from './project-tools.js'

// ─── Mock factories ──────────────────────────────────────────────────────────

interface MockPrisma {
  project: { findUnique: jest.Mock }
  projectField: { findMany: jest.Mock }
  meetingTranscript: { findMany: jest.Mock }
  workPackage: { findMany: jest.Mock }
  cahierFeedback: { findMany: jest.Mock }
}

function makeMockPrisma(): MockPrisma {
  return {
    project: { findUnique: jest.fn() },
    projectField: { findMany: jest.fn() },
    meetingTranscript: { findMany: jest.fn() },
    workPackage: { findMany: jest.fn() },
    cahierFeedback: { findMany: jest.fn() },
  }
}

function makeCtx(prisma: MockPrisma, projectId = 'proj-1'): ToolContext {
  return {
    projectId,
    logger: new Logger('project-tools-spec'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma: prisma as any,
    maxResultChars: 8000,
  }
}

// ─── readProjectSummaryTool ──────────────────────────────────────────────────

describe('readProjectSummaryTool', () => {
  let prisma: MockPrisma

  beforeEach(() => {
    prisma = makeMockPrisma()
  })

  it('returns a flat ProjectSummary on the happy path', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'Test Project',
      clientName: 'ACME',
      status: 'Active',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      projectManager: { firstName: 'Alice', lastName: 'PM' },
      _count: { projectMembers: 5 },
    })

    const out = await readProjectSummaryTool.handler({}, makeCtx(prisma))

    expect(prisma.project.findUnique).toHaveBeenCalledWith({
      where: { id: 'proj-1', isDeleted: false },
      include: {
        projectManager: { select: { firstName: true, lastName: true } },
        _count: { select: { projectMembers: true } },
      },
    })
    expect(out).toEqual({
      id: 'proj-1',
      name: 'Test Project',
      clientName: 'ACME',
      status: 'Active',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      projectManager: { firstName: 'Alice', lastName: 'PM' },
      memberCount: 5,
    })
  })

  it("returns { error: 'project_not_found' } when prisma returns null", async () => {
    prisma.project.findUnique.mockResolvedValue(null)
    const out = await readProjectSummaryTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ error: 'project_not_found' })
  })

  it('returns projectManager:null when the project has no PM', async () => {
    prisma.project.findUnique.mockResolvedValue({
      id: 'p', name: 'n', clientName: 'c', status: 's',
      startDate: new Date('2026-03-15T00:00:00.000Z'),
      endDate: new Date('2026-04-15T00:00:00.000Z'),
      projectManager: null,
      _count: { projectMembers: 0 },
    })
    const out = await readProjectSummaryTool.handler({}, makeCtx(prisma))
    expect(out).toMatchObject({ projectManager: null, memberCount: 0 })
  })
})

// ─── readQuestionnaireTool ───────────────────────────────────────────────────

describe('readQuestionnaireTool', () => {
  let prisma: MockPrisma

  beforeEach(() => { prisma = makeMockPrisma() })

  it('returns every field (no driverOnly filter) ordered by orderIndex', async () => {
    prisma.projectField.findMany.mockResolvedValue([
      { label: 'A', fieldType: 'Text', isRequired: true,  isBacklogDriver: true,  backlogHint: 'hintA', values: [{ value: 'aaa' }] },
      { label: 'B', fieldType: 'Long', isRequired: false, isBacklogDriver: false, backlogHint: null,    values: [] },
    ])
    const out = await readQuestionnaireTool.handler({}, makeCtx(prisma))

    expect(prisma.projectField.findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    })
    expect(out.items).toEqual([
      { label: 'A', fieldType: 'Text', isRequired: true,  isBacklogDriver: true,  backlogHint: 'hintA', value: 'aaa' },
      { label: 'B', fieldType: 'Long', isRequired: false, isBacklogDriver: false, backlogHint: null,    value: null },
    ])
  })

  it('filters to driverOnly when arg is true', async () => {
    prisma.projectField.findMany.mockResolvedValue([])
    await readQuestionnaireTool.handler({ driverOnly: true }, makeCtx(prisma))
    expect(prisma.projectField.findMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1', isBacklogDriver: true },
      orderBy: { orderIndex: 'asc' },
      include: { values: { select: { value: true } } },
    })
  })

  it('does NOT add the driverOnly filter when arg is false', async () => {
    prisma.projectField.findMany.mockResolvedValue([])
    await readQuestionnaireTool.handler({ driverOnly: false }, makeCtx(prisma))
    expect(prisma.projectField.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'proj-1' } }),
    )
  })

  it('returns { items: [] } when no fields exist', async () => {
    prisma.projectField.findMany.mockResolvedValue([])
    const out = await readQuestionnaireTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ items: [] })
  })
})

// ─── readValidatedCahierTool ─────────────────────────────────────────────────

describe('readValidatedCahierTool', () => {
  let prisma: MockPrisma

  beforeEach(() => { prisma = makeMockPrisma() })

  it("returns { saved: false } when project has no aiOutput", async () => {
    prisma.project.findUnique.mockResolvedValue({ aiOutput: null })
    const out = await readValidatedCahierTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ saved: false, aiContent: null, savedAt: null })
  })

  it('returns { saved: false } when project does not exist', async () => {
    prisma.project.findUnique.mockResolvedValue(null)
    const out = await readValidatedCahierTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ saved: false, aiContent: null, savedAt: null })
  })

  it('returns the parsed cahier when aiOutput is valid JSON with aiContent', async () => {
    prisma.project.findUnique.mockResolvedValue({
      aiOutput: JSON.stringify({ aiContent: { contexte: 'X' }, savedAt: '2026-05-10T12:00:00.000Z' }),
    })
    const out = await readValidatedCahierTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({
      saved: true,
      aiContent: { contexte: 'X' },
      savedAt: '2026-05-10T12:00:00.000Z',
    })
  })

  it('returns { saved: false } when aiOutput is malformed JSON', async () => {
    prisma.project.findUnique.mockResolvedValue({ aiOutput: 'not json {{{' })
    const out = await readValidatedCahierTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ saved: false, aiContent: null, savedAt: null })
  })

  it('treats missing aiContent in parsed JSON as not-saved', async () => {
    prisma.project.findUnique.mockResolvedValue({ aiOutput: JSON.stringify({ savedAt: '2026-01-01' }) })
    const out = await readValidatedCahierTool.handler({}, makeCtx(prisma))
    expect(out.saved).toBe(false)
    expect(out.aiContent).toBe(null)
    expect(out.savedAt).toBe('2026-01-01')
  })
})

// ─── readMeetingSummariesTool ────────────────────────────────────────────────

describe('readMeetingSummariesTool', () => {
  let prisma: MockPrisma

  beforeEach(() => { prisma = makeMockPrisma() })

  it('returns trimmed summaries with default limit=5', async () => {
    prisma.meetingTranscript.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
        aiSummary: 'Summary 1',
        _count: { actionItems: 2, decisions: 1 },
      },
      {
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        aiSummary: 'Summary 2',
        _count: { actionItems: 0, decisions: 0 },
      },
    ])

    const out = await readMeetingSummariesTool.handler({}, makeCtx(prisma))

    expect(prisma.meetingTranscript.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'proj-1',
          aiStatus: 'completed',
          aiSummary: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    )
    expect(out.summaries).toEqual([
      { date: '2026-03-01', aiSummary: 'Summary 1', actionItemsCount: 2, decisionsCount: 1 },
      { date: '2026-02-01', aiSummary: 'Summary 2', actionItemsCount: 0, decisionsCount: 0 },
    ])
  })

  it('clamps limit to [1, 10]', async () => {
    prisma.meetingTranscript.findMany.mockResolvedValue([])
    await readMeetingSummariesTool.handler({ limit: 50 }, makeCtx(prisma))
    expect(prisma.meetingTranscript.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }))

    await readMeetingSummariesTool.handler({ limit: 0 }, makeCtx(prisma))
    expect(prisma.meetingTranscript.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }))

    await readMeetingSummariesTool.handler({ limit: 3 }, makeCtx(prisma))
    expect(prisma.meetingTranscript.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 3 }))
  })

  it('truncates aiSummary to 4000 chars', async () => {
    const huge = 'x'.repeat(5000)
    prisma.meetingTranscript.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T00:00:00.000Z'), aiSummary: huge, _count: { actionItems: 0, decisions: 0 } },
    ])
    const out = await readMeetingSummariesTool.handler({}, makeCtx(prisma))
    expect(out.summaries[0].aiSummary).toHaveLength(4000)
  })

  it('replaces null aiSummary with empty string defensively', async () => {
    prisma.meetingTranscript.findMany.mockResolvedValue([
      { createdAt: new Date('2026-01-01T00:00:00.000Z'), aiSummary: null, _count: { actionItems: 0, decisions: 0 } },
    ])
    const out = await readMeetingSummariesTool.handler({}, makeCtx(prisma))
    expect(out.summaries[0].aiSummary).toBe('')
  })
})

// ─── readPastBacklogsTool ────────────────────────────────────────────────────

describe('readPastBacklogsTool', () => {
  let prisma: MockPrisma

  beforeEach(() => { prisma = makeMockPrisma() })

  it('returns WP rows with Decimal estimatedHours coerced to number', async () => {
    // The impl uses `Number(w.estimatedHours)` which calls valueOf(), not
    // toNumber(). Real Prisma Decimal exposes both — but the relevant hook
    // for `Number(...)` coercion is valueOf().
    prisma.workPackage.findMany.mockResolvedValue([
      { id: 'e1', title: 'Epic A', type: 'Epic',    priority: 'High',   status: 'Open',
        estimatedHours: { valueOf: () => 24 } as unknown as number, parentId: null },
      { id: 't1', title: 'Task 1', type: 'Task',    priority: 'Normal', status: 'InProgress',
        estimatedHours: null, parentId: 'e1' },
    ])
    const out = await readPastBacklogsTool.handler({}, makeCtx(prisma))

    expect(prisma.workPackage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1', isDeleted: false },
        orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
    )
    expect(out.items).toEqual([
      { id: 'e1', title: 'Epic A', type: 'Epic',    priority: 'High',   status: 'Open',       estimatedHours: 24, parentId: null },
      { id: 't1', title: 'Task 1', type: 'Task',    priority: 'Normal', status: 'InProgress', estimatedHours: null, parentId: 'e1' },
    ])
  })

  it('returns { items: [] } when no WPs exist', async () => {
    prisma.workPackage.findMany.mockResolvedValue([])
    const out = await readPastBacklogsTool.handler({}, makeCtx(prisma))
    expect(out).toEqual({ items: [] })
  })
})

// ─── readValidationFeedbackTool ──────────────────────────────────────────────

describe('readValidationFeedbackTool', () => {
  let prisma: MockPrisma

  beforeEach(() => { prisma = makeMockPrisma() })

  it('returns rows with comment truncated to 1000 chars + ISO createdAt', async () => {
    const longComment = 'c'.repeat(1500)
    prisma.cahierFeedback.findMany.mockResolvedValue([
      { status: 'rejected', comment: longComment, section: 'contexte', createdAt: new Date('2026-04-01T08:00:00.000Z') },
      { status: 'approved', comment: 'OK',         section: null,       createdAt: new Date('2026-04-02T08:00:00.000Z') },
    ])
    const out = await readValidationFeedbackTool.handler({}, makeCtx(prisma))

    expect(prisma.cahierFeedback.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    )
    expect(out.items[0].comment).toHaveLength(1000)
    expect(out.items[0].createdAt).toBe('2026-04-01T08:00:00.000Z')
    expect(out.items[1]).toEqual({
      status: 'approved',
      comment: 'OK',
      section: null,
      createdAt: '2026-04-02T08:00:00.000Z',
    })
  })

  it('clamps limit to [1, 30]', async () => {
    prisma.cahierFeedback.findMany.mockResolvedValue([])
    await readValidationFeedbackTool.handler({ limit: 100 }, makeCtx(prisma))
    expect(prisma.cahierFeedback.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30 }))

    await readValidationFeedbackTool.handler({ limit: 0 }, makeCtx(prisma))
    expect(prisma.cahierFeedback.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }))

    await readValidationFeedbackTool.handler({ limit: 7 }, makeCtx(prisma))
    expect(prisma.cahierFeedback.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 7 }))
  })
})

// ─── Tool metadata sanity ────────────────────────────────────────────────────

describe('tool metadata', () => {
  it('every tool has a stable name + description + parameters schema', () => {
    const tools = [
      readProjectSummaryTool,
      readQuestionnaireTool,
      readValidatedCahierTool,
      readMeetingSummariesTool,
      readPastBacklogsTool,
      readValidationFeedbackTool,
    ]
    for (const t of tools) {
      expect(typeof t.name).toBe('string')
      expect(t.name.length).toBeGreaterThan(0)
      expect(typeof t.description).toBe('string')
      expect(t.parameters).toBeDefined()
      expect(typeof t.handler).toBe('function')
    }
    // Names should be the wire identifiers the agent prompt mentions.
    expect(readProjectSummaryTool.name).toBe('read_project_summary')
    expect(readQuestionnaireTool.name).toBe('read_questionnaire')
    expect(readValidatedCahierTool.name).toBe('read_validated_cahier')
    expect(readMeetingSummariesTool.name).toBe('read_meeting_summaries')
    expect(readPastBacklogsTool.name).toBe('read_past_backlogs')
    expect(readValidationFeedbackTool.name).toBe('read_validation_feedback')
  })
})
