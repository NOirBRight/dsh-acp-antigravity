import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { decodeActivityHistory, type AntigravityActivityHistory, type AntigravityActivityRecord } from '../src/activity-contract.ts'
import { foldActivityRecords, AntigravityActivityView } from '../src/web/AntigravityActivityView.tsx'
import { AntigravityToolNode } from '../src/web/AntigravityToolNode.tsx'
import { en } from '../src/web/locales.ts'

/** Two native startups reusing one tool id, plus an orphan update and a link-bearing row. */
const historyWire = {
  version: 1,
  records: [
    { seq: 1, time: '2026-09-06T03:00:00.000Z', type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
    { seq: 2, time: '2026-09-06T03:00:01.000Z', type: 'antigravity/tool-start', data: { toolId: 'read', name: 'Read', status: 'running', location: { target: '/tmp/a.txt', kind: 'file' } } },
    { seq: 3, time: '2026-09-06T03:00:02.000Z', type: 'antigravity/tool-update', data: { toolId: 'read', status: 'completed', output: 'first' } },
    { seq: 4, time: '2026-09-06T03:05:00.000Z', type: 'antigravity/session-ready', data: { provider: 'antigravity' } },
    { seq: 5, time: '2026-09-06T03:05:01.000Z', type: 'antigravity/tool-start', data: { toolId: 'read', name: 'Read', status: 'running' } },
    { seq: 6, time: '2026-09-06T03:05:02.000Z', type: 'antigravity/tool-update', data: { toolId: 'read', status: 'failed', error: 'boom' } },
    { seq: 7, time: '2026-09-06T03:05:03.000Z', type: 'antigravity/tool-update', data: { toolId: 'fetch', status: 'completed', location: { target: 'https://example.com/x', kind: 'url' }, output: 'page' } },
  ],
}

function decoded(): AntigravityActivityHistory {
  return decodeActivityHistory(historyWire)
}

describe('antigravity activity sidecar', () => {
  it('decodes a versioned history and rejects malformed wire values', () => {
    expect(decoded().records).toHaveLength(7)
    expect(decodeActivityHistory({ version: 1, records: [] })).toEqual({ version: 1, records: [] })
    expect(() => decodeActivityHistory({ version: 1, records: [{ ...historyWire.records[1], time: 'not-a-time' }] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [{ ...historyWire.records[1], type: 'antigravity/unknown' }] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [{ ...historyWire.records[1], data: null }] })).toThrow()
    expect(() => decodeActivityHistory({ version: '1', records: [] })).toThrow()
    expect(() => decodeActivityHistory({ version: 1, records: [historyWire.records[1], historyWire.records[1]] })).toThrow()
  })

  it('drops non-http(s) tool destinations while keeping file and https links', () => {
    const start = historyWire.records[1] as Record<string, unknown>
    const data = start.data as Record<string, unknown>
    const ftp = { version: 1, records: [{ ...start, seq: 1, data: { ...data, location: { target: 'ftp://example.com/x', kind: 'url' } } }] }
    const decodedFtp = decodeActivityHistory(ftp)
    expect(decodedFtp.records).toHaveLength(1)
    const ftpMarkup = renderToStaticMarkup(createElement(AntigravityToolNode, {
      row: foldActivityRecords(decodedFtp.records)[0]!,
      noOutput: en.activityNoOutput,
    }))
    expect(ftpMarkup).toContain('ftp://example.com/x')
    expect(ftpMarkup).not.toContain('href=')
    const relative = { version: 1, records: [{ ...start, seq: 1, data: { ...data, location: { target: 'relative/path', kind: 'file' } } }] }
    expect(decodeActivityHistory(relative)?.records).toHaveLength(1)
  })

  it('folds repeated native tool ids into one row per startup', () => {
    const rows = foldActivityRecords(decoded().records)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ state: { toolId: 'read', name: 'Read', status: 'completed', output: 'first' }, time: '2026-09-06T03:00:02.000Z' })
    expect(rows[0]?.state.location).toEqual({ target: '/tmp/a.txt', kind: 'file' })
    expect(rows[1]).toMatchObject({ state: { toolId: 'read', status: 'failed', error: 'boom' }, time: '2026-09-06T03:05:02.000Z' })
    expect(rows[1]?.key).not.toBe(rows[0]?.key)
    expect(rows[2]).toMatchObject({ state: { toolId: 'fetch', name: 'native tool', status: 'completed', output: 'page' } })
  })

  it('keeps newline-bearing tool ids distinct from repeated plain ids', () => {
    const records: AntigravityActivityRecord[] = [
      { seq: 1, time: '2026-09-06T03:00:01.000Z', type: 'antigravity/tool-start', data: { toolId: 'a', name: 'A', status: 'running' } },
      { seq: 2, time: '2026-09-06T03:00:02.000Z', type: 'antigravity/tool-start', data: { toolId: 'a', name: 'A', status: 'running' } },
      { seq: 3, time: '2026-09-06T03:00:03.000Z', type: 'antigravity/tool-start', data: { toolId: 'a\n1', name: 'A1', status: 'running' } },
      { seq: 4, time: '2026-09-06T03:00:04.000Z', type: 'antigravity/tool-update', data: { toolId: 'a\n1', status: 'completed', output: 'ok' } },
    ]
    const rows = foldActivityRecords(records)
    expect(rows.map(row => row.key)).toEqual(['1', '2', '3'])
    expect(rows.map(row => row.state.toolId)).toEqual(['a', 'a', 'a\n1'])
    expect(rows[2]).toMatchObject({ state: { status: 'completed', output: 'ok' } })
  })

  it('keeps both rows when a native id repeats without a session-ready marker', () => {
    const history = decoded()
    const repeated = foldActivityRecords([...history.records, {
      seq: 8, time: '2026-09-06T03:06:00.000Z', type: 'antigravity/tool-start' as const,
      data: { toolId: 'read', name: 'Read', status: 'pending' as const },
    }])
    expect(repeated.filter(row => row.state.toolId === 'read')).toHaveLength(3)
  })

  it('renders status, time, path, and output for every folded row', () => {
    const rows = foldActivityRecords(decoded().records)
    const markup = rows.map(row => renderToStaticMarkup(createElement(AntigravityToolNode, { row, noOutput: en.activityNoOutput }))).join('\n')
    expect(markup).toContain('Read')
    expect(markup).toContain('completed')
    expect(markup).toContain('failed')
    expect(markup).toContain('/tmp/a.txt')
    expect(markup).toContain('https://example.com/x')
    expect(markup).toContain('first')
    expect(markup).toContain('boom')
    expect(markup).toContain('dateTime="2026-09-06T03:00:02.000Z"')
  })

  it('renders the sidecar loading state without fetching', () => {
    const markup = renderToStaticMarkup(createElement(AntigravityActivityView, {
      t: (key: keyof typeof en) => en[key],
      read: () => new Promise<AntigravityActivityHistory>(() => {}),
    } as never))
    expect(markup).toContain(en.activityLoading)
    expect(markup).toContain(en.activityRefresh)
  })
})
