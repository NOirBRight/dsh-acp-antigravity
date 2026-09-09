import { describe, expect, it } from 'vitest'
import { collapseAntigravityModels, effortVariants, nativeAntigravityModelId, peelEffort } from '../src/catalog.js'

describe('Antigravity catalog collapse', () => {
  it('peels high/medium/low into one logical id', () => {
    expect(peelEffort('gemini-3.8-flash-high')).toEqual({ logical: 'gemini-3.8-flash', effort: 'high' })
    expect(peelEffort('gemini-pro-agent')).toEqual({ logical: 'gemini-pro-agent' })
  })

  it('exposes High/Medium/Low as reasoning efforts', () => {
    const collapsed = collapseAntigravityModels([
      { id: 'default', name: 'Account default' },
      { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])
    const flash = collapsed.find(model => model.id === 'gemini-3.8-flash')
    expect(flash?.name).toBe('Gemini 3.8 Flash')
    expect(flash?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium', 'low'])
    expect(flash?.reasoning?.defaultEffort).toBe('high')
    expect(collapsed.find(model => model.id === 'gemini-pro-agent')?.name).toBe('Gemini 3.1 Pro')
    expect(collapsed.find(model => model.id === 'gemini-pro-agent')?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
  })

  it('merges a High display-name alias with the unsuffixed Pro row', () => {
    const collapsed = collapseAntigravityModels([
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])
    expect(collapsed.map(model => model.id)).toEqual(['gemini-3.1-pro'])
    expect(collapsed[0]?.name).toBe('Gemini 3.1 Pro')
    expect(collapsed[0]?.reasoning?.efforts.map(effort => effort.id)).toEqual(['default', 'high'])
    expect(collapsed[0]?.reasoning?.defaultEffort).toBe('high')
  })


  it('maps high without a native catalog onto the suffixed ACP id', () => {
    expect(nativeAntigravityModelId('gemini-3.8-flash', 'high', [])).toBe('gemini-3.8-flash-high')
    const collapsed = collapseAntigravityModels(effortVariants('gemini-3.8-flash'))
    expect(collapsed[0]?.reasoning?.efforts.map(effort => effort.id)).toEqual(['default', 'high', 'medium', 'low'])
    expect(collapsed[0]?.reasoning?.defaultEffort).toBe('high')
  })

  it('maps logical id plus effort back to the native ACP id', () => {
    const native = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-pro-agent']
    expect(nativeAntigravityModelId('gemini-3.8-flash', 'medium', native)).toBe('gemini-3.8-flash-medium')
    expect(nativeAntigravityModelId('gemini-3.8-flash', undefined, native)).toBe('gemini-3.8-flash-high')
    expect(nativeAntigravityModelId('gemini-pro-agent', 'high', native)).toBe('gemini-pro-agent')
    expect(nativeAntigravityModelId('gemini-3.1-pro', 'high', ['gemini-3.1-pro', 'gemini-pro-agent'], [
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' },
      { id: 'gemini-pro-agent', name: 'Gemini 3.1 Pro (High)' },
    ])).toBe('gemini-pro-agent')
    expect(nativeAntigravityModelId('gemini-3.1-pro', 'default', ['gemini-3.1-pro', 'gemini-pro-agent'])).toBe('gemini-3.1-pro')
  })
})
