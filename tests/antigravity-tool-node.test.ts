/** Real Antigravity tool-row tests: typed definition fold plus server-rendered markup. Keyless with synthetic session events; no network or session store. */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatNode, ChatNodeKind, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { AntigravityToolNode, antigravityToolDefinition } from '../src/web/AntigravityToolNode.tsx'
import type { AntigravityToolState } from '../src/tool-events.js'

/** Official typed seam: the augmentation admits antigravity-tool as a ChatNodeKind. */
const toolKind: ChatNodeKind = 'antigravity-tool'

it('exposes the official chat kind seam', () => {
  expect(toolKind).toBe('antigravity-tool')
})

function stateOf(node: ChatNode<'antigravity-tool'>): AntigravityToolState {
  return node.data
}

/** Minimal renderer props; the row only reads node. */
function viewProps(data: AntigravityToolState): ChatNodeViewProps<'antigravity-tool'> {
  return {
    node: {
      key: 'antigravity-tool:tool-1',
      kind: 'antigravity-tool',
      id: 'tool-1',
      target: 'chat',
      anchorSeq: 7,
      location: { kind: 'unresolved' },
      visibility: 'visible',
      data,
    },
  } as ChatNodeViewProps<'antigravity-tool'>
}

function render(data: AntigravityToolState): string {
  return renderToStaticMarkup(createElement(AntigravityToolNode, viewProps(data)))
}

function buttonInner(html: string): string {
  return html.match(/<button[\s\S]*?<\/button>/)?.[0] ?? ''
}

const startEvent: SessionEvent = { type: 'antigravity/tool-start', seq: SessionSeq(7), time: 1_700_000_000_000, data: { toolId: 'tool-1', name: 'read', status: 'running' } }
const updateEvent: SessionEvent = { type: 'antigravity/tool-update', seq: SessionSeq(8), time: 1_700_000_000_001, data: { toolId: 'tool-1', status: 'completed', output: 'done' } }
const unresolved = { kind: 'unresolved' } as const

describe('antigravity tool definition', () => {
  it('matches tool lifecycles and rejects unrelated or malformed events', () => {
    expect(antigravityToolDefinition.match(startEvent)).toEqual({ id: 'tool-1', role: 'start' })
    expect(antigravityToolDefinition.match(updateEvent)).toEqual({ id: 'tool-1', role: 'update' })
    expect(antigravityToolDefinition.match({ type: 'user/message', data: {} })).toBeNull()
    expect(antigravityToolDefinition.match({ type: 'antigravity/tool-start', data: { toolId: '', name: 'x', status: 'running' } })).toBeNull()
    expect(antigravityToolDefinition.match({ type: 'antigravity/tool-update', data: { toolId: 'tool-1', status: 'exploding' } })).toBeNull()
  })

  it('folds start then update and materializes a chat node', () => {
    const base = { key: 'antigravity-tool:tool-1', kind: 'antigravity-tool', id: 'tool-1', matches: [], start: undefined, current: new Map() }
    const startMatch = { event: startEvent, role: 'start' as const, location: unresolved }
    const state = antigravityToolDefinition.start({ ...base, state: undefined }, startMatch, { previous: () => undefined })
    expect(state).toMatchObject({ toolId: 'tool-1', name: 'read', status: 'running' })
    const updated = antigravityToolDefinition.update(
      { ...base, state, matches: [{ event: startEvent, role: 'start' as const, location: unresolved }] },
      { event: updateEvent, role: 'update' as const, location: unresolved },
    )
    expect(updated).toMatchObject({ status: 'completed', output: 'done' })
    expect(antigravityToolDefinition.publication?.({ event: updateEvent, role: 'update' as const, location: unresolved })).toBe('immediate')
    expect(antigravityToolDefinition.publication?.(startMatch)).toBe('animation-frame')
    const node = antigravityToolDefinition.buildViewNode?.({
      ...base,
      state: updated,
      start: startMatch,
      matches: [{ event: updateEvent, role: 'update' as const, location: unresolved }],
    })
    expect(node).toMatchObject({ kind: 'antigravity-tool', target: 'chat', id: 'tool-1', anchorSeq: 7, visibility: 'visible' })
    if (node === null || node === undefined) throw new Error('tool node was not materialized')
    expect(stateOf(node as ChatNode<'antigravity-tool'>)).toMatchObject({ toolId: 'tool-1' })
    expect(antigravityToolDefinition.buildViewNode?.({ ...base, state: undefined, start: undefined, matches: [] })).toBeNull()
  })
})

describe('AntigravityToolNode', () => {
  it('does not turn replayed script or data destinations into clickable links', () => {
    for (const target of ['javascript:alert(1)', 'data:text/html,unsafe', 'not a URL']) {
      const html = render({ toolId: 'tool-1', name: 'fetch', status: 'completed', location: { target, kind: 'url' } })
      expect(html).not.toContain('<a ')
    }
  })

  it('renders the header trigger without nesting a link inside the button', () => {
    const html = render({ toolId: 'tool-1', name: 'read', status: 'running', location: { target: '/tmp/x', kind: 'file' } })
    expect(html).toContain('read')
    expect(html).toContain('running')
    expect(buttonInner(html)).not.toContain('<a ')
    expect(html.indexOf('<a ')).toBeGreaterThan(html.indexOf('</button>'))
    expect(html).toContain('href="file:///tmp/x"')
  })

  it('keeps the open detail collapsed with a fold affordance', () => {
    const html = render({ toolId: 'tool-1', name: 'read', status: 'completed', output: 'done' })
    expect(html).toContain('⌄')
    expect(html).not.toContain('<pre')
  })

  it('renders url locations as blank-target links', () => {
    const html = render({ toolId: 'tool-1', name: 'fetch', status: 'completed', location: { target: 'https://example.invalid/x', kind: 'url' } })
    expect(html).toContain('href="https://example.invalid/x"')
    expect(html).toContain('target="_blank"')
  })

  it('uses only verified DSH theme tokens', () => {
    const running = render({ toolId: 'tool-1', name: 'read', status: 'running' })
    expect(running).toContain('--dsw-alias-state-warn-primary')
    const failed = render({ toolId: 'tool-1', name: 'read', status: 'failed', error: 'boom' })
    expect(failed).toContain('--dsw-alias-state-error-primary')
    const completed = render({ toolId: 'tool-1', name: 'read', status: 'completed' })
    expect(completed).toContain('--dsw-alias-state-success-primary')
    for (const html of [running, failed, completed]) {
      expect(html).toContain('--dsw-alias-border-l2')
      expect(html).toContain('--dsw-alias-bg-layer-1')
      expect(html).not.toContain('--dsw-alias-border-secondary')
      expect(html).not.toContain('--dsw-alias-background-secondary')
      expect(html).not.toContain('--dsw-alias-background-tertiary')
      expect(html).not.toContain('--dsw-alias-label-secondary')
      expect(html).not.toContain('--dsw-alias-label-link')
      expect(html).not.toContain('--dsw-alias-function')
      expect(html).not.toContain('--dsw-alias-danger')
      expect(html).not.toContain('--dsw-alias-success')
    }
  })
})
