import { etlCommand, releaseYears } from './etl.mjs';
import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = join(project, 'public', 'data');
const projectId = createHash('sha256').update(project).digest('hex');
const lock = join(tmpdir(), `subsidy-benchmark-${projectId}.lock`);
const nodeEnv = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6500' };
let activeChild;
let interrupted;
function interrupt(signal) {
  interrupted = signal;
  activeChild?.kill(signal);
}
function run(command, args) {
  if (interrupted) throw new Error(`Benchmark refresh interrupted by ${interrupted}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, stdio: 'inherit', env: nodeEnv });
    activeChild = child;
    child.once('error', reject);
    child.once('close', (code, signal) => {
      activeChild = undefined;
      if (code === 0 && !interrupted) resolve();
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

// A live refresh renews this lease while the child processes run. A terminated
// owner stops renewing it, so subsequent builds can reclaim it after two minutes.
const releaseLock = await lockfile.lock(project, { lockfilePath: lock, stale: 120_000, update: 15_000 });
process.on('SIGTERM', interrupt);
process.on('SIGINT', interrupt);
let work;
let preserveBackup = false;
try {
  work = mkdtempSync(join(project, '.benchmark-refresh-'));
  const staged = join(work, 'staged');
  const backup = join(work, 'previous');
  const verify = (root, year) => run(process.execPath, ['--import', 'tsx', 'src/etl/verify.ts', root, year]);
  for (const year of releaseYears) {
    const [command, args] = etlCommand([`--plan-year=${year}`, `--out=${staged}`]);
    await run(command, args);
    await verify(staged, year);
  }
  // Keep the two releases together and preserve any unrelated historical assets.
  if (existsSync(dataRoot)) {
    for (const name of readdirSync(dataRoot)) {
      if (!releaseYears.includes(name)) cpSync(join(dataRoot, name), join(staged, name), { recursive: true });
    }
    renameSync(dataRoot, backup);
  }
  try {
    renameSync(staged, dataRoot);
    for (const year of releaseYears) await verify(dataRoot, year);
  } catch (error) {
    // Retain the backup if recovery itself fails.
    preserveBackup = true;
    try {
      if (existsSync(dataRoot)) renameSync(dataRoot, join(work, 'rejected'));
      if (existsSync(backup)) renameSync(backup, dataRoot);
      preserveBackup = false;
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], `Benchmark recovery failed. Inspect the backup at ${backup}.`, { cause: error });
    }
    throw error;
  }
} finally {
  try {
    if (work && !preserveBackup) rmSync(work, { recursive: true, force: true });
  } finally {
    await releaseLock();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
