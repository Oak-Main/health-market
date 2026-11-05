/**
 * Pure transform: parsed CMS tables in, validated benchmark shards out.
 *
 * Everything here is a pure function so the logic that is easy to get wrong is
 * unit-testable without network access. `run.ts` is the thin I/O wrapper.
 */

import type { BenchmarkShard, CountyBenchmark } from "../data/shard";
import { parseMoneyToCents, parseRatePufAge } from "./csv";
import {
  deriveSlcsp,
  type MetalLevel,
  type NormalisedPlanRate,
} from "./slcsp";

/** CMS supplies numeric ZIP and county codes that can lose their leading zeros. */
export function normalizeGeographicCode(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d{1,5}$/.test(value)) return null;
  const padded = value.padStart(5, "0");
  return padded === "00000" ? null : padded;
}

/** Rate PUF columns we depend on. */
export const RATE_PUF_COLUMNS = [
  "BusinessYear",
  "StateCode",
  "PlanId",
  "RatingAreaId",
  "Age",
  "IndividualRate",
] as const;

/** Plan Attributes PUF columns we depend on. */
export const PLAN_ATTRIBUTES_COLUMNS = [
  "BusinessYear",
  "StateCode",
  "StandardComponentId",
  "MetalLevel",
  "MarketCoverage",
  "DentalOnlyPlan",
  "ServiceAreaId",
] as const;

export type CsvRow = Readonly<Record<string, string>>;

export class EtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtlError";
  }
}

function normaliseMetal(raw: string): MetalLevel | null {
  const v = raw.trim().toLowerCase();
  if (v === "silver") return "Silver";
  if (v === "bronze") return "Bronze";
  if (v === "expanded bronze") return "Expanded Bronze";
  if (v === "gold") return "Gold";
  if (v === "platinum") return "Platinum";
  if (v === "catastrophic") return "Catastrophic";
  return null;
}

export interface PlanAttribute {
  readonly planId: string;
  readonly stateCode: string;
  readonly metalLevel: MetalLevel;
  readonly serviceAreaId: string;
  readonly onExchange: boolean;
}

/**
 * Index the Plan Attributes PUF.
 *
 * Filters to individual-market, non-dental plans. The PUF repeats a row per
 * CSR variant; we keep one entry per standard component id because rates are
 * filed at the standard-component level.
 */
export function indexPlanAttributes(rows: readonly CsvRow[]): Map<string, PlanAttribute> {
  const index = new Map<string, PlanAttribute>();

  for (const row of rows) {
    if ((row["DentalOnlyPlan"] ?? "").trim().toLowerCase() === "yes") continue;

    const market = (row["MarketCoverage"] ?? "").trim().toLowerCase();
    if (!market.startsWith("individual")) continue;

    const metalLevel = normaliseMetal(row["MetalLevel"] ?? "");
    if (!metalLevel) continue;

    const planId = (row["StandardComponentId"] ?? "").trim();
    if (!planId) continue;

    if (!index.has(planId)) {
      index.set(planId, {
        planId,
        stateCode: (row["StateCode"] ?? "").trim(),
        metalLevel,
        serviceAreaId: (row["ServiceAreaId"] ?? "").trim(),
        // Every plan in the Plan Attributes PUF individual-market extract is
        // certified for the Exchange; off-exchange-only products are excluded
        // upstream by CMS.
        onExchange: true,
      });
    }
  }

  return index;
}

/**
 * Fold the Rate PUF into per-plan, per-rating-area age tables.
 *
 * Only non-tobacco individual rates are used: tobacco surcharges vary by plan
 * and would break the composition-invariance property the shard format relies
 * on, and the benchmark for premium tax credit purposes is the non-tobacco rate.
 */
