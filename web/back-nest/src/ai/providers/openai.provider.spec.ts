import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './openai.provider';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    OPENAI_API_KEY: 'sk-test-xxx',
    OPENAI_BASE_URL: undefined,
    AI_MODEL: undefined,
    ...overrides,
  };
  return { get: jest.fn((k: string) => values[k]) };
}

async function buildProvider(config: ReturnType<typeof makeConfig>): Promise<OpenAiProvider> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OpenAiProvider,
      { provide: ConfigService, useValue: config },
    ],
  }).compile();
  return module.get(OpenAiProvider);
}

const VALID_RESULT = {
  summary: '# OpenAI summary',
  actionItems: [{ description: 'task', assigneeName: null, dueDate: null }],
  decisions: [{ description: 'decision X', category: 'decision' }],
};

describe('OpenAiProvider', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('modelName', () => {
    it('returns the configured model', async () => {
      const provider = await buildProvider(makeConfig({ AI_MODEL: 'gpt-4o' }));
      expect(provider.modelName).toBe('gpt-4o');
    });

    it('defaults to gpt-4o-mini when AI_MODEL is unset', async () => {
      const provider = await buildProvider(makeConfig());
      expect(provider.modelName).toBe('gpt-4o-mini');
    });
  });

  describe('analyze()', () => {
    it('throws when OPENAI_API_KEY is missing', async () => {
      const provider = await buildProvider(makeConfig({ OPENAI_API_KEY: undefined }));
      await expect(provider.analyze('x', [])).rejects.toThrow(/OPENAI_API_KEY not configured/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('happy path — POSTs to the right URL with the right headers and body', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: JSON.stringify(VALID_RESULT) } }],
      }));
      const provider = await buildProvider(makeConfig());

      const result = await provider.analyze('PM: hello\nLead: world', ['PM', 'Lead']);

      expect(result).toEqual({
        summary: VALID_RESULT.summary,
        actionItems: VALID_RESULT.actionItems,
        decisions: VALID_RESULT.decisions,
      });

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-xxx');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(4096);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe('system');
      expect(body.messages[1].role).toBe('user');
      expect(body.messages[1].content).toMatch(/<TRANSCRIPT>[\s\S]*<\/TRANSCRIPT>/);
    });

    it('honors OPENAI_BASE_URL (Azure / self-hosted compatible)', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: JSON.stringify(VALID_RESULT) } }],
      }));
      const provider = await buildProvider(makeConfig({ OPENAI_BASE_URL: 'https://my-azure.openai.azure.com/v1' }));

      await provider.analyze('x', []);
      const [url] = fetchSpy.mock.calls[0] as [string];
      expect(url).toBe('https://my-azure.openai.azure.com/v1/chat/completions');
    });

    it('throws on non-2xx response with status code in message', async () => {
      fetchSpy.mockResolvedValue(new Response('quota exceeded', { status: 429 }));
      const provider = await buildProvider(makeConfig());

      await expect(provider.analyze('x', [])).rejects.toThrow(/OpenAI API error 429.*quota exceeded/);
    });

    it('throws on missing choices field (malformed shape)', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ foo: 'bar' }));
      const provider = await buildProvider(makeConfig());

      await expect(provider.analyze('x', [])).rejects.toThrow(/Unexpected OpenAI response shape/);
    });

    it('throws on empty choices array', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ choices: [] }));
      const provider = await buildProvider(makeConfig());

      await expect(provider.analyze('x', [])).rejects.toThrow(/Unexpected OpenAI response shape/);
    });

    it('throws on non-object data', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(null));
      const provider = await buildProvider(makeConfig());

      await expect(provider.analyze('x', [])).rejects.toThrow(/Unexpected OpenAI response shape/);
    });

    it('strips markdown fences before parsing', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '```json\n' + JSON.stringify(VALID_RESULT) + '\n```' } }],
      }));
      const provider = await buildProvider(makeConfig());

      const result = await provider.analyze('x', []);
      expect(result.summary).toBe(VALID_RESULT.summary);
    });

    it('strips bare fences', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '```\n' + JSON.stringify(VALID_RESULT) + '\n```' } }],
      }));
      const provider = await buildProvider(makeConfig());

      const result = await provider.analyze('x', []);
      expect(result.summary).toBe(VALID_RESULT.summary);
    });

    it('throws on invalid JSON content', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: 'not valid json' } }],
      }));
      const provider = await buildProvider(makeConfig());

      await expect(provider.analyze('x', [])).rejects.toThrow(/Invalid JSON from OpenAI/);
    });

    it('defaults missing fields on incomplete JSON', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: '{}' } }],
      }));
      const provider = await buildProvider(makeConfig());

      const result = await provider.analyze('x', []);
      expect(result).toEqual({ summary: '', actionItems: [], decisions: [] });
    });

    it('coerces non-array fields to []', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: JSON.stringify({ summary: 's', actionItems: 'oops', decisions: 7 }) } }],
      }));
      const provider = await buildProvider(makeConfig());

      const result = await provider.analyze('x', []);
      expect(result).toEqual({ summary: 's', actionItems: [], decisions: [] });
    });

    it('redacts PII before sending', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: { content: JSON.stringify(VALID_RESULT) } }],
      }));
      const provider = await buildProvider(makeConfig());

      await provider.analyze('email alice@example.com', []);
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages[1].content).not.toContain('alice@example.com');
    });

    it('handles missing message.content (uses empty string)', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({
        choices: [{ message: {} }],
      }));
      const provider = await buildProvider(makeConfig());

      // Empty string isn't valid JSON → parse error.
      await expect(provider.analyze('x', [])).rejects.toThrow(/Invalid JSON from OpenAI/);
    });
  });
});
