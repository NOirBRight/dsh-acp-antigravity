/** Evidence helpers for the ACP-only usage probe (probe-only).
 *
 * One update is evidence as its tag plus its key names plus preserved counter
 * paths; tool content is never recursed into. Counters survive ONLY as
 * numeric values in recognized counter fields found outside content,
 * rawInput, rawOutput, prompt, and auth payloads. Count recognition is narrow
 * (normalized plural Tokens / TokenCount endings plus known counter keys,
 * minus auth-adjacent names), so an access_token, refresh_token, or arbitrary
 * usage string is never token evidence and never persists raw.
 */
import { isRecord } from '../src/decode.js';

const COUNT_KEYS = ['inputtokens', 'outputtokens', 'totaltokens', 'thoughtokens', 'cachedreadtokens', 'cachedwritetokens', 'cachedtokens', 'reasoningtokens'];

const EXCLUDED = new Set(['content', 'rawinput', 'rawoutput', 'prompt', 'auth']);

const DIGITS = /^\d{1,32}$/;

export type Redacted = null | boolean | number | string | Redacted[] | { [key: string]: Redacted };

export type FrameVerdict = 'tokens-both' | 'tokens-raw-only' | 'tokens-decoded-only' | 'tokens-neither';

/** Whether a wire key names an actual token counter.
 * @param key - Raw object key from a JSON-RPC frame.
 * @returns True for normalized counter keys; auth-adjacent names never qualify.
 */
export function isCountKey(key: string): boolean {
  const normal = key.toLowerCase().split('_').join('');
  if (normal.includes('access') || normal.includes('refresh') || normal.includes('auth') || normal.includes('secret') || normal.includes('bearer')) return false;
  if (COUNT_KEYS.includes(normal)) return true;
  return normal.endsWith('tokens') || normal.endsWith('tokencount');
}

/** Whether a count-field value is usable evidence (finite number or digit string).
 * @param value - Raw value found under a counter key.
 * @returns True only for real counts; null, objects, and arbitrary strings fail.
 */
export function isCountValue(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && DIGITS.test(value);
}

/** Preserve one counter value: numbers and digit strings stay raw, anything else becomes its type. */
function keepCount(value: unknown): Redacted {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '[non-finite-number]';
  if (typeof value === 'string') return DIGITS.test(value) ? value : '[string:' + String(value.length) + ']';
  if (typeof value === 'boolean') return '[boolean]';
  if (value === null) return '[null]';
  if (Array.isArray(value)) return '[array:' + String(value.length) + ']';
  return '[object]';
}

/** Collect preserved counter paths while skipping tool and auth payloads.
 * @param value - Subtree to inspect.
 * @param found - Accumulator for dotted paths to preserved counter values.
 * @param path - Dotted path of the current subtree, empty at the inspected root.
 */
function collectCounters(value: unknown, found: Record<string, Redacted>, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCounters(item, found, path === '' ? String(index) : path + '.' + String(index)));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const entry of Object.entries(value)) {
    if (EXCLUDED.has(entry[0].toLowerCase().split('_').join(''))) continue;
    const at = path === '' ? entry[0] : path + '.' + entry[0];
    if (isCountKey(entry[0])) found[at] = keepCount(entry[1]);
    else collectCounters(entry[1], found, at);
  }
}

/** Find preserved counter paths inside telemetry subtrees.
 * @param value - Update or result subtree; content, rawInput, rawOutput, prompt, and auth payloads are never descended into.
 * @returns Dotted paths to raw numeric counts (or type markers for invalid fields).
 */
export function findCounters(value: unknown): Record<string, Redacted> {
  const found: Record<string, Redacted> = {};
  collectCounters(value, found, '');
  return found;
}

/** Whether a wire value carries usable token counts outside tool and auth payloads.
 * @param value - Raw frame or subtree.
 * @returns True only for real count fields with numeric values; usage:null,
 * context counters such as used/size/cost, and any counters nested inside
 * content, rawInput, rawOutput, prompt, or auth payloads never qualify.
 */
