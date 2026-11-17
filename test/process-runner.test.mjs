import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = name => resolve(root, 'test', 'fixtures', name);

async function modules() {
  return {
    runner: await import(pathToFileURL(join(root, 'dist', 'process-runner.js')).href),
    terminateTreeForTest: (await import(pathToFileURL(join(root, 'dist', 'process-runner.js')).href)).terminateTreeForTest,
  };
}

function configFor(executable) {
  return {
    awCliPath: executable,
    allowedRoots: [root],
    defaultTimeoutMs: 1000,
    maxOutputBytes: 2048,
  };
}

test('passes argv as fixed arguments without shell interpolation', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(
    process.execPath,
    [fixture('emit-json.mjs'), 'space value', 'quote"value', '中文'],
    configFor(process.execPath),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.json.args, ['space value', 'quote"value', '中文']);
});

test('parses safe JSON and preserves safe output', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('emit-json.mjs')], configFor(process.execPath));
  assert.equal(result.ok, true);
  assert.deepEqual(result.json, { ok: true, args: [], message: 'safe output' });
  assert.match(result.stdout, /safe output/);
});

test('exposes non-zero exit and JSON parse failure', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('emit-json.mjs'), '--fail'], configFor(process.execPath));
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /fixture failure/);
  assert.ok(result.jsonParseError);
});

test('marks bounded output truncation', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('emit-json.mjs'), '--large'], { ...configFor(process.execPath), maxOutputBytes: 64 });
  assert.equal(result.ok, true);
  assert.equal(result.stdoutTruncated, true);
  assert.match(result.stdout, /truncated/i);
});

test('redacts private keys and common credential assignments', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('emit-secret.mjs')], configFor(process.execPath));
  assert.equal(result.ok, true);
  assert.equal(result.redacted, true);
  assert.ok(result.redactionHits.length >= 4);
  for (const secret of ['fixture-token', 'fixture-password', 'fixture-api-key', 'fixture-bearer', 'fixture-private-data']) {
    assert.equal(result.stdout.includes(secret) || result.stderr.includes(secret), false, secret);
  }
});

test('redacts JSON credential fields while keeping JSON and boundary markers parseable', async () => {
  const { redactModelOutput } = await import('../dist/redaction.js');
  const source = JSON.stringify({ token: 'json-token', password: 'json-pass', api_key: 'json-api', Authorization: 'Bearer json-bearer', active_probe: false, simulated: true, external_readiness: 'not_probed' });
  const safe = redactModelOutput(source);
  const json = JSON.parse(safe.text);
  for (const secret of ['json-token', 'json-pass', 'json-api', 'json-bearer']) assert.equal(safe.text.includes(secret), false, secret);
  assert.equal(json.active_probe, false);
  assert.equal(json.simulated, true);
  assert.equal(json.external_readiness, 'not_probed');
});

test('redacts a private key even when bounded output removed its end marker', async () => {
  const { redactModelOutput } = await import('../dist/redaction.js');
  const safe = redactModelOutput('-----BEGIN PRIVATE KEY-----\npartial-private-secret\n[output truncated]');
  assert.equal(safe.text.includes('partial-private-secret'), false);
  assert.equal(safe.redacted, true);
});

test('forwards cancellation to the owned process and fails closed before spawn', async () => {
  const { runner } = await modules();
  const cancelled = AbortSignal.abort();
  await assert.rejects(runner.runProcessForTest(process.execPath, [fixture('sleep-forever.mjs')], configFor(process.execPath), undefined, cancelled));
  const control = new AbortController();
  const work = runner.runProcessForTest(process.execPath, [fixture('sleep-forever.mjs')], { ...configFor(process.execPath), defaultTimeoutMs: 10000 }, undefined, control.signal);
  setTimeout(() => control.abort(), 150);
  const result = await work;
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, false);
  assert.ok(result.diagnostics.includes('cancelled'));
});

test('returns timeout without false success', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('sleep-forever.mjs')], { ...configFor(process.execPath), defaultTimeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test('records descendant handling on Windows and explicit not-run status elsewhere', async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('spawn-descendant.mjs')], { ...configFor(process.execPath), defaultTimeoutMs: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  if (process.platform === 'win32') {
    assert.equal(result.diagnostics.includes('process_tree_terminated'), true, 'termination diagnostic must reflect an actual successful kill');
    assert.equal(result.diagnostics.includes('process_tree_termination_failed'), false);
  } else {
    assert.equal(result.diagnostics.includes('windows_process_tree_not_run'), true);
  }
});

test('timeout actually kills the descendant process tree, not just records a diagnostic', { skip: process.platform !== 'win32' }, async () => {
  const { runner } = await modules();
  const result = await runner.runProcessForTest(process.execPath, [fixture('spawn-descendant.mjs')], { ...configFor(process.execPath), defaultTimeoutMs: 150 });
  assert.equal(result.timedOut, true);
  const descendantPid = Number.parseInt(result.stdout, 10);
  assert.ok(Number.isInteger(descendantPid), `fixture must print its descendant pid, got: ${JSON.stringify(result.stdout)}`);
  assert.equal(result.diagnostics.includes('process_tree_terminated'), true, 'kill must have been reported successful');
  await assertProcessGone(descendantPid);
});

test('termination diagnostics reflect taskkill failure instead of claiming success', { skip: process.platform !== 'win32' }, async () => {
  const { terminateTreeForTest } = await modules();
  // A pid that is guaranteed dead: spawn a process, wait for it to exit, then
  // terminate the stale tree. taskkill exits nonzero; the diagnostics must
  // report the failure, never 'process_tree_terminated'.
  const { spawn } = await import('node:child_process');
  const shortLived = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const deadPid = shortLived.pid;
  await new Promise(resolve => shortLived.once('close', resolve));
  const diagnostics = await terminateTreeForTest(deadPid);
  assert.equal(diagnostics.includes('process_tree_termination_failed'), true, `expected failure diagnostic, got: ${JSON.stringify(diagnostics)}`);
  assert.equal(diagnostics.includes('process_tree_terminated'), false, 'a failed kill must never claim termination');
});

test('termination diagnostics report success for a live process tree', { skip: process.platform !== 'win32' }, async () => {
  const { terminateTreeForTest } = await modules();
  const { spawn } = await import('node:child_process');
  const live = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const pid = live.pid;
  const diagnostics = await terminateTreeForTest(pid);
  assert.deepEqual(diagnostics, ['process_tree_terminated']);
  await assertProcessGone(pid);
});

async function assertProcessGone(pid) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  for (let attempt = 0; attempt < 30; attempt++) {
    let listing = '';
    try {
      listing = (await execFileAsync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])).stdout;
    } catch {
      return; // tasklist itself failed; cannot assert further
    }
    // A live PID yields a CSV record like "node.exe","1234","Console",...
    // (the no-match message is localized, so match on the record shape).
    if (!/"[^"]+","${pid}","/.test(listing)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail(`pid ${pid} still alive after termination was reported`);
}
