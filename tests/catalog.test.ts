import { describe, expect, it } from 'vitest'
import { applyCatalogOverlay, collapseAntigravityModels, nativeAntigravityModelId, peelEffort } from '../src/catalog.js'
import { mergeModelFacts } from '../src/model-metadata.js'

describe('Antigravity catalog collapse', () => {
  it('peels high/medium/low into one logical id', () => {
    expect(peelEffort('gemini-3.8-flash-high')).toEqual({ logical: 'gemini-3.8-flash', effort: 'high' })
    expect(peelEffort('gemini-pro-agent')).toEqual({ logical: 'gemini-pro-agent' })
  })

  it('exposes discovered High/Medium/Low without inventing a default', () => {
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
    expect(flash?.reasoning?.defaultEffort).toBeUndefined()
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
    expect(collapsed[0]?.reasoning?.defaultEffort).toBeUndefined()
    expect(collapsed[0]?.effortMap.high).toBe('gemini-pro-agent')
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

  it('flags only fields that differ from discovery', () => {
    const discovered = collapseAntigravityModels([
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ])
    const base = discovered.find(model => model.id === 'gemini-3.8-flash')!
    const applied = applyCatalogOverlay(discovered, undefined, {
      'gemini-3.8-flash': { ...base, name: 'Renamed', vision: base.vision === true ? false : true },
    })
    expect(applied[0]?.overrides).toEqual({ name: true, vision: true })
    expect(applyCatalogOverlay(discovered, undefined, { 'gemini-3.8-flash': { ...base } })[0]?.overrides).toBeUndefined()
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
