import type { ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'

/** Receipt-time output interval. Native running-tool waits and host permission
 * blocks are clamped out of the assistant-delta window. Thought time and
 * pending-only permission previews are not in tok/s. */
export class GenerationTimer {
  private firstText: number | undefined
  private lastText: number | undefined
  private previous = -Infinity
  private invalid = false
  private readonly active = new Set<string>()
  private readonly finished = new Set<string>()
  private toolStart = 0
  private readonly waits: [number, number][] = []

  /** Observe native activity using one monotonic clock; unrelated events do not affect the interval. */
  observe(event: ExternalAgentEvent, at: number): void {
    if (!Number.isFinite(at) || at < this.previous) this.invalid = true
    this.previous = at
    if (event.type === 'assistant-delta') {
      if (event.text === '') return
      this.firstText ??= at
      this.lastText = at
    } else if (event.type === 'tool-activity') {
      if (event.status === 'pending') return
      if (event.status === 'running') {
        if (this.finished.has(event.toolId)) this.invalid = true
        if (this.active.size === 0) this.toolStart = at
        this.active.add(event.toolId)
      } else if (this.active.delete(event.toolId)) {
        this.finished.add(event.toolId)
        if (this.active.size === 0) this.waits.push([this.toolStart, at])
      }
    }
  }

  /** Return first-to-last assistant-delta milliseconds minus clamped tool waits, or null when not measurable. */
  elapsedMs(): number | null {
    const { firstText: first, lastText: last } = this
    if (this.invalid || this.active.size > 0 || first === undefined || last === undefined) return null
    const waited = this.waits.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, last) - Math.max(start, first)), 0)
    const elapsed = last - first - waited
    return elapsed > 0 ? elapsed : null
  }
}