export function hasTokenCounts(value: unknown): boolean {
  return Object.values(findCounters(value)).some(isCountValue);
}
/** Evidence for one session/update notification: tag, key shape, and counter paths.
 */
export interface UpdateEvidence {
  readonly tag: string | null
  readonly keys: readonly string[]
  readonly counters: Record<string, Redacted>
}

/** Describe one update without copying tool content.
 * @param update - Raw or decoded update object.
 * @returns Tag, key names, and preserved counter paths only.
 */
export function describeUpdate(update: unknown): UpdateEvidence {
  if (!isRecord(update)) return { tag: null, keys: [], counters: {} };
  const tag = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : null;
  return { tag, keys: Object.keys(update), counters: findCounters(update) };
}

/** Evidence for one prompt result: stop reason plus counter paths.
 */
export interface ResultEvidence {
  readonly stopReason: string
  readonly counters: Record<string, Redacted>
}

/** Describe one prompt result without opaque content.
 * @param result - Raw or decoded prompt result object.
 * @returns Known stop reason and preserved counter paths only.
 */
export function describeResult(result: unknown): ResultEvidence {
  const stopReason = isRecord(result) && typeof result.stopReason === 'string' ? result.stopReason : '[missing]';
  return { stopReason, counters: isRecord(result) ? findCounters(result) : {} };
}

/** Classify one raw-versus-decoded pair.
 * @param rawHas - Whether the raw frame carries usable count fields.
 * @param decodedHas - Whether the decoded frame still carries them.
 * @returns tokens-raw-only exactly when decoding dropped observed counts.
 */
export function frameVerdict(rawHas: boolean, decodedHas: boolean): FrameVerdict {
  if (rawHas && decodedHas) return 'tokens-both';
  if (rawHas) return 'tokens-raw-only';
  if (decodedHas) return 'tokens-decoded-only';
  return 'tokens-neither';
}

/** Whether a raw notification is a session/update for the requested session.
 * @param frame - Parsed raw line.
 * @param sessionId - Session id returned by session/new for this capture.
 * @returns True only for in-scope updates; init/auth/other traffic is skipped.
 */
export function isSessionUpdateFor(frame: unknown, sessionId: string): boolean {
  if (!isRecord(frame) || frame.method !== 'session/update') return false;
  return isRecord(frame.params) && frame.params.sessionId === sessionId;
}

/** Classification of one capture turn for exit status and omission verdicts.
 */
export interface TurnClassification {
  readonly status: 'complete' | 'incomplete'
  readonly reason: string
  readonly exitCode: number
}

/** Classify a capture turn: only a settled prompt may speak of omission.
 * @param sawPromptError - Whether the prompt turn failed, timed out, or blocked.
 * @param reason - Fixed failure category, if any.
 * @returns Complete with exit 0, or incomplete with exit 3 and its reason.
 */
export function classifyTurn(sawPromptError: boolean, reason: string): TurnClassification {
  if (!sawPromptError) return { status: 'complete', reason: '', exitCode: 0 };
  return { status: 'incomplete', reason, exitCode: 3 };
}

/** Map a probe failure to a fixed category; the original message is never printed.
 * @param error - Whatever the failed step threw.
 * @returns One of timeout, auth, config, exists, transport, or unknown.
 */
export function errorCategory(error: unknown): string {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  if (code === 'EEXIST') return 'exists';
  if (code === 'ENOENT') return 'config';
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
    const text = (error.name + ' ' + error.message).toLowerCase();
    if (text.includes('lab config')) return 'config';
    if (text.includes('timed out') || text.includes('timeout') || text.includes('abort')) return 'timeout';
    if (text.includes('auth') || text.includes('oauth') || text.includes('unauthorized') || text.includes('forbidden') || text.includes('credential') || text.includes('login')) return 'auth';
    return 'transport';
  }
  return 'unknown';
}
