import { describe, expect, it } from 'vitest'
import { applyCatalogOverlay, collapseAntigravityModels, nativeAntigravityModelId, peelEffort } from '../src/catalog.js'
import { mergeModelFacts } from '../src/model-metadata.js'

describe('Antigravity catalog collapse', () => {
  it('peels high/medium/low into one logical id', () => {
    expect(peelEffort('gemini-3.8-flash-high')).toEqual({ logical: 'gemini-3.8-flash', effort: 'high' })
    expect(peelEffort('gemini-pro-agent')).toEqual({ logical: 'gemini-pro-agent' })
  })

  it('exposes discovered High/Medium/Low and presets the highest as the default', () => {
    const collapsed = collapseAntigravityModels([
      { id: 'default', name: 'Account default' },
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])
    expect(collapsed.some(model => model.id === 'default')).toBe(false)
    const flash = collapsed.find(model => model.id === 'gemini-3.8-flash')
    expect(flash?.name).toBe('Gemini 3.8 Flash')
    expect(flash?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium', 'low'])
    expect(flash?.reasoning?.defaultEffort).toBe('high')
    expect(flash?.sources?.defaultEffort).toBeUndefined()
    expect(flash?.effortMap).toEqual({ high: 'gemini-3.8-flash-high', medium: 'gemini-3.8-flash-medium', low: 'gemini-3.8-flash-low' })
    expect(collapsed.find(model => model.id === 'gemini-pro-agent')?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
  })

  it('merges a High display-name alias with the unsuffixed Pro row', () => {
    const collapsed = collapseAntigravityModels([
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])
    expect(collapsed.map(model => model.id)).toEqual(['gemini-3.1-pro'])
    expect(collapsed[0]?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
    expect(collapsed[0]?.reasoning?.defaultEffort).toBe('high')
    expect(collapsed[0]?.effortMap.high).toBe('gemini-pro-agent')
  })

  it('takes the account default variant as the default effort, and only when it is routable', () => {
    const native = [
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
    ]
    const declared = collapseAntigravityModels(native, new Map(), 'gemini-3.8-flash-high')
    expect(declared.find(model => model.id === 'gemini-3.8-flash')?.reasoning?.defaultEffort).toBe('high')
    expect(declared.find(model => model.id === 'gemini-3.8-flash')?.sources?.defaultEffort).toBe('upstream')
    expect(declared.find(model => model.id === 'gemini-3.7-flash')?.reasoning?.defaultEffort).toBe('high')
    // A declared id outside the catalog names no model: every row keeps its preset.
    expect(collapseAntigravityModels(native, new Map(), 'claude-sonnet-4-6').map(model => model.reasoning?.defaultEffort)).toEqual(['high', 'high'])
    expect(collapseAntigravityModels(native, new Map())[0]?.reasoning?.defaultEffort).toBe('high')
    const unroutable = collapseAntigravityModels(
      [{ id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' }],
      new Map(),
      'gemini-3.8-flash-high',
    )
    // The declared variant is absent, so the model presets its own highest level.
    expect(unroutable[0]?.reasoning?.defaultEffort).toBe('medium')
  })

  it('presets the highest available level per model, never a source or a user override', () => {
    const collapsed = collapseAntigravityModels([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
      { id: 'gemini-3.9-flash-medium', name: 'Gemini 3.9 Flash (Medium)' },
      { id: 'gemini-3.9-flash-low', name: 'Gemini 3.9 Flash (Low)' },
    ])
    const defaultOf = (id: string): string | undefined => collapsed.find(model => model.id === id)?.reasoning?.defaultEffort
    expect(collapsed.find(model => model.id === 'gemini-3.8-flash')?.reasoning?.efforts.map(item => item.id)).toEqual(['high', 'medium', 'low'])
    expect(defaultOf('gemini-3.8-flash')).toBe('high')
    expect(defaultOf('gemini-pro-agent')).toBe('high')
    // The preset is the highest level the model actually offers, not a fixed id.
    expect(defaultOf('gemini-3.9-flash')).toBe('medium')
    expect(collapsed.every(model => model.sources?.defaultEffort === undefined)).toBe(true)
  })

  it('keeps upstream output of 65535 instead of a models.dev 65536', () => {
    const facts = new Map([
      ['gemini-3.1-pro-low', mergeModelFacts({ maxOutputTokens: 65535 }, { maxOutputTokens: 65536, contextWindow: 1048576 })],
    ])
    const collapsed = collapseAntigravityModels([{ id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)' }], facts)
    expect(collapsed[0]?.maxOutputTokens).toBe(65535)
    expect(collapsed[0]?.sources?.maxOutputTokens).toBe('upstream')
    expect(collapsed[0]?.contextWindow).toBe(1048576)
    expect(collapsed[0]?.sources?.contextWindow).toBe('models.dev')
  })

  it('keeps a saved order authoritative so deselection sticks', () => {
    const discovered = collapseAntigravityModels([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
    ])
    const applied = applyCatalogOverlay(discovered, ['gemini-3.7-flash'], {})
    expect(applied.map(model => model.id)).toEqual(['gemini-3.7-flash'])
    expect(applyCatalogOverlay(discovered, undefined, undefined).map(model => model.id)).toEqual(['gemini-3.8-flash', 'gemini-3.7-flash'])
    expect(applyCatalogOverlay(discovered, [], {}).map(model => model.id)).toEqual([])
    const manual = applyCatalogOverlay(discovered, ['custom-id'], { 'custom-id': { name: 'Custom' } })
    expect(manual.map(model => model.id)).toEqual(['custom-id'])
  })

  it('flags the fields a saved override carries, and a rename on top of them', () => {
    const discovered = collapseAntigravityModels([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ])
    const applied = applyCatalogOverlay(discovered, undefined, {
      'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', vision: true, reasoning: { efforts: [{ id: 'high', name: 'High' }, { id: 'low', name: 'Low' }], defaultEffort: 'low' } },
    })
    // Every fired field is flagged even where the composed value matches discovery:
    // an override the user saved stays visible to the client so no later save drops it.
    expect(applied[0]?.overrides).toEqual({ vision: true, defaultEffort: true })
    expect(applied[0]?.reasoning?.defaultEffort).toBe('low')
  })

  it('keeps a stored override that equals the discovered value, including the preset', () => {
    const discovered = collapseAntigravityModels([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
    ])
    expect(discovered[0]?.reasoning?.defaultEffort).toBe('high')
    // The user picked the level the catalog already presets: the value matches, the
    // override is still stored, so the next save must carry it instead of dropping it.
    const applied = applyCatalogOverlay(discovered, undefined, {
      'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', reasoning: { efforts: discovered[0]!.reasoning!.efforts, defaultEffort: 'high' } },
    })
    expect(applied[0]?.reasoning?.defaultEffort).toBe('high')
    expect(applied[0]?.overrides?.defaultEffort).toBe(true)
  })

  it('flags a renamed row and a manual row, which has no discovery to differ from', () => {
    const discovered = collapseAntigravityModels([{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }])
    const renamed = applyCatalogOverlay(discovered, undefined, { 'gemini-3.8-flash': { name: 'Fast' } })
    expect(renamed[0]?.overrides).toEqual({ name: true })
    const manual = applyCatalogOverlay(discovered, ['custom-id'], { 'custom-id': { name: 'Custom', vision: true } })
    expect(manual[0]?.overrides).toEqual({ name: true, vision: true })
  })

  it('maps logical id plus effort back to discovered native ids only', () => {
    const native = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-pro-agent']
    expect(nativeAntigravityModelId('gemini-3.8-flash', 'medium', native)).toBe('gemini-3.8-flash-medium')
    expect(nativeAntigravityModelId('gemini-3.8-flash', undefined, native)).toBe('gemini-3.8-flash-high')
    expect(nativeAntigravityModelId('gemini-pro-agent', 'high', native, [], { high: 'gemini-pro-agent' })).toBe('gemini-pro-agent')
    expect(nativeAntigravityModelId('gemini-3.1-pro', 'high', ['gemini-3.1-pro', 'gemini-pro-agent'], [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])).toBe('gemini-pro-agent')
    expect(nativeAntigravityModelId('gemini-3.1-pro', 'default', ['gemini-3.1-pro', 'gemini-pro-agent'])).toBe('gemini-3.1-pro')
    expect(() => nativeAntigravityModelId('gemini-3.8-flash', 'high', [])).toThrow(/effort/)
  })
})