export function buildPlanRates(
  rows: readonly CsvRow[],
  attributes: ReadonlyMap<string, PlanAttribute>,
  planYear: number,
): Map<string, NormalisedPlanRate> {
  const byKey = new Map<string, Map<number, number>>();
  const meta = new Map<string, { planId: string; ratingAreaId: string }>();

  for (const row of rows) {
    if (Number(row["BusinessYear"]) !== planYear) continue;

    const planId = (row["PlanId"] ?? "").trim();
    if (!attributes.has(planId)) continue;

    const age = parseRatePufAge(row["Age"] ?? "");
    if (age === null) continue; // "Family Option" rows

    const rate = parseMoneyToCents(row["IndividualRate"] ?? "");
    if (rate === null || rate <= 0) continue;

    const ratingAreaId = (row["RatingAreaId"] ?? "").trim();
    const key = `${planId}|${ratingAreaId}`;

    let table = byKey.get(key);
    if (!table) {
      table = new Map<number, number>();
      byKey.set(key, table);
      meta.set(key, { planId, ratingAreaId });
    }
    // Keep the lowest filed rate if an issuer files duplicates for an age.
    const existing = table.get(age);
    if (existing === undefined || rate < existing) table.set(age, rate);
  }

  const result = new Map<string, NormalisedPlanRate>();
  for (const [key, rateByAge] of byKey) {
    const m = meta.get(key)!;
    const attribute = attributes.get(m.planId)!;
    result.set(key, {
      planId: m.planId,
      metalLevel: attribute.metalLevel,
      ratingAreaId: m.ratingAreaId,
      stateCode: attribute.stateCode,
      rateByAge,
      onExchange: attribute.onExchange,
    });
  }
  return result;
}

/**
 * Verify that the identity of the benchmark plan does not depend on household
 * composition.
 *
 * The shard format precomputes one benchmark plan per county, which is only
 * valid because every plan in a state is rated off the same age curve. Rather
 * than assume that, we re-derive the benchmark at several very different
 * household shapes and require agreement.
 *
 * Returns the offending ages if the invariant fails, or null if it holds.
 */
export function checkCompositionInvariance(
  plans: readonly NormalisedPlanRate[],
): { expected: string | null; got: string | null; probe: string } | null {
  const probes: { label: string; members: { age: number; seeksCoverage: boolean }[] }[] = [
    { label: "single-21", members: [{ age: 21, seeksCoverage: true }] },
    { label: "single-64", members: [{ age: 64, seeksCoverage: true }] },
    {
      label: "family-of-4",
      members: [
        { age: 45, seeksCoverage: true },
        { age: 43, seeksCoverage: true },
        { age: 15, seeksCoverage: true },
        { age: 8, seeksCoverage: true },
      ],
    },
  ];

  let expected: string | null | undefined;
  for (const probe of probes) {
    const { slcspPlanId } = deriveSlcsp(plans, probe.members);
    if (expected === undefined) {
      expected = slcspPlanId;
      continue;
    }
    if (slcspPlanId !== expected) {
      return { expected: expected ?? null, got: slcspPlanId, probe: probe.label };
    }
  }
  return null;
}

/**
 * Resolve which rating area a county sits in, by cross-checking two CMS files.
 *
 * The Rate PUF files rates per (plan, rating area) but says nothing about
 * counties. The QHP Landscape file lists plans per county with a premium at
 * standard age points but no rating area. Joining them needs the county's
 * rating area, which is a third dataset that varies by state.
 *
 * Instead of importing that third dataset, we let the two files verify each
 * other: the correct rating area is the one whose filed age-40 rate matches
 * the landscape's stated age-40 premium for the same plan. If exactly one
 * candidate matches, the join is confirmed by construction. If none or several
 * match, we return null and the county is skipped rather than guessed.
 *
 * @param landscapeAge40 Age-40 individual premium from the QHP Landscape file.
 * @param candidates Rate PUF entries for the same plan across rating areas.
 */
export function resolveRatingArea(
  landscapeAge40: number,
  candidates: readonly NormalisedPlanRate[],
  toleranceCents = 100,
): string | null {
  const matches = candidates.filter((c) => {
    const rate = c.rateByAge.get(40);
    return rate !== undefined && Math.abs(rate - landscapeAge40) <= toleranceCents;
  });
  return matches.length === 1 ? matches[0]!.ratingAreaId : null;
}

export interface CountyInput {
  readonly countyFips: string;
  readonly countyName: string;
  readonly stateCode: string;
  readonly ratingAreaId: string;
  /** Plans available in this county, already filtered to its rating area. */
  readonly plans: readonly NormalisedPlanRate[];
}

