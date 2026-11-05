import { spawn } from 'node:child_process';
import lockfile from 'proper-lockfile';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
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
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], { cwd: project, stdio: 'inherit', env: nodeEnv });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} failed (${signal || code})`));
    });
  });
}

// A live refresh renews this lease while the child processes run. A terminated
// owner stops renewing it, so subsequent builds can reclaim it after two minutes.
const releaseLock = await lockfile.lock(project, { lockfilePath: lock, stale: 120_000, update: 15_000 });
let work;
let preserveBackup = false;
try {
  work = mkdtempSync(join(project, '.benchmark-refresh-'));
  const staged = join(work, 'staged');
  const backup = join(work, 'previous');
  await run('src/etl/run.ts', `--plan-year=${year}`, `--out=${staged}`);
  await run('src/etl/verify.ts', staged, year);
  if (existsSync(live)) renameSync(live, backup);
  try {
    renameSync(staged, live);
    await run('src/etl/verify.ts', live, year);
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
    await releaseLock();
  }
}
