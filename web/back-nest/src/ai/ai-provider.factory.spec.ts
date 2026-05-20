import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { AiProviderFactory } from './ai-provider.factory.js'
import { OpenAiProvider } from './providers/openai.provider.js'
import { GeminiProvider } from './providers/gemini.provider.js'
import { ZaiFallbackProvider } from './providers/zai-fallback.provider.js'

function mkConfig(values: Record<string, string | undefined>) {
  return { get: jest.fn((k: string) => values[k]) }
}

function mkProviderStub(modelName: string): { modelName: string; analyze: jest.Mock; isConfigured?: jest.Mock } {
  return {
    modelName,
    analyze: jest.fn().mockResolvedValue({ summary: '', actionItems: [], decisions: [] }),
  }
}

async function buildFactory(
  envVars: Record<string, string | undefined>,
  zaiConfigured = true,
): Promise<{
  factory: AiProviderFactory
  openAi: ReturnType<typeof mkProviderStub>
  gemini: ReturnType<typeof mkProviderStub>
  zai: ReturnType<typeof mkProviderStub> & { isConfigured: jest.Mock }
}> {
  const openAi = mkProviderStub('gpt-4o-mini')
  const gemini = mkProviderStub('gemini-1.5-flash')
  const zai = {
    ...mkProviderStub('glm-4.5-air'),
    isConfigured: jest.fn().mockReturnValue(zaiConfigured),
  }

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiProviderFactory,
      { provide: ConfigService, useValue: mkConfig(envVars) },
      { provide: OpenAiProvider, useValue: openAi },
      { provide: GeminiProvider, useValue: gemini },
      { provide: ZaiFallbackProvider, useValue: zai },
    ],
  }).compile()

  return { factory: module.get(AiProviderFactory), openAi, gemini, zai }
}

describe('AiProviderFactory', () => {
  describe('primaryName()', () => {
    it('defaults to zai when AI_PROVIDER is unset', async () => {
      const { factory } = await buildFactory({})
      expect(factory.primaryName()).toBe('zai')
    })

    it('honors AI_PROVIDER=openai', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'openai' })
      expect(factory.primaryName()).toBe('openai')
    })

    it('honors AI_PROVIDER=gemini', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'gemini' })
      expect(factory.primaryName()).toBe('gemini')
    })

    it('normalizes case (OpenAI → openai)', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'OPENAI' })
      expect(factory.primaryName()).toBe('openai')
    })

    it('falls back to zai on garbage AI_PROVIDER values', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'mistral' })
      expect(factory.primaryName()).toBe('zai')
    })
  })

  describe('fallbackName()', () => {
    it('returns null when AI_FALLBACK_PROVIDER=none (case-insensitive)', async () => {
      const { factory } = await buildFactory({ AI_FALLBACK_PROVIDER: 'NONE' })
      expect(factory.fallbackName()).toBeNull()
    })

    it("defaults to 'openai' when primary is zai and AI_FALLBACK_PROVIDER is unset", async () => {
      const { factory } = await buildFactory({})
      expect(factory.fallbackName()).toBe('openai')
    })

    it('excludes the candidate when it matches the primary', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'openai', AI_FALLBACK_PROVIDER: 'openai' })
      expect(factory.fallbackName()).toBeNull()
    })

    it('excludes the default (openai) when primary is openai', async () => {
      // primary=openai, no fallback configured → normalized default = openai = primary → null
      const { factory } = await buildFactory({ AI_PROVIDER: 'openai' })
      expect(factory.fallbackName()).toBeNull()
    })

    it('returns gemini when explicitly set and primary is something else', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'openai', AI_FALLBACK_PROVIDER: 'gemini' })
      expect(factory.fallbackName()).toBe('gemini')
    })

    it('normalizes case (Gemini → gemini)', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'zai', AI_FALLBACK_PROVIDER: 'GEMINI' })
      expect(factory.fallbackName()).toBe('gemini')
    })

    it('falls back to openai default on garbage values', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'zai', AI_FALLBACK_PROVIDER: 'unknown' })
      expect(factory.fallbackName()).toBe('openai')
    })
  })

  describe('byName()', () => {
    it('routes to the zai instance', async () => {
      const { factory, zai } = await buildFactory({})
      expect(factory.byName('zai')).toBe(zai)
    })

    it('routes to the openai instance', async () => {
      const { factory, openAi } = await buildFactory({})
      expect(factory.byName('openai')).toBe(openAi)
    })

    it('routes to the gemini instance', async () => {
      const { factory, gemini } = await buildFactory({})
      expect(factory.byName('gemini')).toBe(gemini)
    })
  })

  describe('getPrimary()', () => {
    it('returns the primary provider instance', async () => {
      const { factory, zai } = await buildFactory({ AI_PROVIDER: 'zai' })
      expect(factory.getPrimary()).toBe(zai)
    })

    it('returns the openai instance when AI_PROVIDER=openai', async () => {
      const { factory, openAi } = await buildFactory({ AI_PROVIDER: 'openai' })
      expect(factory.getPrimary()).toBe(openAi)
    })
  })

  describe('getFallback()', () => {
    it('returns null when fallback is none', async () => {
      const { factory } = await buildFactory({ AI_FALLBACK_PROVIDER: 'none' })
      expect(factory.getFallback()).toBeNull()
    })

    it('returns the openai instance when fallback is openai', async () => {
      const { factory, openAi } = await buildFactory({})
      expect(factory.getFallback()).toBe(openAi)
    })

    it('returns null when fallback is zai but Z.AI is not configured', async () => {
      const { factory } = await buildFactory(
        { AI_PROVIDER: 'openai', AI_FALLBACK_PROVIDER: 'zai' },
        /* zaiConfigured */ false,
      )
      expect(factory.getFallback()).toBeNull()
    })

    it('returns the zai instance when fallback is zai AND Z.AI is configured', async () => {
      const { factory, zai } = await buildFactory(
        { AI_PROVIDER: 'openai', AI_FALLBACK_PROVIDER: 'zai' },
        /* zaiConfigured */ true,
      )
      expect(factory.getFallback()).toBe(zai)
    })

    it('returns null when fallback would be the same as primary', async () => {
      const { factory } = await buildFactory({ AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'gemini' })
      expect(factory.getFallback()).toBeNull()
    })
  })
})
