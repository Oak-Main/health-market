import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const cases = JSON.parse(readFileSync(new URL('../src/etl/py2027/marketplace-cases.json', import.meta.url)));
const endpoint = new URL('/api/v1/households/slcsp', process.env.MARKETPLACE_API_KEY
  ? 'https://marketplace.api.healthcare.gov' : 'https://marketplace-int.api.healthcare.gov');
endpoint.searchParams.set('year', '2027');
if (process.env.MARKETPLACE_API_KEY) endpoint.searchParams.set('apikey', process.env.MARKETPLACE_API_KEY);
const probes = cases.filter(c => ['99501', '96813', '33130', '75034', '99607'].includes(c.zip) &&
  (c.ages.join(',') === '40' || (c.zip === '96813' && c.ages.join(',') === '47,43,12')));
for (const c of probes) {
  const request = {
    year: 2027, market: 'Individual', effective_date: '2027-01-01',
    place: { zipcode: c.zip, countyfips: c.countyFips, state: c.state },
    household: { income: 46000, people: c.ages.map(age => ({ age, aptc_eligible: true, uses_tobacco: false })) },
  };
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(25_000),
    });
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await delay(2000 * attempt);
      continue;
    }
    assert.equal(response.status, 200, `CMS ${c.zip}/${c.countyFips}`);
    const plan = await response.json();
    assert.equal(plan.id, c.planId, `CMS plan changed in ${c.zip}/${c.countyFips}`);
    assert.equal(Math.round(plan.premium * 100), c.monthlySlcsp, `CMS premium changed in ${c.zip}/${c.countyFips}`);
    break;
  }
}
console.log(`Matched ${probes.length} current HealthCare.gov SLCSP responses to the verified 2027 cases`);
