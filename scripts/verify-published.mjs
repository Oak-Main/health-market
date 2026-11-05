import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'https://subsidydropoff.com';
const expected = JSON.parse(readFileSync(new URL('../public/oe-window.json', import.meta.url), 'utf8'));
const year = process.env.PLAN_YEAR || '2026';
const manifest = JSON.parse(readFileSync(new URL(`../public/data/${year}/index.json`, import.meta.url), 'utf8'));
const deadline = Date.now() + 120_000;
async function get(path, options) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Publication verification timed out');
  const res = await fetch(origin + path, { cache: 'no-store', ...options, signal: AbortSignal.timeout(Math.min(12_000, remaining)) });
  assert.equal(res.status, 200, path);
  return res;
}
async function verify() {
  const enrollment = await (await get('/oe-window.json')).json();
  assert.deepEqual(enrollment, expected);
  assert.ok((await (await get('/')).text()).includes(enrollment.ruleStatus));
  const index = await (await get(`/data/${year}/index.json`)).json();
  assert.equal(index.generated, manifest.generated, 'Custom domain is serving a different benchmark build');
  assert.equal(index.shardCount, manifest.shardCount);
  const result = await (await get('/api/income-check', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({planYear:2027,region:'alaska',householdSize:1,income:79800.01,monthlyBenchmark:1000})})).json();
  assert.equal(result.incomeStatus, 'above');
  assert.equal(result.estimatedMonthlyBenchmarkCredit, 0);
}
for (let attempt = 1; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw error;
    console.log(`Waiting for the deployed site (attempt ${attempt}): ${error.message}`);
    await delay(Math.min(10_000, remaining));
  }
}
console.log(`Verified published enrollment and ${year} benchmark release ${manifest.generated} on ${origin}`);
