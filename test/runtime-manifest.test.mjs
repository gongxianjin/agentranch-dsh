import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const packageRoot = join(root, '..');

test('every runtime import in dist is installable: dsh plugin add does not auto-install peers', async () => {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const distDir = join(packageRoot, 'dist');
  const files = (await readdir(distDir)).filter(name => name.endsWith('.js'));
  assert.ok(files.length > 0, 'dist must exist');
  const external = new Set();
  for (const file of files) {
    const text = await readFile(join(distDir, file), 'utf8');
    for (const match of text.matchAll(/from\s+['"]([^.'"][^'"]*)['"]/g)) {
      const specifier = match[1];
      if (specifier.startsWith('node:')) continue;
      // Scoped package name or bare package name before any subpath.
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      external.add(name);
    }
  }
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  const peers = new Set(Object.keys(pkg.peerDependencies ?? {}));
  for (const name of external) {
    assert.ok(
      dependencies.has(name) || peers.has(name),
      `dist imports ${name} but it is neither a dependency nor a peer`,
    );
    // pnpm in a dsh profile runs with autoInstallPeers:false: anything the
    // compiled entry imports at runtime must be a real dependency, or the
    // plugin fails to load after `dsh plugin add <tarball>`.
    assert.ok(
      dependencies.has(name),
      `dist imports ${name} at runtime; it must be in dependencies (peers are not auto-installed by dsh plugin add; proven by profile install test 2026-11-17)`,
    );
  }
});
