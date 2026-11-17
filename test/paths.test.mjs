import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = resolve(root, 'test', 'fixtures');

async function modules() {
  return {
    paths: await import(pathToFileURL(join(root, 'dist', 'paths.js')).href),
    config: await import(pathToFileURL(join(root, 'dist', 'config.js')).href),
  };
}

test('rejects malformed and non-file invocation paths', async () => {
  const { paths } = await modules();
  const allowed = resolve(fixtureRoot, 'allowed');
  for (const value of ['', 'relative.txt', `${allowed}\0bad`, `${allowed}\n-bad`]) {
    assert.throws(
      () => paths.validateInvocationPath(value, [allowed], 'config'),
      /absolute|control|empty|NUL|path/i,
    );
  }
  assert.equal(paths.validateInvocationPath(allowed, [allowed], 'state'), allowed);
});

test('accepts a regular file under an allowed root and rejects traversal', async () => {
  const { paths } = await modules();
  const allowed = resolve(fixtureRoot, 'allowed');
  const file = resolve(allowed, 'README.txt');
  assert.equal(paths.validateInvocationPath(file, [allowed], 'config'), file);
  assert.throws(
    () => paths.validateInvocationPath(join(allowed, '..', 'outside', 'README.txt'), [allowed], 'config'),
    /outside|root|allowed|boundary/i,
  );
});

test('rejects symlink escape instead of trusting its textual path', async (t) => {
  const { paths } = await modules();
  const temp = await mkdtemp(join(tmpdir(), 'agentranch-paths-'));
  const allowed = join(temp, 'allowed');
  const outside = join(temp, 'outside');
  await mkdir(allowed);
  await mkdir(outside);
  const target = join(outside, 'secret.txt');
  await writeFile(target, 'not for the plugin');
  const link = join(allowed, 'link.txt');
  try {
    await symlink(target, link);
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.diagnostic('NOT_RUN: symlink creation unavailable (no privilege); junction case below covers link rejection on Windows');
      return;
    }
    throw error;
  }
  assert.throws(
    () => paths.validateInvocationPath(link, [allowed], 'config'),
    /symlink|reparse|link|outside|root/i,
  );
});

test('rejects a Windows junction escape and a junction used as an allowed root', { skip: process.platform !== 'win32' }, async () => {
  const { paths } = await modules();
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const temp = await mkdtemp(join(tmpdir(), 'agentranch-junction-'));
  const allowed = join(temp, 'allowed');
  const outside = join(temp, 'outside');
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'not for the plugin');
  // Junction creation needs no privilege on Windows, unlike symlinks.
  await execFileAsync('cmd.exe', ['/c', 'mklink', '/J', join(allowed, 'link.txt'), outside]);
  assert.throws(
    () => paths.validateInvocationPath(join(allowed, 'link.txt', 'secret.txt'), [allowed], 'config'),
    /symlink|reparse|link|outside|root/i,
    'a junction inside an allowed root pointing outside must be rejected',
  );
  assert.throws(
    () => paths.validateInvocationPath(join(temp, 'allowed', 'README.txt'), [join(allowed, 'link.txt')], 'config'),
    /symlink|reparse|link|outside|root|not a directory|ENOENT/i,
    'a junction used as an allowed root must not validate',
  );
});

test('validates a configured regular aw-cli file independently of tool arguments', async () => {
  const { paths } = await modules();
  const cli = resolve(fixtureRoot, 'allowed', 'README.txt');
  assert.equal(paths.validateConfiguredAwCli(cli), cli);
  assert.throws(() => paths.validateConfiguredAwCli(resolve(fixtureRoot, 'allowed')), /regular file|directory/i);
});

test('loads only explicit user configuration and clamps timeout', async () => {
  const { config } = await modules();
  const cli = resolve(fixtureRoot, 'allowed', 'README.txt');
  const allowed = resolve(fixtureRoot, 'allowed');
  assert.throws(() => config.loadConfig(), /awCliPath|configured|configuration/i);
  const value = config.loadConfig({
    awCliPath: cli,
    allowedRoots: [allowed],
    defaultTimeoutMs: 5000,
    maxOutputBytes: 2048,
  });
  assert.deepEqual(value, {
    awCliPath: cli,
    allowedRoots: [allowed],
    defaultTimeoutMs: 5000,
    maxOutputBytes: 2048,
  });
  assert.equal(config.clampTimeout(undefined, value), 5000);
  assert.equal(config.clampTimeout(1, value), 100);
  assert.equal(config.clampTimeout(999999, value), 120000);
});
