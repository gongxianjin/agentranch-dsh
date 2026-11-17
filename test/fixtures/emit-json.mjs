const args = process.argv.slice(2);
if (args.includes('--fail')) {
  process.stderr.write('fixture failure\n');
  process.exitCode = 7;
} else if (args.includes('--large')) {
  process.stdout.write('x'.repeat(100000));
} else {
  process.stdout.write(JSON.stringify({ ok: true, args, message: 'safe output' }) + '\n');
}
