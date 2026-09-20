/** Antigravity event adapter for the shared bounded activity coalescer. */
import {
  ActivityCoalescer,
  ACTIVITY_COALESCE_WINDOW_MS,
  ACTIVITY_MAX_PENDING_BYTES,
  ACTIVITY_MAX_PENDING_RECORDS,
  ACTIVITY_MAX_TEXT_CHARS,
  ACTIVITY_TOOL_SKIP_FLUSH,
  type ActivityCoalescerCodec,
  type ActivityCoalescerSink as SharedActivityCoalescerSink,
  type CoalescibleActivityRecord,
} from '@deepseek-ai/dsh-acp-provider/activity-coalescer'
import {
  ANTIGRAVITY_AGENT_TEXT,
  ANTIGRAVITY_TOOL_UPDATE,
  type AntigravityAgentTextData,
  type AntigravityToolUpdateData,
} from './tool-events.js'
import type { AntigravityActivityEvent } from './activity-store.js'

export {
  ACTIVITY_COALESCE_WINDOW_MS,
  ACTIVITY_MAX_PENDING_BYTES,
  ACTIVITY_MAX_PENDING_RECORDS,
  ACTIVITY_MAX_TEXT_CHARS,
  ACTIVITY_TOOL_SKIP_FLUSH,
}
export type ActivityCoalescerSink = SharedActivityCoalescerSink<AntigravityActivityEvent>

const codec: ActivityCoalescerCodec<AntigravityActivityEvent> = {
  decode: event => {
    if (event.type === ANTIGRAVITY_AGENT_TEXT) {
      const { text, ...fields } = event.data
      return {
        kind: 'text',
        key: event.data.trajectoryId + '\u0000' + (event.data.parentTrajectoryId ?? '') + '\u0000' + event.data.kind,
        fields,
        text,
      }
    }
    if (event.type !== ANTIGRAVITY_TOOL_UPDATE || event.data.status === 'completed' || event.data.status === 'failed') return undefined
    const { toolId, status, output, error, ...fields } = event.data
    return { kind: 'tool', toolId, status, fields, ...(output === undefined ? {} : { output }), ...(error === undefined ? {} : { error }) }
  },
  encode: (record: CoalescibleActivityRecord): AntigravityActivityEvent => record.kind === 'text'
    ? { type: ANTIGRAVITY_AGENT_TEXT, data: { ...record.fields, text: record.text } as AntigravityAgentTextData }
    : { type: ANTIGRAVITY_TOOL_UPDATE, data: {
      toolId: record.toolId,
      status: record.status,
      ...record.fields,
      ...(record.output === undefined ? {} : { output: record.output }),
      ...(record.error === undefined ? {} : { error: record.error }),
    } as AntigravityToolUpdateData },
}

/** Bounded writer retaining Antigravity's public constructor and event types. */
export class AntigravityActivityCoalescer extends ActivityCoalescer<AntigravityActivityEvent> {
  constructor(sink: ActivityCoalescerSink, windowMs: number = ACTIVITY_COALESCE_WINDOW_MS) {
    super({ sink, codec, windowMs })
  }
}
