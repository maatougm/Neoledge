import { Logger } from '@nestjs/common'
import { EmbeddingsService } from './embeddings.service.js'

// Minimal stub ConfigService — we only exercise the keys the service reads.
function mkConfig(overrides: Record<string, string | undefined> = {}) {
  const map: Record<string, string | undefined> = {
    TRANSCRIPTION_URL: 'http://transcription:8000',
    TRANSCRIPTION_SECRET: 'sek-test',
    EMBEDDING_TIMEOUT_MS: undefined,
    ...overrides,
  }
  return { get: (k: string) => map[k] }
}

function mkAiUsage(): { log: jest.Mock } {
  return { log: jest.fn(async () => undefined) }
}

function mkFetchOk(body: unknown, status = 200): jest.Mock {
  return jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as never))
}

function mkFetchError(status: number, body: unknown = {}): jest.Mock {
  return jest.fn(async () => ({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as never))
}

describe('EmbeddingsService', () => {
  beforeEach(() => {
    // Suppress the Logger.warn calls so the test output stays clean.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('returns an empty result for an empty input (no fetch)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn()
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    const r = await service.embed([], 'passage')
    expect(r.isSuccess).toBe(true)
    if (r.isSuccess) expect(r.value).toEqual([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((global as any).fetch).not.toHaveBeenCalled()
  })

  it('rejects batches over MAX_BATCH (64)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn()
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    const r = await service.embed(new Array(65).fill('hi'), 'passage')
    expect(r.isFailure).toBe(true)
    if (r.isFailure) expect(r.error).toContain('batch too large')
  })

  it('sends prefixed texts and returns the parsed vectors on a 200', async () => {
    const usage = mkAiUsage()
    const fakeBody = { embeddings: [[0.1, 0.2], [0.3, 0.4]], model: 'multilingual-e5-small', dim: 2 }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchSpy = mkFetchOk(fakeBody)
    ;(global as any).fetch = fetchSpy

    const service = new EmbeddingsService(mkConfig() as never, usage as never)
    const r = await service.embed(['hello', 'monde'], 'passage', { projectId: 'p1' })
    expect(r.isSuccess).toBe(true)
    if (r.isSuccess) expect(r.value).toEqual([[0.1, 0.2], [0.3, 0.4]])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://transcription:8000/embed')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Transcription-Secret': 'sek-test',
    })
    const body = JSON.parse(init.body as string) as { texts: string[]; input_type: string }
    expect(body.input_type).toBe('passage')
    expect(body.texts).toEqual(['hello', 'monde']) // trimmed/sliced, but unchanged here
    expect(usage.log).toHaveBeenCalledTimes(1)
    expect(usage.log.mock.calls[0]?.[0]).toMatchObject({ provider: 'local-e5', feature: 'embed', success: true })
  })

  it('returns embedding_unavailable on 503', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = mkFetchError(503, { detail: 'model not loaded' })
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    const r = await service.embed(['hi'], 'passage')
    expect(r.isFailure).toBe(true)
    if (r.isFailure) expect(r.error).toBe('embedding_unavailable')
  })

  it('returns embedding_length_mismatch when the response count diverges', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = mkFetchOk({ embeddings: [[0]], model: 'x', dim: 1 })
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    const r = await service.embed(['a', 'b'], 'passage')
    expect(r.isFailure).toBe(true)
    if (r.isFailure) expect(r.error).toBe('embedding_length_mismatch')
  })

  it('returns embedding_timeout when fetch aborts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(global as any).fetch = jest.fn(async () => {
      const err = new Error('The operation was aborted due to timeout')
      ;(err as Error & { name: string }).name = 'TimeoutError'
      throw err
    })
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    const r = await service.embed(['hi'], 'query')
    expect(r.isFailure).toBe(true)
    if (r.isFailure) expect(r.error).toBe('embedding_timeout')
  })

  it('truncates a 5k-char text down to MAX_TEXT_CHARS (2000) before sending', async () => {
    const long = 'x'.repeat(5000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchSpy = mkFetchOk({ embeddings: [[0]], model: 'x', dim: 1 })
    ;(global as any).fetch = fetchSpy
    const service = new EmbeddingsService(mkConfig() as never, mkAiUsage() as never)
    await service.embed([long], 'passage')
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as { texts: string[] }
    expect(body.texts[0].length).toBe(2000)
  })
})
