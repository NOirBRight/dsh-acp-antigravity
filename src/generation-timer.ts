import type { ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'

/** Receipt-time throughput interval; native tool waits are excluded, ambiguous concurrency is unavailable. */
export class GenerationTimer {
  private first: number | undefined
  private last: number | undefined
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
    if (event.type === 'assistant-delta' || event.type === 'thought-delta') {
      if (event.text === '') return
      // ponytail: overlapping generation and tools are unavailable; per-request native timings can resolve them.
      if (this.active.size > 0) this.invalid = true
      this.first ??= at
      this.last = at
    } else if (event.type === 'tool-activity') {
      // ponytail: native delegation titles identify mixed-agent usage; custom tools need structured ownership metadata.
      if (event.name.toLowerCase().includes('subagent')) this.invalid = true
      if (event.status === 'pending' || event.status === 'running') {
        if (this.finished.has(event.toolId)) this.invalid = true
        if (this.active.size === 0) this.toolStart = at
        this.active.add(event.toolId)
      } else if (this.active.delete(event.toolId)) {
        this.finished.add(event.toolId)
        if (this.active.size === 0) this.waits.push([this.toolStart, at])
      } else if (!this.finished.has(event.toolId)) {
        this.invalid = true
      }
    }
  }

  /** Return first-to-last delta milliseconds minus the tool-interval union, or null when not measurable. */
  elapsedMs(): number | null {
    const { first, last } = this
    if (this.invalid || this.active.size > 0 || first === undefined || last === undefined) return null
    if (this.waits.some(([, end]) => end > last)) return null
    const waited = this.waits.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, last) - Math.max(start, first)), 0)
    const elapsed = last - first - waited
    return elapsed > 0 ? elapsed : null
  }
}
