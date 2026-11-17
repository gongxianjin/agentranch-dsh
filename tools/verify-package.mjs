#!/usr/bin/env node
// Verify a packed package directory (already extracted from the npm tarball):
// inventory + content scan for forbidden files, machine paths, and secrets.
// Exit 0 prints PASS; any violation exits 1 with a `forbidden ...` reason.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const FORBIDDEN_FILES = /\.(exe|dll|pem|key|p12|pfx|env|tsbuildinfo|map)$/i;
const FORBIDDEN_NAMES = /^(\.env|\.env\..*|PACKAGE-MANIFEST\.json|VERIFICATION\.md)$/;
const FORBIDDEN_DIRS = [/^test$/, /^tools$/, /^src$/, /^node_modules$/, /^market$/, /^fixtures$/, /^evidence$/, /^\.superpowers$/];
const TEXT_FILES = /\.(json|ya?ml|md|js|mjs|cjs|ts|txt)$/i;
const FORBIDDEN_CONTENT = [
  { pattern: /[A-Za-z]:\\Users\\|\/Users\/|\/home\//i, reason: 'machine path' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: 'private key' },
  { pattern: /npm_[A-Za-z0-9]{16,}/, reason: 'npm token' },
  { pattern: /_authToken/i, reason: 'auth token reference' },
  { pattern: /Authorization['"\s:]{0,4}Bearer\s+[A-Za-z0-9._-]{12,}/i, reason: 'bearer token' },
];

function parseArgs(argv) {
  const args = { 'package-dir': '.' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--package-dir') { args['package-dir'] = argv[i + 1]; i += 1; }
  }
  return args;
}

async function walk(dir, base, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, base, files);
    } else if (entry.isFile()) {
      files.push(relative(base, path).replace(/\\/g, '/'));
    }
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packageDir = resolve(args['package-dir']);
  const rootStat = await stat(packageDir);
  if (!rootStat.isDirectory()) throw new Error(`not a directory: ${packageDir}`);
  // Accept either the extracted tarball root containing package/ or the package dir itself.
  let base = packageDir;
  const top = await readdir(packageDir, { withFileTypes: true });
  if (top.length === 1 && top[0].name === 'package' && top[0].isDirectory()) base = join(packageDir, 'package');
  const files = await walk(base, base);
  files.sort();
  const violations = [];
  const segments = new Set();
  for (const file of files) {
    for (const segment of file.split('/').slice(0, -1)) segments.add(segment);
    if (FORBIDDEN_FILES.test(file)) violations.push(`forbidden file pattern: ${file}`);
    if (FORBIDDEN_NAMES.test(file.split('/').pop())) violations.push(`forbidden file name: ${file}`);
  }
  for (const segment of segments) {
    if (FORBIDDEN_DIRS.some(pattern => pattern.test(segment))) violations.push(`forbidden directory in package: ${segment}/`);
  }
  for (const file of files) {
    if (!TEXT_FILES.test(file)) continue;
    const text = await readFile(join(base, file), 'utf8');
    for (const rule of FORBIDDEN_CONTENT) {
      if (rule.pattern.test(text)) violations.push(`forbidden content (${rule.reason}): ${file}`);
    }
  }
  const required = ['package.json', 'dist/index.js', 'cordis.patch.yml', 'README.md', 'LICENSE'];
  for (const need of required) {
    if (!files.includes(need)) violations.push(`missing required file: ${need}`);
  }
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log(`PASS: ${files.length} files verified clean in ${base}`);
  console.log(files.join('\n'));
}

main().catch(error => { console.error(String(error && error.stack || error)); process.exit(1); });
