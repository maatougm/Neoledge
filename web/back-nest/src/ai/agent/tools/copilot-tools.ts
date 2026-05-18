/**
 * @file copilot-tools.ts — read-only tools for the live meeting copilot
 * agent. The copilot runs inline during a meeting; tools must be cheap
 * and bounded so the per-fire cost stays predictable.
 *
 * The transcript window comes from a per-session in-memory ring buffer
 * managed by LiveCopilotService — NOT from the DB (the meeting hasn't
 * been saved yet). All transcript reads pass through `redactPii` before
 * crossing the provider boundary.
 */

import type { ToolDefinition } from '../agent-types.js'
import { obj, int } from '../json-schema.js'
import type { LiveCopilotService } from '../../../meetings/live-copilot.service.js'
import type { LiveSessionState } from '../../../meetings/live-copilot.types.js'
import { redactPii } from '../../../common/pii-redact.js'

interface DismissedSuggestion {
  question: string
  section: string
}

/**
 * Build the copilot tools bound to one live session. Closures the session
 * state so the model never has to pass `liveSessionId` itself.
 */
export function buildCopilotTools(
  state: LiveSessionState,
  copilotService: LiveCopilotService,
): ToolDefinition[] {
  // ── read_live_transcript_window ──────────────────────────────────────────
  const readWindow: ToolDefinition<
    { maxChars?: number },
    { transcript: string; totalCharsAppended: number; pii: { redacted: number } }
  > = {
    name: 'read_live_transcript_window',
    description: "Read the meeting transcript buffer. Default 8000 chars (recent window). Pass maxChars=12000 to retrieve the FULL ring buffer when you need to re-classify older items against past evidence. PII auto-redacted.",
    parameters: obj(
      { maxChars: int({ description: 'Max chars to return (default 8000, max 12000 = full buffer).', minimum: 200, maximum: 12000 }) },
      {},
    ),
    handler: async (args) => {
      // Default raised from 4000 → 8000 so the model has enough context to
      // re-check old items. maxChars=12000 returns the full ring buffer.
      const cap = Math.min(12000, Math.max(200, args.maxChars ?? 8000))
      const slice = state.transcriptBuffer.slice(-cap)
      const { text, stats } = redactPii(slice)
      return { transcript: text, totalCharsAppended: state.totalCharsAppended, pii: { redacted: stats.total } }
    },
  }

  // ── read_session_summary ─────────────────────────────────────────────────
  const readSummary: ToolDefinition<Record<string, never>, { summary: string }> = {
    name: 'read_session_summary',
    description: 'Read the rolling summary you wrote on the previous fire. Use it to remember what has already been covered. Empty on the first fire.',
    parameters: obj({}, {}),
    handler: async () => ({ summary: state.summary }),
  }

  // ── read_dismissed_suggestions ───────────────────────────────────────────
  const readDismissed: ToolDefinition<{ limit?: number }, { items: DismissedSuggestion[] }> = {
    name: 'read_dismissed_suggestions',
    description: 'List questions the PM has DISMISSED earlier in this session. NEVER re-propose any of these.',
    parameters: obj(
      { limit: int({ description: 'Max items (default 10, max 20)', minimum: 1, maximum: 20 }) },
      {},
    ),
    handler: async (args) => {
      const limit = Math.min(20, Math.max(1, args.limit ?? 10))
      const all = await copilotService.fetchEmittedSuggestions(state.liveSessionId)
      const items = all
        .filter((s) => s.status === 'dismissed')
        .slice(0, limit)
        .map((s) => ({ question: s.question, section: s.section }))
      return { items }
    },
  }

  // ── read_already_emitted_suggestions ─────────────────────────────────────
  const readEmitted: ToolDefinition<Record<string, never>, { items: DismissedSuggestion[] }> = {
    name: 'read_already_emitted_suggestions',
    description: 'List ALL questions you have already proposed on this session (pending + asked + dismissed). Use this to avoid duplicates.',
    parameters: obj({}, {}),
    handler: async () => {
      const all = await copilotService.fetchEmittedSuggestions(state.liveSessionId)
      return { items: all.map((s) => ({ question: s.question, section: s.section })) }
    },
  }

  return [readWindow, readSummary, readDismissed, readEmitted]
}