export interface BuildOptions {
  readonly planYear: number;
  readonly sourceFile: string;
  readonly sourcePublished: string;
  readonly generated: string;
  readonly zipToCounties: Readonly<Record<string, readonly string[]>>;
}

export interface BuildOutcome {
  /** Shards keyed by three-digit ZIP prefix. */
  readonly shards: Map<string, BenchmarkShard>;
  readonly warnings: readonly string[];
  readonly countiesBuilt: number;
  readonly countiesSkipped: number;
}

/**
 * Build the per-ZIP3 shards.
 *
 * Counties that fail the composition-invariance check or that have no silver
 * plan are SKIPPED with a warning rather than emitted with an approximation.
 * A missing county produces an honest "unavailable" at request time; a wrong
 * county produces a confidently wrong subsidy, which is far worse.
 */
export function buildShards(
  counties: readonly CountyInput[],
  options: BuildOptions,
): BuildOutcome {
  const warnings: string[] = [];
  const built = new Map<string, CountyBenchmark>();

  for (const county of counties) {
    const invariance = checkCompositionInvariance(county.plans);
    if (invariance) {
      warnings.push(
        `SKIPPED ${county.countyFips} (${county.countyName}, ${county.stateCode}): ` +
          `benchmark plan changes with household composition — expected ` +
          `${invariance.expected} but probe "${invariance.probe}" gave ${invariance.got}. ` +
          `This state may file non-uniform age curves; the precomputed shard ` +
          `format cannot represent it.`,
      );
      continue;
    }

    const probe = [{ age: 40, seeksCoverage: true }];
    const derivation = deriveSlcsp(county.plans, probe);
    if (derivation.slcspPlanId === null) {
      warnings.push(
        `SKIPPED ${county.countyFips} (${county.countyName}, ${county.stateCode}): ` +
          `no on-exchange silver plan found.`,
      );
      continue;
    }

    const slcspPlan = county.plans.find((p) => p.planId === derivation.slcspPlanId);
    const lcbpPlan = county.plans.find((p) => p.planId === derivation.lcbpPlanId);
    if (!slcspPlan) {
      warnings.push(`SKIPPED ${county.countyFips}: benchmark plan id did not resolve.`);
      continue;
    }

    const toTable = (plan: NormalisedPlanRate): Record<string, number> => {
      const table: Record<string, number> = {};
      for (const [age, rate] of plan.rateByAge) table[String(age)] = rate;
      return table;
    };

    built.set(county.countyFips, {
      countyFips: county.countyFips,
      countyName: county.countyName,
      stateCode: county.stateCode,
      ratingAreaId: county.ratingAreaId,
      slcspPlanId: slcspPlan.planId,
      slcspRateByAge: toTable(slcspPlan),
      lcbpPlanId: lcbpPlan?.planId ?? null,
      lcbpRateByAge: lcbpPlan ? toTable(lcbpPlan) : null,
      silverPlanCount: derivation.silverPlanCount,
    });
  }

  // Group into ZIP3 shards, carrying only the counties each shard references.
  const zipsByPrefix = new Map<string, Record<string, readonly string[]>>();
  for (const [zip, fipsList] of Object.entries(options.zipToCounties)) {
    const reachable = fipsList.filter((f) => built.has(f));
    if (reachable.length === 0) continue;
    const prefix = zip.slice(0, 3);
    const bucket = zipsByPrefix.get(prefix) ?? {};
    bucket[zip] = reachable;
    zipsByPrefix.set(prefix, bucket);
  }

  const shards = new Map<string, BenchmarkShard>();
  for (const [prefix, zipToCounties] of zipsByPrefix) {
    const needed = new Set(Object.values(zipToCounties).flat());
    const counties: Record<string, CountyBenchmark> = {};
    for (const fips of needed) counties[fips] = built.get(fips)!;

    shards.set(prefix, {
      planYear: options.planYear,
      generated: options.generated,
      sourceFile: options.sourceFile,
      sourcePublished: options.sourcePublished,
      zipToCounties,
      counties,
    });
  }

  return {
    shards,
    warnings,
    countiesBuilt: built.size,
    countiesSkipped: counties.length - built.size,
  };
}
