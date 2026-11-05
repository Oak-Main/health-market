import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = join(project, 'public', 'data');
const projectId = createHash('sha256').update(project).digest('hex');
const lock = join(tmpdir(), `subsidy-benchmark-${projectId}.lock`);
const year = process.env.PLAN_YEAR || '2026';
if (!/^\d{4}$/.test(year)) throw new Error('Expected a four-digit plan year');
const live = join(dataRoot, year);
const nodeEnv = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6500' };
let activeChild;
let interrupted;
function interrupt(signal) {
  interrupted = signal;
  activeChild?.kill(signal);
}
function run(script, ...args) {
  if (interrupted) throw new Error(`Benchmark refresh interrupted by ${interrupted}`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: project, stdio: 'inherit', env: nodeEnv });
    activeChild = child;
    child.once('error', reject);
    child.once('close', (code, signal) => {
      activeChild = undefined;
      if (code === 0 && !interrupted) resolve();
      else reject(new Error(`${script} failed (${signal || code})`));
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
  await run('src/etl/run.ts', `--plan-year=${year}`, `--out=${staged}`);
  await run('src/etl/verify.ts', staged, year);
  mkdirSync(dataRoot, { recursive: true });
  if (existsSync(live)) renameSync(live, backup);
  try {
    renameSync(join(staged, year), live);
    await run('src/etl/verify.ts', dataRoot, year);
  } catch (error) {
    // Retain the backup if recovery itself fails.
    preserveBackup = true;
    try {
      if (existsSync(live)) renameSync(live, join(work, 'rejected'));
      if (existsSync(backup)) renameSync(backup, live);
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
