import { expect, it } from 'vitest'
import { toolId, type ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'
import { GenerationTimer } from '../src/generation-timer.js'

const text: ExternalAgentEvent = { type: 'assistant-delta', text: 'x' }
const thought: ExternalAgentEvent = { type: 'thought-delta', text: 'x' }
const tool = (id: string, status: Extract<ExternalAgentEvent, { type: 'tool-activity' }>['status'], name = 'test'): ExternalAgentEvent => ({ type: 'tool-activity', toolId: toolId(id), name, status })

it('excludes the union of parallel tools and ignores duplicate terminal updates', () => {
  const timer = new GenerationTimer()
  timer.observe(thought, 0)
  timer.observe(tool('a', 'running'), 100)
  timer.observe(tool('b', 'pending'), 200)
  timer.observe(tool('a', 'completed'), 300)
  timer.observe(tool('b', 'failed'), 400)
  timer.observe(tool('b', 'failed'), 410)
  timer.observe(text, 600)
  expect(timer.elapsedMs()).toBe(300)
})

it('leaves ambiguous or incomplete intervals unavailable rather than inflating speed', () => {
  const samples: [ExternalAgentEvent, number][][] = [
    [], [[text, 0]], [[text, 0], [thought, 0]],
    [[text, 0], [text, -1]], [[text, Number.NaN], [text, 10]],
    [[text, 0], [tool('a', 'running'), 10]],
    [[text, 0], [tool('a', 'completed'), 10], [text, 20]],
    [[text, 0], [tool('a', 'running'), 10], [text, 20], [tool('a', 'completed'), 30]],
    [[text, 0], [text, 10], [tool('a', 'running'), 20], [tool('a', 'completed'), 30]],
    [[text, 0], [tool('a', 'running', 'Running start_subagent'), 10], [tool('a', 'completed'), 30], [text, 40]],
  ]
  for (const sample of samples) {
    const timer = new GenerationTimer()
    for (const [event, at] of sample) timer.observe(event, at)
    expect(timer.elapsedMs()).toBeNull()
  }
})

it('uses first-to-last content time, excluding earlier tools and later usage delivery', () => {
  const timer = new GenerationTimer()
  timer.observe(tool('a', 'running'), 0)
  timer.observe(tool('a', 'completed'), 10)
  timer.observe(thought, 20)
  timer.observe({ type: 'assistant-delta', text: '' }, 30)
  timer.observe(text, 120)
  timer.observe({ type: 'usage', inputTokens: 1, outputTokens: 2 }, 200)
  expect(timer.elapsedMs()).toBe(100)
})
