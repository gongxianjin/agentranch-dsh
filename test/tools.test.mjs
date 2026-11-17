import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import * as entry from '../dist/index.js';

async function setup(t, services = {}) {
  const { createTools } = await import('../dist/tools.js');
  const root = await mkdtemp(join(tmpdir(), 'agentranch-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, '配置 with spaces.json');
  const stateDir = join(root, 'state');
  await writeFile(configPath, '{}');
  await mkdir(stateDir);
  const config = { awCliPath: await realpath(process.execPath), allowedRoots: [await realpath(root)], defaultTimeoutMs: 1000, maxOutputBytes: 2048 };
  const calls = [];
  const run = async (spec, actualConfig, timeoutMs, signal) => {
    calls.push({ spec, config: actualConfig, timeoutMs, signal });
    const json = spec.purpose === 'check' ? { active_probe: false, external_readiness: 'not_probed' }
      : spec.purpose === 'local-check' ? { mode: 'local', simulated: true } : { ok: true };
    return { ok: true, command: [config.awCliPath, ...spec.args], exitCode: 0, signal: null, timedOut: false, durationMs: 1,
      stdout: JSON.stringify(json), stderr: '', stdoutTruncated: false, stderrTruncated: false, json, jsonParseError: null,
      redacted: false, redactionHits: [], diagnostics: [] };
  };
  const tools = createTools(config, { run, ...services });
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  const exec = { name: 'agentranch_run_once', agent: { id: 'test-agent' }, callId: 'test-call', token: Symbol(), signal: new AbortController().signal };
  return { tools, byName, calls, config, configPath: await realpath(configPath), stateDir: await realpath(stateDir), exec };
}

test('entry registers exactly four tools once per plugin context', async () => {
  const registered = [];
  const ctx = { tools: { register(tool) { registered.push(tool); return () => {}; } }, get() { return undefined; } };
  const config = { awCliPath: process.execPath, allowedRoots: [tmpdir()] };
  entry.apply(ctx, config);
  entry.apply(ctx, config);
  assert.deepEqual(registered.map(t => t.name).sort(), ['agentranch_check', 'agentranch_identity', 'agentranch_local_check', 'agentranch_run_once']);
});

test('apply is synchronous: registers tools without returning a promise (DSH loader drops async rejections)', () => {
  const registered = [];
  const ctx = { tools: { register(tool) { registered.push(tool); return () => {}; } }, get() { return undefined; } };
  const config = { awCliPath: process.execPath, allowedRoots: [tmpdir()] };
  const result = entry.apply(ctx, config);
  assert.equal(typeof result?.then, 'undefined', 'apply must not return a promise; the DSH host loader does not await async apply and silently drops rejections (probed 2026-11-17)');
  assert.equal(registered.length, 4, 'all four tools registered synchronously');
});

test('apply throws synchronously on invalid config so the host audit surfaces the failure', () => {
  const ctx = { tools: { register() { return () => {}; } }, get() { return undefined; } };
  const config = { awCliPath: 'C:/definitely/not/here/aw-cli.exe', allowedRoots: ['C:/definitely/not/here'] };
  assert.throws(() => entry.apply(ctx, config), /no such|ENOENT|not_regular_file/i);
});

test('tools publish closed schemas and reject executable, argv and confirmation overrides', async t => {
  const { tools, calls, exec } = await setup(t);
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    for (const field of ['awCliPath', 'argv', 'args', 'shell', 'cwd', 'env', 'confirmed', 'mcp', 'ssh-gateway', 'owner-exec', 'fixture-worker']) {
      const args = tool.name === 'agentranch_identity' ? {} : tool.name === 'agentranch_local_check' ? { stateDir: tmpdir() } : { configPath: process.execPath, ...(tool.name === 'agentranch_run_once' ? { mode: 'runner' } : {}) };
      await assert.rejects(tool.execute({ ...args, [field]: 'malicious' }, exec), /invalid arguments|undeclared|declared property/i);
    }
  }
  assert.equal(calls.length, 0);
});

test('tools reject missing required fields, unsupported modes and relative paths before execution', async t => {
  const { byName, configPath, calls, exec } = await setup(t);
  for (const [name, args] of [
    ['agentranch_check', {}], ['agentranch_local_check', {}],
    ['agentranch_run_once', { configPath, mode: 'mcp' }],
    ['agentranch_check', { configPath: 'relative.json' }],
    ['agentranch_local_check', { stateDir: '.' }],
    ['agentranch_check', { configPath, timeoutMs: '100' }],
  ]) await assert.rejects(byName[name].execute(args, exec));
  assert.equal(calls.length, 0);
});

test('read-only and local tools construct fixed argv and forward caller cancellation', async t => {
  const { byName, calls, configPath, stateDir, exec } = await setup(t);
  await byName.agentranch_identity.execute({}, exec);
  await byName.agentranch_check.execute({ configPath, timeoutMs: 500 }, exec);
  await byName.agentranch_local_check.execute({ stateDir }, exec);
  assert.deepEqual(calls.map(c => c.spec), [
    { purpose: 'identity', args: ['--identity'] },
    { purpose: 'check', args: ['check', '--config', configPath] },
    { purpose: 'local-check', args: ['local-check', '--state-dir', stateDir] },
  ]);
  assert.equal(calls[1].timeoutMs, 500);
  assert.ok(calls.every(call => call.signal === exec.signal));
});

test('rendered output preserves check and local simulation markers and matches output schemas', async t => {
  const { byName, configPath, stateDir, exec } = await setup(t);
  for (const [name, args, markers] of [
    ['agentranch_check', { configPath }, ['not_probed', 'active_probe']],
    ['agentranch_local_check', { stateDir }, ['simulated', 'local']],
  ]) {
    const tool = byName[name];
    const result = await tool.execute(args, exec);
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema, result), []);
    const text = tool.output.render(args, result).map(c => c.text).join('\n');
    for (const marker of markers) assert.ok(text.includes(marker), marker);
    assert.match(text, /not.*(?:remote|external)|模拟|未.*验证/i);
  }
});

