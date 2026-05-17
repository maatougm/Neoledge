/**
 * @file lib/cahier-stream.ts — SSE consumer for the cahier preview-stream
 *  endpoint. Bypasses axios because EventSource doesn't support custom
 *  headers (need the JWT) and axios doesn't expose the raw ReadableStream.
 *
 * Wire format from backend:
 *   event: <type>\n
 *   data: <json>\n\n
 *
 * The matching backend type lives in
 * `web/back-nest/src/cahier-des-charges/cahier-des-charges.types.ts` —
 * the `CahierStreamEvent` union. Keep both in sync.
 */

import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'

// Mirrors `web/back-nest/src/cahier-des-charges/cahier-des-charges.types.ts`.
// Kept inline because the shape is also defined in CahierDesChargesSection.vue
// and AIOutputSection.vue — extracting it is a bigger refactor.
export interface CahierSection {
  title: string
  content: string
}

export interface CahierAiResult {
  objectifDocument: string
  contexte: string
  objectifProjet: string
  perimetreInclus: string
  perimetreExclus: string
  exigencesFonctionnelles: CahierSection[]
  architectureTechnique: CahierSection[]
  livrables: string
  conclusion: string
}

export type CahierSectionGroup = 'intro' | 'scope' | 'delivery'

export type CahierStreamEvent =
  | { type: 'started'; totalGroups: 3; transcriptCount: number }
  | { type: 'section'; group: CahierSectionGroup; partial: Partial<CahierAiResult>; latencyMs: number }
  | { type: 'group_error'; group: CahierSectionGroup; message: string }
  | { type: 'complete'; aiContent: CahierAiResult; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'aborted'; reason: string }

export interface CahierStreamOptions {
  onEvent: (event: CahierStreamEvent) => void
  signal?: AbortSignal
}

/**
 * Open the SSE stream and pipe each parsed event through `onEvent`. Resolves
 * once the stream ends (server closed the response). Rejects on network
 * failure, non-200 response, or AbortError. Note: a `type: 'error'` event
 * is NOT a promise rejection — it's just another event the caller should
 * surface to the UI.
 */
export async function streamCahierPreview(
  projectId: string,
  { onEvent, signal }: CahierStreamOptions,
): Promise<void> {
  const auth = useAuthStore()
  const config = useConfigStore()
  const base = config.apiUrl || window.location.origin
  const url = `${base}/pm/projects/${projectId}/cahier-des-charges/preview-stream`

  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (auth.jwt) headers.Authorization = `Bearer ${auth.jwt}`

  const res = await fetch(url, { method: 'GET', headers, signal })
  if (!res.ok) {
    // Try to surface the server-provided error payload so the caller can
    // distinguish 4xx business errors (missing driver fields, daily budget)
    // from real network failures.
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 500)
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`)
  }
  if (!res.body) throw new Error('Response body is empty — streaming not supported')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Each SSE frame ends with a blank line. Split greedily on \n\n;
    // anything trailing without \n\n stays in `buffer` for the next chunk.
    let frameEnd = buffer.indexOf('\n\n')
    while (frameEnd !== -1) {
      const frame = buffer.slice(0, frameEnd)
      buffer = buffer.slice(frameEnd + 2)
      handleFrame(frame, onEvent)
      frameEnd = buffer.indexOf('\n\n')
    }
  }
}

function handleFrame(frame: string, onEvent: (e: CahierStreamEvent) => void): void {
  // Frames are line-oriented. We expect exactly one `event:` and one `data:` line.
  let eventName = ''
  let dataPayload = ''
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      // SSE allows multi-line data via repeated `data:` lines joined by \n.
      // The backend never emits that here, but support it anyway.
      dataPayload = dataPayload ? `${dataPayload}\n${line.slice(5).trim()}` : line.slice(5).trim()
    }
  }
  if (!eventName || !dataPayload) return
  let parsed: unknown
  try {
    parsed = JSON.parse(dataPayload)
  } catch {
    return
  }
  if (typeof parsed === 'object' && parsed !== null) {
    onEvent({ ...(parsed as object), type: eventName } as CahierStreamEvent)
  }
}
