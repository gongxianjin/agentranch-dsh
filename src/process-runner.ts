import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { clampTimeout, type PluginConfig } from './config.js';
import { redactModelOutput } from './redaction.js';

export type CommandSpec = {
  args: string[];
  purpose: 'identity' | 'check' | 'local-check' | 'runner' | 'controller';
};

export type CommandResult = {
  ok: boolean;
  command: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  json: unknown | null;
  jsonParseError: string | null;
  redacted: boolean;
  redactionHits: string[];
  diagnostics: string[];
};

function collectBounded(maxBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;
  return {
    add(chunk: Buffer | string) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxBytes - bytes);
      if (remaining > 0) {
        chunks.push(buffer.subarray(0, remaining));
        bytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) truncated = true;
    },
    finish() {
      const raw = Buffer.concat(chunks).toString('utf8');
      return { text: truncated ? `${raw}\n[output truncated]` : raw, truncated };
    },
  };
}

async function terminateTree(pid: number | undefined, diagnostics: string[]): Promise<void> {
  if (!pid) return;
  if (process.platform === 'win32') {
    const outcome = await new Promise<'terminated' | 'failed'>(resolve => {
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('error', () => resolve('failed'));
      killer.once('close', code => resolve(code === 0 ? 'terminated' : 'failed'));
    });
    // Report only what taskkill actually achieved; a failed kill must never
    // be presented to the model as a termination.
    diagnostics.push(outcome === 'terminated' ? 'process_tree_terminated' : 'process_tree_termination_failed');
  } else {
    diagnostics.push('windows_process_tree_not_run');
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
  }
}

/** Test hook for the termination-diagnostics contract; not part of the tool surface. */
export async function terminateTreeForTest(pid: number): Promise<string[]> {
  const diagnostics: string[] = [];
  await terminateTree(pid, diagnostics);
  return diagnostics;
}

async function runProcess(
  executable: string,
  args: string[],
  config: PluginConfig,
  requestedTimeout?: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  signal?.throwIfAborted();
  const started = performance.now();
  const stdout = collectBounded(config.maxOutputBytes);
  const stderr = collectBounded(config.maxOutputBytes);
  const diagnostics: string[] = [];
  const timeoutMs = clampTimeout(requestedTimeout, config);
  let timedOut = false;
  let spawnError: string | null = null;
  const child = spawn(executable, args, {
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', chunk => stdout.add(chunk));
  child.stderr?.on('data', chunk => stderr.add(chunk));
  let cancelled = false;
  let termination: Promise<void> | undefined;
  const terminate = () => { termination ??= terminateTree(child.pid, diagnostics); };
  const abort = () => { cancelled = true; diagnostics.push('cancelled'); terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, timeoutMs);
  const outcome = await new Promise<{ exitCode: number | null; signal: string | null }>(resolve => {
    child.once('error', error => { spawnError = error.message; });
    child.once('close', (code, signal) => resolve({ exitCode: code, signal }));
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', abort);
  await termination;
  if (spawnError) diagnostics.push('spawn_failed');
  const out = stdout.finish();
  const err = stderr.finish();
  const safeOut = redactModelOutput(out.text);
  const safeErr = redactModelOutput(spawnError ? `${err.text}\n${spawnError}` : err.text);
  let json: unknown | null = null;
  let jsonParseError: string | null = null;
  try { json = JSON.parse(safeOut.text); } catch { jsonParseError = 'stdout is not one complete JSON value'; }
  return {
    ok: !timedOut && !cancelled && !spawnError && outcome.exitCode === 0,
    command: [executable, ...args],
    exitCode: timedOut ? null : outcome.exitCode,
    signal: outcome.signal,
    timedOut,
    durationMs: Math.round(performance.now() - started),
    stdout: safeOut.text,
    stderr: safeErr.text,
    stdoutTruncated: out.truncated,
    stderrTruncated: err.truncated,
    json,
    jsonParseError,
    redacted: safeOut.redacted || safeErr.redacted,
    redactionHits: [...new Set([...safeOut.hits, ...safeErr.hits])],
    diagnostics,
  };
}

export async function runAwCli(
  spec: CommandSpec,
  config: PluginConfig,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return runProcess(config.awCliPath, spec.args, config, timeoutMs, signal);
}

/** Test fixture runner; not exported through the DSH package entry or registered as a tool. */
export async function runProcessForTest(
  executable: string,
  args: string[],
  config: PluginConfig,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return runProcess(executable, args, config, timeoutMs, signal);
}