for (const mode of ['runner', 'controller']) {
  test(`${mode} waits for one official approval before one process invocation`, async t => {
    let grant;
    let request;
    const pending = new Promise(resolve => { grant = resolve; });
    const { byName, calls, configPath, exec } = await setup(t, { requestApproval: async req => { request = req; return pending; } });
    const work = byName.agentranch_run_once.execute({ mode, configPath }, exec);
    while (!request) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal(request.agent, exec.agent);
    assert.equal(request.callId, exec.callId);
    assert.equal(request.signal, exec.signal);
    assert.match(request.reason, new RegExp(mode));
    assert.match(request.reason, /配置 with spaces.json/);
    assert.match(request.reason, /side effects|副作用/i);
    grant('allowed-once');
    const result = await work;
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(c => c.spec), [{ purpose: mode, args: [mode, '--config', configPath, '--once'] }]);
  });
}

for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
  test(`approval ${outcome} never starts a process`, async t => {
    const { byName, calls, configPath, exec } = await setup(t, { requestApproval: async () => outcome });
    const result = await byName.agentranch_run_once.execute({ mode: 'runner', configPath }, exec);
    assert.equal(result.ok, false);
    assert.deepEqual(validateJsonSchemaValue(byName.agentranch_run_once.output.schema, result), []);
    assert.equal(calls.length, 0);
  });
}

test('missing approval service and agent-less calls fail closed with a typed result', async t => {
  const { byName, calls, configPath, exec } = await setup(t);
  const result = await byName.agentranch_run_once.execute({ mode: 'runner', configPath }, exec);
  assert.equal(result.status, 'confirmation_required');
  assert.equal(calls.length, 0);
  const agentless = await setup(t, { requestApproval: async () => { throw new Error('must not ask without agent'); } });
  const denied = await agentless.byName.agentranch_run_once.execute({ mode: 'controller', configPath: agentless.configPath }, { ...exec, agent: undefined });
  assert.equal(denied.status, 'confirmation_required');
  assert.equal(agentless.calls.length, 0);
});

test('already cancelled calls and cancellation during approval never start a process', async t => {
  const controller = new AbortController();
  const { byName, calls, configPath, exec } = await setup(t, { requestApproval: async () => { controller.abort(); return 'allowed-once'; } });
  await assert.rejects(byName.agentranch_run_once.execute({ mode: 'runner', configPath }, { ...exec, signal: controller.signal }));
  assert.equal(calls.length, 0);
  await assert.rejects(byName.agentranch_identity.execute({}, { ...exec, signal: controller.signal }));
  assert.equal(calls.length, 0);
});
