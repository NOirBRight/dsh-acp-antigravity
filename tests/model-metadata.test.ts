import { describe, expect, it } from 'vitest'
import { parseCcpaModelList } from '../src/ccpa-models.js'
import { enrichNativeCatalog } from '../src/enrich.js'
import { factsFromModelsDevRow, mergeModelFacts, thinkingLevelOf } from '../src/model-metadata.js'
import { lookupModelsDevFacts } from '../src/models-dev.js'

describe('mergeModelFacts', () => {
  it('keeps explicit false over a models.dev true', () => {
    const merged = mergeModelFacts({ vision: false }, { vision: true })
    expect(merged.vision).toBe(false)
    expect(merged.sources.vision).toBe('upstream')
  })

  it('fills missing output from models.dev and leaves unknown vision unknown', () => {
    const merged = mergeModelFacts({}, { maxOutputTokens: 65536, vision: true })
    expect(merged.maxOutputTokens).toBe(65536)
    expect(merged.sources.maxOutputTokens).toBe('models.dev')
    expect(merged.vision).toBe(true)
    expect(merged.sources.vision).toBe('models.dev')
  })

  it('does not treat 0 as a token limit', () => {
    expect(mergeModelFacts({ inputTokenLimit: 0 }).inputTokenLimit).toBeUndefined()
  })
})

describe('factsFromModelsDevRow', () => {
  it('reads image modalities and does not invent default effort', () => {
    const parsed = factsFromModelsDevRow({
      reasoning: true,
      reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
      modalities: { input: ['text', 'image'] },
      limit: { context: 1048576, output: 65536 },
    })
    expect(parsed.facts.vision).toBe(true)
    expect(parsed.facts.thinking).toBe(true)
    expect(parsed.facts.contextWindow).toBe(1048576)
    expect(parsed.facts.maxOutputTokens).toBe(65536)
    expect(parsed.facts.defaultEffort).toBeUndefined()
    expect(parsed.efforts).toEqual(['low', 'medium', 'high'])
  })
})

describe('lookupModelsDevFacts', () => {
  const document = { google: { models: { 'gemini-3.8-flash': { reasoning: true, modalities: { input: ['image'] }, limit: { context: 9, output: 8 } } } } }
  it('matches a peeled thinking suffix and not gemini-pro-agent', () => {
    expect(lookupModelsDevFacts(document, 'gemini-3.8-flash-high').contextWindow).toBe(9)
    expect(lookupModelsDevFacts(document, 'gemini-pro-agent').contextWindow).toBeUndefined()
  })
})

describe('parseCcpaModelList', () => {
  it('projects MIME vision, input vs output, and a present default model id', () => {
    const listed = parseCcpaModelList({
      defaultAgentModelId: 'gemini-3.8-flash-high',
      agentModelSorts: [{ groups: [{ modelIds: ['gemini-3.8-flash-high', 'claude-sonnet-4-6'] }] }],
      models: {
        'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)', supportsImages: false, supportedMimeTypes: { 'image/png': true }, supportsThinking: true, maxTokens: 1048576, maxOutputTokens: 65536, thinkingLevel: 3 },
        'gpt-oss-120b-medium': { supportsThinking: true, maxTokens: 131072, maxOutputTokens: 32768 },
      },
    })
    expect(listed.defaultAgentModelId).toBe('gemini-3.8-flash-high')
    expect(listed.agentModelIds).toEqual(['gemini-3.8-flash-high', 'claude-sonnet-4-6'])
    const flash = listed.models.find(model => model.id === 'gemini-3.8-flash-high')
    expect(flash?.facts.vision).toBe(true)
    expect(flash?.facts.inputTokenLimit).toBe(1048576)
    expect(flash?.facts.maxOutputTokens).toBe(65536)
    expect(flash?.facts.defaultEffort).toBeUndefined()
    const gpt = listed.models.find(model => model.id === 'gpt-oss-120b-medium')
    expect(gpt?.facts.vision).toBeUndefined()
    expect(gpt?.facts.thinking).toBe(true)
  })
})

describe('enrichNativeCatalog', () => {
  it('never adds CCPA-only models to the ACP catalog', () => {
    const facts = enrichNativeCatalog(
      [{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }],
      parseCcpaModelList({ models: { 'gemini-3.8-flash-high': { supportsImages: true, maxOutputTokens: 65536 }, 'claude-sonnet-4-6': { supportsImages: true } }, agentModelSorts: [] }),
      new Map([['gemini-3.8-flash-high', { maxOutputTokens: 1 }]]),
    )
    expect([...facts.keys()]).toEqual(['gemini-3.8-flash-high'])
    expect(facts.get('gemini-3.8-flash-high')?.maxOutputTokens).toBe(65536)
    expect(facts.get('gemini-3.8-flash-high')?.sources.maxOutputTokens).toBe('upstream')
  })
})

describe('thinkingLevelOf', () => {
  it('maps enumerated levels and leaves 0 unknown', () => {
    expect(thinkingLevelOf(3)).toBe('high')
    expect(thinkingLevelOf(0)).toBeUndefined()
  })
})
