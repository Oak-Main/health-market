import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const live = join(project, 'public', 'data');
const projectId = createHash('sha256').update(project).digest('hex');
const lock = join(tmpdir(), `subsidy-benchmark-${projectId}.lock`);
const year = process.env.PLAN_YEAR || '2026';
const nodeEnv = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=6500' };
function run(script, ...args) {
  execFileSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: project, stdio: 'inherit', env: nodeEnv });
}

// Take the lock before touching the live directory. Isolated CI checkouts have independent locks.
try {
  closeSync(openSync(lock, 'wx'));
} catch (error) {
  if (error.code === 'EEXIST') throw new Error(`Benchmark refresh already locked at ${lock}. Check for a running refresh before clearing an abandoned lock.`);
  throw error;
}
let work;
let preserveBackup = false;
try {
  work = mkdtempSync(join(project, '.benchmark-refresh-'));
  const staged = join(work, 'staged');
  const backup = join(work, 'previous');
  run('src/etl/run.ts', `--plan-year=${year}`, `--out=${staged}`);
  run('src/etl/verify.ts', staged, year);
  if (existsSync(live)) renameSync(live, backup);
  try {
    renameSync(staged, live);
    run('src/etl/verify.ts', live, year);
  } catch (error) {
    // Retain the backup if recovery itself fails.
    preserveBackup = true;
    if (existsSync(live)) renameSync(live, join(work, 'rejected'));
    if (existsSync(backup)) renameSync(backup, live);
    preserveBackup = false;
    throw error;
  }
} finally {
  try {
    if (work && !preserveBackup) rmSync(work, { recursive: true, force: true });
  } finally {
    unlinkSync(lock);
  }
}
