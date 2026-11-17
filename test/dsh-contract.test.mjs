import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function mustExist(path) {
  await access(path);
}

test('package declares the DSH bundle contract', async () => {
  const pkg = await readJson(join(root, 'package.json'));
  assert.equal(pkg.name, 'agentranch-dsh');
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.main || pkg.exports, 'package must declare an entry');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.engines.node, '>=24.9.0');
  assert.match(pkg.engines.dsh, /0\.2/);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
});

test('bundle patch points at the exported plugin name', async () => {
  const pkg = await readJson(join(root, 'package.json'));
  const patchPath = join(root, pkg.dsh.bundle.patch);
  await mustExist(patchPath);
  const patch = await readFile(patchPath, 'utf8');
  assert.match(patch, /id:\s*agentranch-dsh/);
  assert.match(patch, /name:\s*agentranch-dsh/);
});

test('entry imports without spawning a process and exposes the DSH plugin factory', async () => {
  const pkg = await readJson(join(root, 'package.json'));
  const entry = typeof pkg.main === 'string' ? pkg.main : pkg.exports['.'].default;
  const module = await import(pathToFileURL(join(root, entry)).href);
  assert.equal(typeof module.apply, 'function');
  assert.equal(module.pluginName, 'agentranch-dsh');
});
