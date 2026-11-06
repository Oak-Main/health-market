/** Year-specific Marketplace offerings. Geographic candidates are retained even without prices. */
export interface MarketRates {
  readonly counties: Readonly<Record<string, { countyName: string; stateCode: string }>>;
  readonly locations: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly groups: Readonly<Record<string, { ratingAreaId: string; plans: readonly string[]; dental: readonly string[] }>>;
  readonly dental: Readonly<Record<string, { ages?: readonly number[]; tiers?: readonly number[] }>>;
  readonly plans: Readonly<Record<string, { planId: string; cents: readonly number[]; embeddedDental: boolean }>>;
}

export function validateMarket(market: MarketRates, zips: Readonly<Record<string, readonly string[]>>): string[] {
  const errors: string[] = [];
  for (const [fips, county] of Object.entries(market.counties)) {
    if (!/^\d{5}$/.test(fips) || !county.countyName || !/^[A-Z]{2}$/.test(county.stateCode)) {
      errors.push(`Invalid geographic entry for ${fips}`);
    }
  }
  for (const [key, plan] of Object.entries(market.plans)) {
    if (plan.cents.length !== 51 || !plan.cents.every(n => Number.isSafeInteger(n) && n > 0) ||
        !/^\d{5}[A-Z]{2}\d{7}$/.test(plan.planId) || typeof plan.embeddedDental !== 'boolean' ||
        key.split('/')[0] !== plan.planId) {
      errors.push(`Invalid EHB rates in ${key}`);
    }
  }
  for (const [key, tariff] of Object.entries(market.dental)) {
    const amounts = tariff.ages ?? tariff.tiers;
    if (!amounts || Boolean(tariff.ages) === Boolean(tariff.tiers) || amounts.length !== (tariff.ages ? 5 : 4) ||
        !amounts.every(n => Number.isSafeInteger(n) && n > 0)) errors.push(`Invalid pediatric dental rates in ${key}`);
  }
  for (const [key, group] of Object.entries(market.groups)) {
    const area = /^Rating Area (\d+)$/.exec(group.ratingAreaId)?.[1];
    if (!area || !group.plans.length || new Set(group.plans).size !== group.plans.length ||
        group.plans.some(plan => !market.plans[plan] || plan.split('/')[1] !== area) ||
        new Set(group.dental).size !== group.dental.length || group.dental.some(plan => !market.dental[plan] || plan.split('/')[1] !== area)) {
      errors.push(`Invalid silver plan group ${key}`);
    }
  }
  for (const [zip, byCounty] of Object.entries(market.locations)) {
    for (const [fips, group] of Object.entries(byCounty)) {
      if (!zips[zip]?.includes(fips) || !market.groups[group] ||
          market.groups[group]?.plans.some(p => market.plans[p]?.planId.slice(5, 7) !== market.counties[fips]?.stateCode)) {
        errors.push(`Invalid offering for ${zip}/${fips}`);
      }
    }
  }
  return errors;
}

/** The filed EHB premium is rounded per member before family premiums are summed. */
export function marketBenchmark(market: MarketRates, groupId: string, ratedAges: readonly number[], childAges: readonly number[]) {
  const group = market.groups[groupId]!;
  const dentalPremiums = group.dental.map(key => {
    const tariff = market.dental[key]!;
    if (tariff.tiers) return tariff.tiers[Math.min(childAges.length, 4) - 1] ?? 0;
    return childAges.slice(0, 3).reduce((sum, age) => sum + tariff.ages![Math.max(14, age) - 14]!, 0);
  }).sort((a, b) => a - b);
  const dental = dentalPremiums[1] ?? dentalPremiums[0];
  const silver = group.plans.map(key => {
    const plan = market.plans[key]!;
    const monthly = ratedAges.reduce((sum, age) => sum + plan.cents[Math.max(14, Math.min(age, 64)) - 14]!, 0);
    return { id: plan.planId, monthly: monthly + (childAges.length && !plan.embeddedDental ? dental ?? 0 : 0), embeddedDental: plan.embeddedDental };
  }).sort((a, b) => a.monthly - b.monthly || a.id.localeCompare(b.id));
  const rank = Math.min(1, silver.length - 1);
  // An unverified pediatric dental add-on may change both the order and the amount.
  // When the two cheapest options include dental, other plans can only become more expensive.
  if (childAges.length && dental === undefined && silver.slice(0, rank + 1).some(plan => !plan.embeddedDental)) return null;
  return { plan: silver[rank]!, ratingAreaId: group.ratingAreaId };
}
