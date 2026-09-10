#!/usr/bin/env node
/**
 * Keyless stdio ACP agent peer for GUI composition of custom Other answers,
 * a one-prompt heading-regression article, and a pretoken runtime-lock hold. NDJSON JSON-RPC 2.0 on stdin/stdout.
 * No network, credentials, usage, or telemetry. Extra argv (linux `--uid=`) is ignored.
 */
import { createInterface } from 'node:readline'

const SESSION_ID = 'fixture-session-1'
const MODEL_OPTIONS = [{
  id: 'model',
  name: 'Model',
  type: 'select',
  currentValue: 'gemini-3.8-flash-high',
  options: [{ value: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash · High' }],
}]

function send(value) {
  process.stdout.write(JSON.stringify(value) + String.fromCharCode(10))
}

function fail(id, message, code = -32601) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function promptText(params) {
  if (!isRecord(params) || !Array.isArray(params.prompt)) return ''
  return params.prompt.map(part => isRecord(part) && typeof part.text === 'string' ? part.text : '').join('')
}

const ARTICLE_PROMPT = 'LAB heading regression'
const OTHER_PROMPT = 'LAB keyless Other question.'
const RUNTIME_LOCK_PROMPT = 'LAB runtime lock pretoken'
const ARTICLE = '# 计算的演化史与智能基础设施的未来构建' + String.fromCharCode(10) + String.fromCharCode(10) + '计算从算盘与机械装置走到电力与晶体管，再进入可编程计算机与大规模集成电路。每一次跃迁都把如何表示问题与如何稳定执行重新绑在一起，算法、存储、网络与能源成为同一套基础设施。今日的智能系统并不只是更大的模型，而是把数据、调度、工具与人机界面连成可运行的整体。文中出现的 Proceed 与 plan.md 只是普通叙述用语，用来说明标题和常见英文词并不会把一篇文章变成待批准的计划。'
const APPROVED_CONTINUATION = 'The user approved the plan. Carry it out now.'
const HOLD_ID = 'fixture-hold'

let nextAgentId = 1
const pending = new Map()
let cancelled = false
let articleTurn = false

function requestClient(method, params) {
  const id = 'fixture-q-' + String(nextAgentId++)
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method, params })
  })
}

function rejectPending(reason) {
  for (const [id, waiter] of pending) {
    pending.delete(id)
    waiter.reject(reason)
  }
}

async function handlePrompt(req) {
  cancelled = false
  const sessionId = isRecord(req.params) && typeof req.params.sessionId === 'string' ? req.params.sessionId : SESSION_ID
  const asked = promptText(req.params)
  if (articleTurn || asked.includes(APPROVED_CONTINUATION)) {
    fail(req.id, 'unexpected second prompt', -32602)
    return
  }
  if (asked.includes(ARTICLE_PROMPT)) {
    articleTurn = true
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ARTICLE } },
      },
    })
    send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } })
    return
  }
  if (!asked.includes(ARTICLE_PROMPT) && !asked.includes(RUNTIME_LOCK_PROMPT) && !asked.includes(OTHER_PROMPT) && asked.trim() !== '') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Received Other: ' + asked.trim() } },
      },
    })
    send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } })
    return
  }
  if (asked.includes(RUNTIME_LOCK_PROMPT)) {
    try {
      await new Promise((resolve, reject) => {
        pending.set(HOLD_ID, { resolve, reject })
        if (cancelled) {
          pending.delete(HOLD_ID)
          reject(new Error('cancelled'))
        }
      })
    } catch (error) {
      if (cancelled) {
        send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'cancelled' } })
        return
      }
      fail(req.id, error instanceof Error ? error.message : 'hold failed', -32000)
      return
    }
    fail(req.id, 'runtime lock hold released without cancel', -32602)
    return
  }
  let response
  try {
    response = await requestClient('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 'interaction_fixture', title: 'Pick one' },
      options: [
        { optionId: '1', kind: 'allow_once', name: 'First' },
        { optionId: '2', kind: 'allow_once', name: 'Second' },
      ],
    })
  } catch (error) {
    if (cancelled) {
      send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'cancelled' } })
      return
    }
    fail(req.id, error instanceof Error ? error.message : 'question failed', -32000)
    return
  }
  if (cancelled) {
    send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'cancelled' } })
    return
  }
  const outcome = isRecord(response) && isRecord(response.outcome) ? response.outcome.outcome : undefined
  if (outcome !== 'cancelled') {
    fail(req.id, 'expected cancelled Other, got ' + JSON.stringify(response), -32602)
    return
  }
  send({ jsonrpc: '2.0', id: req.id, result: { stopReason: 'end_turn' } })
}

function handle(message) {
  if (!isRecord(message)) return
  if (typeof message.method !== 'string') {
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error !== undefined) {
        const detail = isRecord(message.error) ? String(message.error.message ?? 'error') : 'error'
        waiter.reject(new Error(detail))
      } else waiter.resolve(message.result)
    }
    return
  }
  if (message.method === 'session/cancel') {
    cancelled = true
    rejectPending(new Error('cancelled'))
    if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })
    return
  }
  if (message.id === undefined) return
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'antigravity-acp', version: 'fixture' },
          agentCapabilities: { sessionCapabilities: { resume: {} } },
        },
      })
      return
    case 'authenticate':
      send({ jsonrpc: '2.0', id: message.id, result: {} })
      return
    case 'session/new':
      send({ jsonrpc: '2.0', id: message.id, result: { sessionId: SESSION_ID, configOptions: MODEL_OPTIONS } })
      return
    case 'session/resume':
      send({ jsonrpc: '2.0', id: message.id, result: { configOptions: MODEL_OPTIONS } })
      return
    case 'session/set_config_option':
      send({ jsonrpc: '2.0', id: message.id, result: { configOptions: MODEL_OPTIONS } })
      return
    case 'session/set_mode':
    case 'session/close':
      send({ jsonrpc: '2.0', id: message.id, result: {} })
      return
    case 'session/prompt':
      void handlePrompt(message).catch(error => {
        fail(message.id, error instanceof Error ? error.message : 'prompt failed', -32000)
      })
      return
    default:
      fail(message.id, 'Method not found: ' + message.method)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', line => {
  if (line.length === 0) return
  let message
  try { message = JSON.parse(line) } catch { /* stdio framing can emit a partial line; skip it. */ return }
  handle(message)
})
