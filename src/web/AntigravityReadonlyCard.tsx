/* Plugin-owned read-only card for folded native sidecar rows.
 *
 * Replaces the former private host GenericToolCard import (never a public
 * export on any official ui-tool release): activity, result, status, and
 * accessibility are rendered here from the presentation-only block built by
 * native-tool-card. No host callbacks exist at this surface, so argument
 * paths render as plain text: nothing opens, nothing inspects, nothing
 * dispatches or executes. Unknown tool names stay verbatim.
 */
import type { JSX } from 'react'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AcpSettingsKey } from './locales.js'

/* Render one folded native row as a read-only card. */
export function AntigravityReadonlyCard({ callId, toolName, nativeName, block, t }: {
  readonly callId: string
  readonly toolName: string
  readonly nativeName: string
  readonly block: ToolCallBlock
  readonly t: (key: AcpSettingsKey) => string
}): JSX.Element {
  let status = t('statusRunning')
  let state = 'running'
  let args: string
  let result: string | undefined
  if ('kind' in block) {
    status = block.isError ? t('statusFailed') : t('statusCompleted')
    state = block.isError ? 'error' : 'done'
    args = block.call?.argsRaw ?? ''
    result = block.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')
  } else {
    args = block.argsRaw
  }
  const settled = result !== undefined
  const failed = state === 'error'
  const renamed = nativeName !== '' && nativeName !== toolName
  return <article
    data-native-tool-card={callId}
    data-state={state}
    title={renamed ? nativeName : toolName}
    aria-label={status + ': ' + (renamed ? nativeName + ' (' + toolName + ')' : toolName)}
    style={{ fontSize: 'var(--dsh-content-font-size-secondary, 13px)' }}
  >
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span data-card-status={state}>{status}</span>
      <span data-card-tool={toolName}>{toolName}</span>
      {renamed ? <span data-card-native-name={nativeName} style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{nativeName}</span> : null}
    </div>
    {args === '' ? null : <div data-card-args={args} style={{ whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-secondary)' }}>{flattenArgsText(args)}</div>}
    {!settled ? null : result === ''
      ? <div data-card-empty-result={true} style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{t('activityNoOutput')}</div>
      : <div data-card-result={failed ? 'error' : 'ok'} style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}
  </article>
}

/* Flatten canonical args JSON to one readable line; raw input passes through truncated. */
function flattenArgsText(argsRaw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return argsRaw.slice(0, 400)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return argsRaw.slice(0, 400)
  const parts: string[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (parts.length >= 6) break
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
    parts.push(key + ': ' + text.slice(0, 120))
  }
  return parts.join('  ').slice(0, 400)
}
