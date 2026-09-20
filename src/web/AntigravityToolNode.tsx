/* One folded Antigravity sidecar row through the shared ACP read-only tool card. */
import type { JSX } from 'react'
import { NativeToolCard, type NativeToolTranslate } from '@deepseek-ai/dsh-acp-provider/native-ui'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AntigravityToolRowData } from './native-activity.js'
import { nativeToolCardModel } from './native-tool-card.js'

export function AntigravityToolNode({ row, conversationT }: {
  readonly row: AntigravityToolRowData
  readonly conversationT: TranslateNS<'conversation'>
}): JSX.Element {
  const translate: NativeToolTranslate = conversationT
  return <NativeToolCard {...nativeToolCardModel(row.state)} t={translate} />
}
