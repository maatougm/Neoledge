import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { GeminiProvider } from './gemini.provider.js'

// Helper — minimal ConfigService stub
function mkConfig(overrides: Record<string, string | undefined> = {}) {
  const map: Record<string, string | undefined> = {
    GEMINI_API_KEY: 'test-gemini-key',
    ...overrides,
  }
  return { get: jest.fn((k: string) => map[k]) }
}

function mkFetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_BODY = {
  candidates: [
    {
      content: {
        parts: [
          { text: '{"summary":"Réunion de cadrage","actionItems":[{"description":"Préparer le doc"}],"decisions":[{"description":"Choix Postgres","category":"decision"}]}' },
        ],
      },
    },
  ],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
}

describe('GeminiProvider', () => {
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    // Silence the logger so the test output stays clean.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  async function buildProvider(configOverrides: Record<string, string | undefined> = {}): Promise<GeminiProvider> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiProvider,
        { provide: ConfigService, useValue: mkConfig(configOverrides) },
      ],
    }).compile()
    return module.get<GeminiProvider>(GeminiProvider)
  }

  describe('modelName', () => {
    it('exposes the default model name', async () => {
      const provider = await buildProvider()
      expect(provider.modelName).toBe('gemini-1.5-flash')
    })
  })

  describe('analyze() — happy path', () => {
    it('POSTs to the v1beta generateContent endpoint with the configured key in the query string', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(VALID_BODY))
      const provider = await buildProvider()

      await provider.analyze('PM: bonjour', ['PM'])

      expect(global.fetch).toHaveBeenCalledTimes(1)
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent')
      expect(url).toContain('key=test-gemini-key')
      expect(init.method).toBe('POST')
      const headers = init.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('sends a contents/parts body shape with the wrapped transcript', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(VALID_BODY))
      const provider = await buildProvider()

      await provider.analyze('PM: bonjour à tous', ['PM'])

      const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit
      const body = JSON.parse(init.body as string) as {
        contents: Array<{ role: string; parts: Array<{ text: string }> }>
        generationConfig: { temperature: number; maxOutputTokens: number }
      }
      expect(body.contents).toHaveLength(1)
      expect(body.contents[0].role).toBe('user')
      expect(body.contents[0].parts[0].text).toContain('PM: bonjour à tous')
      expect(body.generationConfig.temperature).toBe(0.3)
      expect(body.generationConfig.maxOutputTokens).toBe(4096)
    })

    it('parses the AiAnalysisResult from candidates[0].content.parts[0].text', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(VALID_BODY))
      const provider = await buildProvider()

      const result = await provider.analyze('PM: bonjour', ['PM'])

      expect(result.summary).toBe('Réunion de cadrage')
      expect(result.actionItems).toEqual([{ description: 'Préparer le doc' }])
      expect(result.decisions).toEqual([{ description: 'Choix Postgres', category: 'decision' }])
    })

    it('strips ```json code fences from the model output before parsing', async () => {
      const fencedBody = {
        candidates: [
          {
            content: {
              parts: [
                { text: '```json\n{"summary":"OK","actionItems":[],"decisions":[]}\n```' },
              ],
            },
          },
        ],
      }
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(fencedBody))
      const provider = await buildProvider()

      const result = await provider.analyze('text', [])
      expect(result.summary).toBe('OK')
      expect(result.actionItems).toEqual([])
      expect(result.decisions).toEqual([])
    })

    it('coerces non-array actionItems/decisions to empty arrays', async () => {
      const weirdBody = {
        candidates: [
          { content: { parts: [{ text: '{"summary":"X","actionItems":"oops","decisions":null}' }] } },
        ],
      }
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(weirdBody))
      const provider = await buildProvider()

      const result = await provider.analyze('text', [])
      expect(result.actionItems).toEqual([])
      expect(result.decisions).toEqual([])
    })

    it('defaults summary to empty string when missing', async () => {
      const noSummaryBody = {
        candidates: [
          { content: { parts: [{ text: '{"actionItems":[],"decisions":[]}' }] } },
        ],
      }
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(noSummaryBody))
      const provider = await buildProvider()

      const result = await provider.analyze('text', [])
      expect(result.summary).toBe('')
    })
  })

  describe('analyze() — error paths', () => {
    it('throws when GEMINI_API_KEY is not configured', async () => {
      global.fetch = jest.fn()
      const provider = await buildProvider({ GEMINI_API_KEY: undefined })

      await expect(provider.analyze('text', [])).rejects.toThrow('GEMINI_API_KEY not configured')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('throws with the status code on HTTP 4xx/5xx', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse({ error: 'bad request' }, 400))
      const provider = await buildProvider()

      await expect(provider.analyze('text', [])).rejects.toThrow('Gemini API error 400')
    })

    it('throws when candidates array is missing', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse({ noField: true }))
      const provider = await buildProvider()

      await expect(provider.analyze('text', [])).rejects.toThrow(/Unexpected Gemini response shape/)
    })

    it('throws when candidates array is empty', async () => {
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse({ candidates: [] }))
      const provider = await buildProvider()

      await expect(provider.analyze('text', [])).rejects.toThrow(/Unexpected Gemini response shape/)
    })

    it('throws when the text content is not valid JSON', async () => {
      const badJsonBody = {
        candidates: [
          { content: { parts: [{ text: 'this is not JSON at all' }] } },
        ],
      }
      global.fetch = jest.fn().mockResolvedValue(mkFetchResponse(badJsonBody))
      const provider = await buildProvider()

      await expect(provider.analyze('text', [])).rejects.toThrow(/Invalid JSON from Gemini/)
    })

    it('throws when response.json() yields a non-object', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      const provider = await buildProvider()

      await expect(provider.analyze('text', [])).rejects.toThrow(/Unexpected Gemini response shape/)
    })
  })
})
