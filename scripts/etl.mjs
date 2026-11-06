import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const releaseYears = ['2026', '2027'];

export function etlCommand(args) {
  const year = args.find(arg => arg.startsWith('--plan-year='))?.slice(12) ?? '2026';
  if (!releaseYears.includes(year)) throw new Error(`Unregistered benchmark year ${year}`);
  if (year === '2027') {
    const ioArgs = args.filter(arg => !arg.startsWith('--plan-year='));
    if (!ioArgs.some(arg => arg.startsWith('--out='))) ioArgs.push('--out=public/data');
    return ['python3', ['src/etl/py2027/build.py', ...ioArgs]];
  }
  return [process.execPath, ['--import', 'tsx', 'src/etl/run.ts', ...args.filter(arg => !arg.startsWith('--plan-year=')), '--plan-year=2026']];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, args] = etlCommand(process.argv.slice(2));
  const child = spawn(command, args, { stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('close', code => { process.exitCode = code ?? 1; });
}
