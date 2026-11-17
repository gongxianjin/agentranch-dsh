import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args.length === 1 && args[0] === '--identity') {
  console.log(JSON.stringify({ binary: 'aw-cli', package: 'agentranch', version: '0.2.0' }));
  process.exit(0);
}
if (args[0] === 'check') {
  const path = option('--config');
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (config.invalid) { console.error('invalid configuration'); process.exit(2); }
  console.log(JSON.stringify({ configuration_valid: true, active_probe: false, external_readiness: 'not_probed' }));
  process.exit(0);
}
if (args[0] === 'local-check') {
  console.log(JSON.stringify({ mode: 'local', simulated: true, meaning: 'native fixture only; no real AO/Reason/model' }));
  process.exit(0);
}
console.error(`unsupported fixture command: ${basename(process.execPath)} ${args.join(' ')}`);
process.exit(2);
