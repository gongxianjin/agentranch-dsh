import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(root);
const verifyScript = join(packageRoot, 'tools', 'verify-package.mjs');

function npmPack(destination) {
  const npmCli = process.env.npm_execpath ?? 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
  const output = execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd: packageRoot, encoding: 'utf8' });
  return JSON.parse(output)[0].filename;
}

function tarEntries(tarballPath) {
  const raw = gunzipSync(readFileSync(tarballPath));
  const entries = [];
  let offset = 0;
  while (offset < raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = String.fromCharCode(...header.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeField = String.fromCharCode(...header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField || '0', 8);
    entries.push({ name, bytes: raw.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

async function extractTar(tarballPath, destination) {
  const resolvedDestination = resolve(destination);
  await mkdir(resolvedDestination, { recursive: true });
  const separator = process.platform === 'win32' ? '\\' : '/';
  for (const entry of tarEntries(tarballPath)) {
    if (entry.name.endsWith('/')) continue;
    const relative = entry.name.replace(/^package[\\/]/, '');
    const target = resolve(resolvedDestination, relative);
    if (!target.startsWith(resolvedDestination + separator)) throw new Error(`tar escape: ${entry.name} -> ${target}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes);
  }
}

function runVerify(targetPath) {
  const result = spawnSync(process.execPath, [verifyScript, '--package-dir', targetPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'verify-package failed');
  }
  return result.stdout;
}

test('verify-package accepts a clean packed tarball', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'verify-clean-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = npmPack(dir);
  const unpacked = join(dir, 'unpacked');
  await extractTar(join(dir, filename), unpacked);
  assert.match(runVerify(unpacked), /PASS/);
});

test('verify-package rejects a package containing a forbidden executable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'verify-dirty-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = npmPack(dir);
  const unpacked = join(dir, 'unpacked');
  await extractTar(join(dir, filename), unpacked);
  await writeFile(join(unpacked, 'dist', 'rogue.exe'), 'MZ');
  assert.throws(() => runVerify(unpacked), /forbidden file pattern|rogue\.exe/);
});

test('verify-package rejects absolute machine paths and token-like secrets in packaged text files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'verify-secret-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = npmPack(dir);
  const unpacked = join(dir, 'unpacked');
  await extractTar(join(dir, filename), unpacked);
  const readme = await readFile(join(unpacked, 'README.md'), 'utf8');
  await writeFile(join(unpacked, 'README.md'), readme + '\nC:\\Users\\61769\\secret npm_AgAAAA_key\n');
  assert.throws(() => runVerify(unpacked), /forbidden content/i);
});
