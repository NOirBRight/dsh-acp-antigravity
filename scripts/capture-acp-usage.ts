// Lab probe: capture ACP-only usage evidence for one harmless native turn.
//
// Run with tsx (never executes without --run):
//   tsx scripts/capture-acp-usage.ts --help
//   tsx scripts/capture-acp-usage.ts --run --config <lab.json> --out <evidence.json>
// Exit codes: 0 complete turn, 1 failure (including existing output), 2 usage
// or config error, 3 incomplete turn (failed, timed out, or blocked: recorded
// but never called an omission).
//
// The launch spec comes from the existing buildAntigravityLaunchSpec helper fed
// by the supplied native provider config (same lab native config), so
// installation validation, environment scrubbing, and non-shell isolation stay
// intact with no catalog or quota calls. The ambient process environment is
// NEVER inherited: the helper receives an explicit lab-supplied base
// environment (defaulting to empty). A fully resolved spec may be supplied
// instead, but only with an explicit complete environment and literal
// non-shell flags; it skips installation validation, so prefer the helper.
// The evidence file is opened exclusive-mode 0600 BEFORE the turn is spent,
// so an existing file (and its permissions) can never be clobbered.
// Captures ONLY the requested session/update notifications plus the prompt
// result. Update summaries omit content; complete pre/post-SDK prompt results
// are retained in the private evidence file, never printed. Numeric
// strings stay raw (never coerced). No normalizer changes here.
import { closeSync, constants, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { providerInstanceId } from '@deepseek-ai/dsh-acp-provider'
import { spawnAntigravityAcp, type AcpWireObserver } from '../src/protocol.js'
import { buildAntigravityLaunchSpec, type AntigravityLaunchSpec } from '../src/installation.js'
import type { AntigravityProviderConfig } from '../src/types.js'
import { classifyTurn, describeResult, describeUpdate, errorCategory, frameVerdict, hasTokenCounts, isSessionUpdateFor } from './acp-evidence.js'

function usage(): string {
  return ['usage: capture-acp-usage --run --config <lab.json> --out <evidence.json> [--timeout-ms <n>]', '  --help            Show this help and exit without executing anything.', '  --run             Required intent flag; without it the script only shows usage.', '  --config <path>   Lab JSON: { provider: <native provider config>, baseEnv?: {...}, session: { cwd }, turn: { prompt } }', '                    or { launch: <complete spec with explicit env>, session: { cwd }, turn: { prompt } }.', '  --out <path>      Evidence JSON destination (mode 0600, refuses overwrite).', '  --timeout-ms <n>  Per-request timeout, default 120000.'].join(String.fromCharCode(10));
}

interface LabConfig {
  readonly provider?: Record<string, unknown>
  readonly launch?: Record<string, unknown>
  readonly baseEnv?: Record<string, string>
  readonly session: { readonly cwd: string }
  readonly turn: { readonly prompt: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error('lab config provider needs ' + key);
  return value;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string');
}

function readConfig(raw: unknown): LabConfig {
  if (!isRecord(raw)) throw new Error('lab config must be an object');
  if (raw.provider !== undefined && !isRecord(raw.provider)) throw new Error('lab config provider must be an object');
  if (raw.launch !== undefined && !isRecord(raw.launch)) throw new Error('lab config launch must be an object');
  if (raw.provider === undefined && raw.launch === undefined) throw new Error('lab config needs provider or launch');
  if (raw.baseEnv !== undefined && !isStringRecord(raw.baseEnv)) throw new Error('lab config baseEnv must be a string record');
  if (!isRecord(raw.session) || typeof raw.session.cwd !== 'string' || raw.session.cwd.length === 0) throw new Error('lab config needs session.cwd');
  if (!isRecord(raw.turn) || typeof raw.turn.prompt !== 'string' || raw.turn.prompt.length === 0) throw new Error('lab config needs turn.prompt');
  return raw as unknown as LabConfig;
}

async function resolveSpec(config: LabConfig): Promise<AntigravityLaunchSpec> {
  if (config.provider !== undefined) {
    const raw = config.provider;
    const provider: AntigravityProviderConfig = {
      executablePath: stringField(raw, 'executablePath'),
      harnessPath: stringField(raw, 'harnessPath'),
      stateDirectory: stringField(raw, 'stateDirectory'),
      instanceId: providerInstanceId(stringField(raw, 'instanceId')),
      ...(typeof raw.platform === 'string' ? { platform: raw.platform as NodeJS.Platform } : {}),
    };
    return buildAntigravityLaunchSpec(provider, config.session.cwd, config.baseEnv ?? {});
  }
  const launch = config.launch as Record<string, unknown>;
  if (typeof launch.command !== 'string' || launch.command.length === 0) throw new Error('lab config launch needs command');
  if (typeof launch.cwd !== 'string' || launch.cwd.length === 0) throw new Error('lab config launch needs cwd');
  if (!isStringRecord(launch.env)) throw new Error('lab config launch needs an explicit complete env');
  if (launch.shell !== false || launch.extendEnv !== false) throw new Error('lab config launch must stay non-shell');
  if (launch.args !== undefined && (!Array.isArray(launch.args) || !launch.args.every(item => typeof item === 'string'))) throw new Error('lab config launch args must be strings');
  return { command: launch.command, args: (launch.args ?? []) as readonly string[], cwd: launch.cwd, env: launch.env, shell: false, extendEnv: false };
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help')) { console.log(usage()); return 0; }
  const take = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 && at + 1 < argv.length ? argv[at + 1] : undefined;
  };
  const configPath = take('--config');
  const outPath = take('--out');
  const timeoutMs = Number(take('--timeout-ms') ?? '120000');
  if (!argv.includes('--run') || configPath === undefined || outPath === undefined || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    console.error(usage());
    return 2;
  }
  let config: LabConfig;
  try {
    config = readConfig(JSON.parse(await readFile(configPath, 'utf8')) as unknown);
  } catch (error) {
    console.error('capture failed: ' + errorCategory(error));
    return 2;
  }
  let spec: AntigravityLaunchSpec;
  try {
    spec = await resolveSpec(config);
  } catch (error) {
    console.error('capture failed: ' + errorCategory(error));
    return 1;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  let fd: number;
  try {
    fd = openSync(outPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    console.error('capture failed: ' + errorCategory(error));
    return 1;
  }
  let exit = 1;
  try {
    exit = await capture(fd, spec, config, timeoutMs, outPath);
    return exit;
  } catch (error) {
    console.error('capture failed: ' + errorCategory(error));
    return 1;
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Descriptor release must not mask the evidence status.
    }
  }
}

async function capture(fd: number, spec: AntigravityLaunchSpec, config: LabConfig, timeoutMs: number, outPath: string): Promise<number> {
  const raw: string[] = [];
  const updates: unknown[] = [];
  let promptResult: unknown;
  let sawPromptError = false;
  let reason = '';
  const observer: AcpWireObserver = {
    onRawLine: line => { raw.push(line) },
    onSessionUpdate: params => { updates.push(params) },
    onPromptResult: result => { promptResult = result },
    onPromptError: () => { sawPromptError = true },
  };
  const signal = AbortSignal.timeout(timeoutMs);
  const connection = spawnAntigravityAcp(spec, { observer });
  let sessionId = '';
  try {
    await connection.request('initialize', { protocolVersion: 1 }, signal);
    const opened = await connection.request('session/new', { cwd: config.session.cwd, mcpServers: [] }, signal) as { sessionId: string };
    sessionId = opened.sessionId;
    try {
      promptResult = await connection.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: config.turn.prompt }] }, signal);
    } catch (error) {
      sawPromptError = true;
      reason = errorCategory(error);
    }
  } catch (error) {
    sawPromptError = true;
    reason = errorCategory(error);
  } finally {
    try {
      await connection.close();
    } catch {
      // Teardown must not mask the captured evidence.
    }
  }
  const ended = isRecord(promptResult) && promptResult.stopReason === 'end_turn';
  const turn = classifyTurn(sawPromptError || !ended, reason || 'not-end-turn');
  const parsed = raw.map(line => { try { return JSON.parse(line) as unknown } catch { return undefined } });
  const wanted = parsed.filter(frame => isSessionUpdateFor(frame, sessionId));
  const kept = updates.filter(update => isRecord(update) && update.sessionId === sessionId);
  const updateOf = (holder: unknown): unknown => isRecord(holder) && isRecord(holder.params) ? holder.params.update : undefined;
  const decodedOf = (holder: unknown): unknown => isRecord(holder) ? holder.update : undefined;
  const frames = wanted.map((frame, index) => {
    const rawUpdate = updateOf(frame);
    const decodedUpdate = index < kept.length ? decodedOf(kept[index]) : undefined;
    const rawHas = hasTokenCounts(rawUpdate);
    const decodedHas = decodedUpdate !== undefined && hasTokenCounts(decodedUpdate);
    return { seq: index + 1, raw: describeUpdate(rawUpdate), decoded: decodedUpdate === undefined ? null : describeUpdate(decodedUpdate), verdict: frameVerdict(rawHas, decodedHas) };
  });
  let rawResultValue: unknown;
  for (const frame of parsed) {
    if (isRecord(frame) && isRecord(frame.result) && 'stopReason' in frame.result) { rawResultValue = frame.result; break; }
  }
  const text = JSON.stringify({
    tool: 'capture-acp-usage',
    capturedAt: new Date().toISOString(),
    runtime: { command: spec.command },
    status: turn.status,
    ...(turn.status === 'complete' ? {} : { reason: turn.reason }),
    frames,
    promptResult: {
      raw: rawResultValue ?? null,
      decoded: promptResult ?? null,
      rawSummary: describeResult(rawResultValue),
      decodedSummary: describeResult(promptResult),
      verdict: frameVerdict(hasTokenCounts(rawResultValue), hasTokenCounts(promptResult)),
      rejected: sawPromptError,
    },
    summary: {
      rawLines: raw.length,
      keptFrames: frames.length,
      skippedFrames: parsed.length - wanted.length,
      droppedBySdk: frames.filter(frame => frame.verdict === 'tokens-raw-only').length,
      missingInRaw: turn.status === 'complete' ? frames.filter(frame => frame.verdict === 'tokens-neither').length : 0,
      omissionWithheld: turn.status !== 'complete',
    },
  }, null, 2);
  const data = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < data.byteLength) offset += writeSync(fd, data, offset);
  const dropped = frames.filter(frame => frame.verdict === 'tokens-raw-only').length;
  console.log('status=' + turn.status + ' frames=' + String(frames.length) + ' droppedBySdk=' + String(dropped) + ' out=' + outPath);
  return turn.exitCode;
}

const code = await main(process.argv.slice(2)).catch(() => { console.error('capture failed: unknown'); return 1 });
process.exit(code);
