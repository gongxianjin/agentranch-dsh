import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

test('metadata: npm pack contains required runtime and docs but no source/test/evidence files', () => {
  const npm = process.env.npm_execpath;
  const result = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))[0];
  const files = result.files.map(f => f.path);
  for (const path of ['package.json', 'dist/index.js', 'dist/tools.js', 'cordis.patch.yml', 'README.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE']) assert.ok(files.includes(path), path);
  for (const path of files) assert.doesNotMatch(path, /(?:^|\/)(?:test|fixtures|src|node_modules|evidence|market)\/|\.map$|\.env|\.(?:exe|dll|pem)$/i);
});

test('metadata: market draft is public package metadata without credentials or machine paths', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const listing = JSON.parse(await readFile(new URL('../market/listing.json', import.meta.url)));
  assert.equal(listing.package, pkg.name);
  assert.equal(listing.version, pkg.version);
  assert.equal(listing.status, 'draft');
  assert.ok(listing.topics.includes('dsh-plugin'));
  assert.match(listing.repository, /^https:\/\/github.com\//);
  assert.doesNotMatch(JSON.stringify(listing), /[a-z]:\\|\/Users\/|\/home\/|Bearer\s|BEGIN .*PRIVATE KEY|_authToken/i);
});
