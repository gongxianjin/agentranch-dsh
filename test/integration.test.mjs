import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(root);
const repoRoot = resolve(packageRoot, '..');
const defaultBinary = resolve(repoRoot, '..', 'agent-workspace', 'target', 'x86_64-pc-windows-gnu', 'release', 'aw-cli.exe');
const explicitBinary = process.env.AGENTRANCH_AW_CLI;
const binary = explicitBinary ? resolve(explicitBinary) : defaultBinary;

async function exists(path) { try { await readFile(path); return true; } catch { return false; } }
async function run(executable, args, cwd) {
  return await new Promise(resolveResult => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => resolveResult({ error }));
    child.once('close', (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

const available = await exists(binary);
if (!available) {
  test('real AgentRanch Windows binary unavailable: NOT_RUN evidence', async () => {
    const evidence = join(packageRoot, 'integration-NOT_RUN.json');
    await writeFile(evidence, JSON.stringify({ status: 'NOT_RUN', reason: 'aw-cli.exe unavailable', expectedPath: binary }, null, 2));
    assert.equal(true, true);
  });
} else {
  test('real aw-cli identity reports AgentRanch 0.2.0', async () => {
    const result = await run(binary, ['--identity'], packageRoot);
    assert.equal(result.code, 0, result.stderr);
    const identity = JSON.parse(result.stdout);
    assert.equal(identity.package, 'agentranch');
    assert.equal(identity.version, '0.2.0');
  });

  async function fixtureWorkspace(t, invalid = false) {
    const dir = await mkdtemp(join(tmpdir(), 'agentranch-integration-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(join(dir, 'state'));
    await cp(join(root, 'fixtures', invalid ? 'config-invalid.json' : 'config-valid.json'), join(dir, 'config.json'));
    await writeFile(join(dir, 'node-1.key'), '00'.repeat(32));
    return { dir, config: join(dir, 'config.json'), state: join(dir, 'state') };
  }

  test('real check preserves configuration_valid and not-probed marker', async t => {
    const fixture = await fixtureWorkspace(t);
    const result = await run(binary, ['check', '--config', fixture.config], packageRoot);
    assert.equal(result.code, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.configuration_valid, true);
    assert.equal(value.active_probe, false);
    assert.equal(value.external_readiness, 'not_probed');
  });

  test('invalid real config fails without fixture secret leakage', async t => {
    const fixture = await fixtureWorkspace(t, true);
    const result = await run(binary, ['check', '--config', fixture.config], packageRoot);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.includes('00'.repeat(32)), false);
    assert.equal(result.stderr.includes('00'.repeat(32)), false);
  });

  // Root cause (verified against aw-cli 0.2.0 source and upstream test
  // rust_mcp.rs::native_cli_local_check_preserves_uncertain_observer_result):
  // local-check cannot report a completed run on Windows. A run reaches `done`
  // only through admitted M0 owner evidence, produced solely by the Linux
  // owner-exec path; the local fixture's correct verified exit (sum=6,
  // exit_code 0) still leaves the run honestly `unknown`, so aw-cli exits 2
  // with "local fixture timed out; uncertain task remains in ledger" and no
  // success JSON on stdout. The plugin must surface exactly that honest state.
  test('real local-check preserves the uncertain-observer result instead of fabricating completion', async t => {
    const fixture = await fixtureWorkspace(t);
    const result = await run(binary, ['local-check', '--state-dir', fixture.state], packageRoot);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /uncertain task remains in ledger/);
    assert.equal(result.stdout.trim(), '', 'local-check must not print a success JSON');
    // The fixture itself ran and verified: durable evidence proves the child
    // completed with sum=6 and exit 0 while the run stayed `unknown`.
    const fixturesDir = join(fixture.state, 'fixtures');
    const sessions = await readdir(fixturesDir);
    assert.equal(sessions.length, 1, 'exactly one fixture session expected');
    const evidence = JSON.parse(await readFile(join(fixturesDir, sessions[0], 'status.json'), 'utf8'));
    assert.equal(evidence.exit_code, 0);
    const artifact = JSON.parse(await readFile(join(fixturesDir, sessions[0], 'result.json'), 'utf8'));
    assert.equal(artifact.schema, 'native-sum/1');
    assert.equal(artifact.sum, 6);
    const runs = await readPersistedRuns(join(fixture.state, 'controller.sqlite'));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'unknown');
  });

  async function readPersistedRuns(database) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      return db.prepare('SELECT body FROM runs').all().map(row => JSON.parse(row.body));
    } finally {
      db.close();
    }
  }
}

test('absent executable produces structured failure rather than a thrown process crash', async () => {
  const result = await run(join(packageRoot, 'does-not-exist.exe'), ['--identity'], packageRoot);
  assert.ok(result.error);
  assert.match(result.error.message, /ENOENT|not found|spawn/i);
});
