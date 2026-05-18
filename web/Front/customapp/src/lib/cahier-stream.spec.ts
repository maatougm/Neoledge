/**
 * @file cahier-stream.spec.ts — unit tests for the frontend SSE consumer.
 *
 * The consumer:
 *  - opens a fetch with Authorization: Bearer <jwt>
 *  - reads the response body as a ReadableStream of UTF-8 bytes
 *  - parses SSE frames `event: <type>\ndata: <json>\n\n`
 *  - invokes onEvent({ type, ...payload }) per frame
 *
 * We control the network with a global fetch stub that returns a synthetic
 * ReadableStream so we can feed frames byte-by-byte (including ones that
 * straddle chunk boundaries — a real bug class for naive parsers).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import { useConfigStore } from '@/stores/configStore'
import { streamCahierPreview, type CahierStreamEvent } from './cahier-stream'

const enc = new TextEncoder()

/** Build a Response with a ReadableStream that yields the given chunks of
 *  text in order. Each chunk is one ReadableStream `enqueue` call. */
function streamResponse(chunks: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** SSE frame helper. */
function frame(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
}

beforeEach(() => {
  setActivePinia(createPinia())
  useAuthStore().jwt = 'test-jwt'
  useConfigStore().apiUrl = 'https://api.example.com'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('streamCahierPreview', () => {
  it('parses a sequence of complete frames in order', async () => {
    const chunks = [
      frame('started',  { totalGroups: 3, transcriptCount: 1 }),
      frame('section',  { group: 'intro',  partial: { contexte: 'X' }, latencyMs: 12 }),
      frame('section',  { group: 'scope',  partial: { perimetreInclus: 'Y' }, latencyMs: 14 }),
      frame('section',  { group: 'delivery', partial: { livrables: 'Z' }, latencyMs: 15 }),
      frame('complete', { aiContent: { contexte: 'X', perimetreInclus: 'Y', livrables: 'Z' }, durationMs: 41 }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)))

    const events: CahierStreamEvent[] = []
    await streamCahierPreview('proj-1', { onEvent: (e) => events.push(e) })

    expect(events.map((e) => e.type)).toEqual([
      'started', 'section', 'section', 'section', 'complete',
    ])
    expect((events[1] as { group: string }).group).toBe('intro')
    expect((events[4] as { aiContent: { livrables: string } }).aiContent.livrables).toBe('Z')
  })

  it('handles frames split across chunk boundaries', async () => {
    const full = frame('section', { group: 'intro', partial: { contexte: 'Hello' }, latencyMs: 10 })
    // Split the frame in the middle of the JSON payload so the parser has
    // to keep half of the frame in its buffer between reads.
    const split = full.indexOf('"latencyMs"')
    const chunks = [
      full.slice(0, split),
      full.slice(split),
      frame('complete', { aiContent: { contexte: 'Hello' }, durationMs: 10 }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)))

    const events: CahierStreamEvent[] = []
    await streamCahierPreview('proj-1', { onEvent: (e) => events.push(e) })

    expect(events.map((e) => e.type)).toEqual(['section', 'complete'])
    expect((events[0] as { group: string }).group).toBe('intro')
  })

  it('attaches the Authorization header from the auth store', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(streamResponse([frame('complete', { aiContent: {}, durationMs: 0 })]))
    vi.stubGlobal('fetch', fetchSpy)

    await streamCahierPreview('proj-1', { onEvent: () => undefined })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.com/pm/projects/proj-1/cahier-des-charges/preview-stream')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-jwt')
    expect((init.headers as Record<string, string>).Accept).toBe('text/event-stream')
  })

  it('rejects when the server returns a non-200 status', async () => {
    const errorBody = JSON.stringify({ statusCode: 403, message: 'Forbidden' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(errorBody, { status: 403 })))

    await expect(streamCahierPreview('proj-1', { onEvent: () => undefined })).rejects.toThrow(/HTTP 403/)
  })

  it('skips malformed frames silently and keeps parsing', async () => {
    const chunks = [
      // Missing data line — should be ignored.
      'event: section\n\n',
      // Bad JSON — should be ignored.
      'event: section\ndata: {not json\n\n',
      // Good frame.
      frame('complete', { aiContent: { livrables: 'OK' }, durationMs: 5 }),
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(chunks)))

    const events: CahierStreamEvent[] = []
    await streamCahierPreview('proj-1', { onEvent: (e) => events.push(e) })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('complete')
  })
})
