import { expect, it, vi } from 'vitest'
import {
  ExternalAgentProviderRegistry,
  providerId,
  sessionId,
  type ExternalAgentTurnRequest,
} from '@deepseek-ai/dsh-acp-provider'
import { createAntigravityLlmBridge } from '../src/llm-bridge.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const MODES = ['approval-required', 'auto-accept-edits', 'full-access'] as const
const IMAGE_REF = { attachmentId: 'att-1', mediaType: 'image/png', bytes: PNG.byteLength, width: 1, height: 1, name: 'palm.png' }

async function collect(stream: AsyncIterable<unknown>) {
  for await (const _chunk of stream) { /* drain */ }
}

async function streamTurns(messages: readonly unknown[], readImage?: (attachment: unknown) => Promise<{ data: Uint8Array; mimeType: string; name?: string }>) {
  const turns: ExternalAgentTurnRequest[] = []
  const provider = {
    info: { id: providerId('antigravity'), name: 'Antigravity' },
    listModels: async () => [{ id: 'gemini-pro', name: 'Gemini Pro', supportedModes: [...MODES] }],
    openSession: async () => ({
      ref: { provider: providerId('antigravity'), session: sessionId('s'), nativeSession: sessionId('n') },
      supportedModes: [...MODES],
      dispose: async () => undefined,
      runTurn: async (request: ExternalAgentTurnRequest) => {
        turns.push(request)
        return { status: 'completed' as const, text: 'ok' }
      },
    }),
  }
  const registry = new ExternalAgentProviderRegistry()
  const unregister = registry.register(provider as never)
  const adapter = createAntigravityLlmBridge(
    { registry, getProvider: () => provider as never }, undefined, undefined,
    readImage === undefined ? undefined : { readImage },
  )
  try {
    await collect(adapter.stream({ provider: 'antigravity', model: 'gemini-pro', sessionId: 's', messages }))
    return turns
  } finally {
    await adapter.dispose()
    await unregister()
  }
}

it('forwards the latest user image as an ACP attachment', async () => {
  const turns = await streamTurns([
    { source: { kind: 'user' }, content: [{ type: 'text', text: 'What is this?' }, { type: 'image', attachment: IMAGE_REF }] },
  ], async () => ({ data: PNG, mimeType: 'image/png', name: 'palm.png' }))
  expect(turns[0]?.prompt).toBe('What is this?')
  expect(turns[0]?.attachments).toEqual([{ name: 'palm.png', mimeType: 'image/png', data: PNG.toString('base64') }])
})

it('keeps an image-only follow-up on that message instead of reusing older text', async () => {
  const turns = await streamTurns([
    { source: { kind: 'user' }, content: 'Previous question.' },
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: IMAGE_REF }] },
  ], async () => ({ data: PNG, mimeType: 'image/png', name: 'palm.png' }))
  expect(turns[0]?.prompt).toBe('')
  expect(turns[0]?.attachments).toHaveLength(1)
})

it('does not start a native turn for a plugin-only title prompt', async () => {
  const turns = await streamTurns([
    { source: { kind: 'plugin', plugin: 'dsh-session-title-llm' }, role: 'user', content: [{ type: 'text', text: 'Generate the session title' }] },
  ])
  expect(turns).toEqual([])
})

it('fails closed when a user image has no durable attachment service', async () => {
  await expect(streamTurns([
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: IMAGE_REF }] },
  ])).rejects.toThrow('durable attachment service')
})

it('passes inline image data without reading the attachment store', async () => {
  const readImage = vi.fn()
  const turns = await streamTurns([
    { source: { kind: 'user' }, content: [{ type: 'image', name: 'inline.png', mimeType: 'image/png', data: PNG.toString('base64') }] },
  ], readImage)
  expect(readImage).not.toHaveBeenCalled()
  expect(turns[0]?.attachments).toEqual([{ name: 'inline.png', mimeType: 'image/png', data: PNG.toString('base64') }])
})
