import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const root = dirnameOf(import.meta.url);
const packageRoot = parentOf(root);
const buildScript = join(packageRoot, 'tools', 'build-release.mjs');

function dirnameOf(url) { return fileURLToPath(new URL('.', url)).replace(/\\$/, ''); }
function parentOf(path) { return resolve(path, '..'); }

function npmCliPath() { return process.env.npm_execpath ?? 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js'; }

function runBuild(releaseDir) {
  return spawnSync(process.execPath, [buildScript, '--release-dir', releaseDir], { cwd: packageRoot, encoding: 'utf8' });
}

function tarEntryNames(tarballPath) {
  const raw = gunzipSync(readFileSync(tarballPath));
  const names = [];
  let offset = 0;
  while (offset < raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = String.fromCharCode(...header.subarray(0, 100)).replace(/\0.*$/, '');
    const sizeField = String.fromCharCode(...header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeField || '0', 8);
    names.push({ name, size });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

test('build-release produces tarball, matching SHA-256 manifest, and verified package', async t => {
  const releaseDir = await mkdtemp(join(tmpdir(), 'release-'));
  t.after(() => rm(releaseDir, { recursive: true, force: true }));
  const result = runBuild(releaseDir);
  assert.equal(result.status, 0, result.stderr);
  const manifestPath = join(releaseDir, 'PACKAGE-MANIFEST.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.tarball, `agentranch-dsh-${pkg.version}.tgz`);
  assert.equal(typeof manifest.sha256, 'string');
  assert.match(manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.bytes, (await statFile(join(releaseDir, manifest.tarball))).size);
  // Digest must match the actual tarball bytes (independent recompute).
  const digest = createHash('sha256').update(readFileSync(join(releaseDir, manifest.tarball))).digest('hex');
  assert.equal(manifest.sha256, digest);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.ok(manifest.engines && manifest.engines.dsh === pkg.engines.dsh);
  assert.equal(manifest.verification.status, 'PASS');
  // Manifest itself must be scannable-clean (no machine paths/secrets).
  const manifestText = JSON.stringify(manifest);
  assert.doesNotMatch(manifestText, /Users\\|\/Users\/|npm_[A-Za-z0-9]{16,}/);
});

test('build-release manifest file list matches actual tarball entries', async t => {
  const releaseDir = await mkdtemp(join(tmpdir(), 'release-list-'));
  t.after(() => rm(releaseDir, { recursive: true, force: true }));
  const result = runBuild(releaseDir);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(releaseDir, 'PACKAGE-MANIFEST.json'), 'utf8'));
  const entries = tarEntryNames(join(releaseDir, manifest.tarball));
  const tarFiles = entries.filter(entry => !entry.name.endsWith('/')).map(entry => entry.name.replace(/^package\//, '')).sort();
  assert.deepEqual(manifest.files.slice().sort(), tarFiles);
});

async function statFile(path) {
  const { stat } = await import('node:fs/promises');
  return stat(path);
}

test('packaged entry imports in a clean directory without the source checkout', async t => {
  const releaseDir = await mkdtemp(join(tmpdir(), 'release-import-'));
  t.after(() => rm(releaseDir, { recursive: true, force: true }));
  const result = runBuild(releaseDir);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(join(releaseDir, 'PACKAGE-MANIFEST.json'), 'utf8'));
  const unpacked = join(releaseDir, 'unpacked');
  await extractTarball(join(releaseDir, manifest.tarball), unpacked);
  // Stub the runtime peer dep the entry imports at module load; cordis is type-only.
  await mkdir(join(unpacked, 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true });
  await writeFile(join(unpacked, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.2.2-rc.1', type: 'module', main: 'index.js' }));
  await writeFile(join(unpacked, 'node_modules', '@deepseek-ai', 'dsh-tools', 'index.js'), 'export const defineTool = tool => tool;');
  const entryUrl = pathToFileURL(join(unpacked, 'dist', 'index.js')).href;  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `const entry = await import(${JSON.stringify(entryUrl)}); if (typeof entry.apply !== 'function' || entry.name !== 'agentranch-dsh') { throw new Error('entry contract missing: ' + Object.keys(entry)); }`], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
});

function tarEntryList(tarballPath) {
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

async function extractTarball(tarballPath, destination) {
  const separator = process.platform === 'win32' ? '\\' : '/';
  await mkdir(destination, { recursive: true });
  for (const entry of tarEntryList(tarballPath)) {
    if (entry.name.endsWith('/')) continue;
    const target = resolve(destination, entry.name.replace(/^package[\\/]/, ''));
    if (!target.startsWith(resolve(destination) + separator)) throw new Error(`tar escape: ${entry.name}`);
    const { dirname } = await import('node:path');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes);
  }
}
