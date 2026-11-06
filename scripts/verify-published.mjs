import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { releaseYears } from './etl.mjs';

const origin = 'https://subsidydropoff.com';
const local = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const enrollment = local('public/oe-window.json');
const cases = local('src/etl/py2027/marketplace-cases.json');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const scriptPath = '/app.js?v=' + createHash('sha256').update(script).digest('hex').slice(0, 16);
const deadline = Date.now() + 240_000;
async function get(path, options, status = 200) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Publication verification timed out');
  const res = await fetch(origin + path, { cache: 'no-store', ...options, signal: AbortSignal.timeout(Math.min(20_000, remaining)) });
  assert.equal(res.status, status, path);
  return res;
}
async function post(path, input, status = 200) {
  return (await get(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, status)).json();
}
function quote(planYear, zip, countyFips, ages = [40], status = 200) {
  return post('/api/estimate', { planYear, zip, countyFips, ages, income: 46000, householdSize: ages.length }, status);
}
async function verify() {
  assert.deepEqual(await (await get('/oe-window.json')).json(), enrollment);
  const html = await (await get('/')).text();
  assert.ok(html.includes(enrollment.ruleStatus));
  assert.ok(html.includes(`<script src="${scriptPath}" type="module">`), 'Published homepage references a previous calculator script');
  assert.equal(await (await get(scriptPath)).text(), script, 'Published versioned calculator script differs from the verified release');
  for (const year of releaseYears) {
    const path = `data/${year}`;
    const manifest = local(`public/${path}/index.json`);
    assert.deepEqual(await (await get(`/${path}/index.json`)).json(), manifest, `Custom domain is serving a different ${year} release`);
    for (const prefix of year === '2027' ? ['995', '968', '750'] : [manifest.prefixes[0]]) {
      assert.deepEqual(await (await get(`/${path}/${prefix}.json`)).json(), local(`public/${path}/${prefix}.json`));
    }
  }
  // Exercise the deployed Pages Function, including every independent Marketplace case.
  for (let i = 0; i < cases.length; i += 4) {
    await Promise.all(cases.slice(i, i + 4).map(async c => {
      const d = await quote(2027, c.zip, c.countyFips, c.ages);
      assert.equal(d.result.location.countyFips, c.countyFips);
      assert.equal(d.result.benchmark.monthlySlcsp, c.monthlySlcsp);
      assert.equal(d.result.benchmark.slcspPlanId, c.planId);
    }));
  }
  const split = await quote(2027, '75034', undefined, [40], 422);
  assert.equal(split.unavailable.reason, 'ambiguous-zip');
  assert.deepEqual(split.unavailable.candidateCounties.map(c => c.fips).sort(), ['48085', '48121']);
  assert.equal((await quote(2027, '75034', '15003', [40], 422)).unavailable.reason, 'unknown-zip');
  assert.equal((await quote(2027, '92101', '06073', [40], 422)).unavailable.reason, 'state-based-exchange');
  assert.equal((await quote(2026, '99501', '02020')).result.benchmark.monthlySlcsp,
    local('public/data/2026/995.json').counties['02020'].slcspRateByAge['40']);
  for (const [region, ceiling, credit] of [['alaska', 79800, 32037], ['hawaii', 73440, 37454]]) {
    for (const [income, status, cents] of [[ceiling, 'within', credit], [ceiling + 0.01, 'above', 0]]) {
      const d = await post('/api/income-check', { planYear: 2027, region, householdSize: 1, income, monthlyBenchmark: 1000 });
      assert.equal(d.incomeStatus, status);
      assert.equal(d.estimatedMonthlyBenchmarkCredit, cents);
      assert.equal(d.suppliedMonthlyBenchmark, 100000);
    }
    const only = await post('/api/income-check', { planYear: 2027, region, householdSize: 1, income: ceiling });
    assert.equal(only.incomeStatus, 'within');
    assert.equal(only.estimatedMonthlyBenchmarkCredit, null);
  }
}
for (let attempt = 1; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw error;
    console.log(`Waiting for verified publication (attempt ${attempt}): ${error.message.slice(0, 250)}`);
    await delay(Math.min(10_000, remaining));
  }
}
console.log(`Verified the 2026 and 2027 releases and ${cases.length} Marketplace comparisons on ${origin}`);
