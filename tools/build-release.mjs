#!/usr/bin/env node
// Build the release: compile, pack, extract, scan with verify-package.mjs,
// hash the tarball, and write PACKAGE-MANIFEST.json next to it.
// Any step failing exits nonzero; the manifest records PASS only when the
// package scan passed.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, cp, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath ?? 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';

function parseArgs(argv) {
  const args = { 'release-dir': join(packageRoot, 'release') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--release-dir') { args['release-dir'] = resolve(argv[i + 1]); i += 1; }
  }
  return args;
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

async function extract(tarballPath, destination) {
  const separator = process.platform === 'win32' ? '\\' : '/';
  await mkdir(destination, { recursive: true });
  const files = [];
  for (const entry of tarEntries(tarballPath)) {
    if (entry.name.endsWith('/')) continue;
    const target = resolve(destination, entry.name.replace(/^package[\\/]/, ''));
    if (!target.startsWith(resolve(destination) + separator)) throw new Error(`tar escape: ${entry.name}`);
    const { dirname } = await import('node:path');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.bytes);
    files.push(entry.name.replace(/^package[\\/]/, ''));
  }
  return files.sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseDir = args['release-dir'];
  await mkdir(releaseDir, { recursive: true });
  // 1. Build (same locked command as npm test).
  execFileSync(process.execPath, [npmCli, 'run', 'build'], { cwd: packageRoot, stdio: 'inherit' });
  // 2. Pack into the release dir.
  const packOutput = execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', releaseDir], { cwd: packageRoot, encoding: 'utf8' });
  const tarballName = JSON.parse(packOutput)[0].filename;
  const tarballPath = join(releaseDir, tarballName);
  // 3. Extract to a temp dir and scan.
  const workDir = await mkdtemp(join(tmpdir(), 'build-release-'));
  try {
    const unpacked = join(workDir, 'package');
    const files = await extract(tarballPath, unpacked);
    const verify = spawnSync(process.execPath, [join(packageRoot, 'tools', 'verify-package.mjs'), '--package-dir', unpacked], { encoding: 'utf8' });
    if (verify.status !== 0) {
      console.error('package verification failed:');
      console.error(verify.stderr || verify.stdout);
      process.exit(1);
    }
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const bytes = (await stat(tarballPath)).size;
    const sha256 = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      tarball: tarballName,
      bytes,
      sha256,
      files,
      engines: pkg.engines,
      agentranch: { version: '0.2.0', platform: 'Windows' },
      verification: { status: 'PASS', tool: 'tools/verify-package.mjs', verifiedAt: new Date().toISOString() },
      builtWith: { node: process.version },
    };
    await writeFile(join(releaseDir, 'PACKAGE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`PASS: ${tarballName} (${bytes} bytes, sha256 ${sha256})`);
    console.log(`manifest: ${join(releaseDir, 'PACKAGE-MANIFEST.json')}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
