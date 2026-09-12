import { expect, it } from 'vitest'
import { toolId, type ExternalAgentEvent } from '@deepseek-ai/dsh-acp-provider'
import { GenerationTimer } from '../src/generation-timer.js'

const text: ExternalAgentEvent = { type: 'assistant-delta', text: 'x' }
const thought: ExternalAgentEvent = { type: 'thought-delta', text: 'x' }
const tool = (id: string, status: Extract<ExternalAgentEvent, { type: 'tool-activity' }>['status'], name = 'test'): ExternalAgentEvent => ({ type: 'tool-activity', toolId: toolId(id), name, status })

it('excludes the union of parallel tools from the assistant-delta window', () => {
  const timer = new GenerationTimer()
  timer.observe(thought, 0)
  timer.observe(text, 50)
  timer.observe(tool('a', 'running'), 100)
  timer.observe(tool('b', 'running'), 200)
  timer.observe(tool('a', 'completed'), 300)
  timer.observe(tool('b', 'failed'), 400)
  timer.observe(tool('b', 'failed'), 410)
  timer.observe(text, 600)
  expect(timer.elapsedMs()).toBe(250)
})

it('leaves incomplete or malformed intervals unavailable', () => {
  const samples: [ExternalAgentEvent, number][][] = [
    [], [[text, 0]], [[text, 0], [thought, 0]],
    [[text, 0], [text, -1]], [[text, Number.NaN], [text, 10]],
    [[text, 0], [tool('a', 'running'), 10]],
  ]
  for (const sample of samples) {
    const timer = new GenerationTimer()
    for (const [event, at] of sample) timer.observe(event, at)
    expect(timer.elapsedMs()).toBeNull()
  }
})

it('clamps a tool wait that outlives the last assistant token instead of dropping the sample', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(text, 10)
  timer.observe(tool('a', 'running'), 20)
  timer.observe(tool('a', 'completed'), 30)
  expect(timer.elapsedMs()).toBe(10)
})

it('keeps overlapping assistant tokens measurable by clamping the concurrent wait', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(tool('a', 'running'), 10)
  timer.observe(text, 20)
  timer.observe(tool('a', 'completed'), 30)
  expect(timer.elapsedMs()).toBe(10)
})

it('ignores thought time, empty deltas, earlier tools, and later usage delivery', () => {
  const timer = new GenerationTimer()
  timer.observe(tool('a', 'running'), 0)
  timer.observe(tool('a', 'completed'), 10)
  timer.observe(thought, 20)
  timer.observe({ type: 'assistant-delta', text: '' }, 30)
  timer.observe(text, 120)
  timer.observe(text, 220)
  timer.observe({ type: 'usage', inputTokens: 1, outputTokens: 2 }, 300)
  expect(timer.elapsedMs()).toBe(100)
})

it('excludes a completed subagent wait the same as any other tool', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(tool('a', 'running', 'Running start_subagent'), 10)
  timer.observe(tool('a', 'completed'), 30)
  timer.observe(text, 40)
  expect(timer.elapsedMs()).toBe(20)
})

it('ignores a pending-only permission preview instead of covering the whole window', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(tool('ask', 'pending', 'Run invoke_subagent?'), 1)
  timer.observe(text, 40)
  timer.observe(tool('ask', 'failed', 'Run invoke_subagent?'), 50)
  expect(timer.elapsedMs()).toBe(40)
})

it('starts a wait at running, not at the preceding pending preview', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(tool('a', 'pending'), 5)
  timer.observe(tool('a', 'running'), 10)
  timer.observe(tool('a', 'completed'), 30)
  timer.observe(text, 40)
  expect(timer.elapsedMs()).toBe(20)
})

it('deducts a host permission block the same as a running tool', () => {
  const timer = new GenerationTimer()
  timer.observe(text, 0)
  timer.observe(tool('host-wait-1', 'running', 'host-wait'), 10)
  timer.observe(tool('host-wait-1', 'completed', 'host-wait'), 30)
  timer.observe(text, 40)
  expect(timer.elapsedMs()).toBe(20)
})
