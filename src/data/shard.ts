/**
 * The built benchmark dataset: shard format and the provider that reads it.
 *
 * THE INVARIANT THAT MAKES THIS COMPACT
 * -------------------------------------
 * Every plan in a state is rated off the SAME age curve — either the federal
 * default standard age curve or a state-specific one, but uniform within the
 * state (45 CFR 147.102). So if plan A costs 0.9x plan B at age 21, it costs
 * 0.9x plan B at every age.
 *
 * Consequence: the identity of the second-lowest-cost silver plan does NOT
 * depend on household composition. We can precompute, per county, the single
 * benchmark plan and its full age-rate table, and then price any household
 * exactly by summing that plan's rates for the rated members.
 *
 * The ETL asserts this invariant rather than assuming it: it re-ranks silver
 * plans at several ages and fails the build if the ordering ever differs.
 * If a state files non-uniform curves, we find out at build time instead of
 * quoting a wrong benchmark to a user.
 */

import {
  type BenchmarkFreshness,
  type BenchmarkProvider,
  type BenchmarkRequest,
  type BenchmarkResult,
} from "../core/benchmark";
import { selectRatedMembers } from "../core/rating";
import type { Cents, FplRegion, PlanYear } from "../core/types";
import { lookupMarketplace, usesFederalData } from "./exchanges";

/** A benchmark plan's rates by age, ages 14 (0-14 bucket) through 64 (64+). */
export type AgeRateTable = Readonly<Record<string, Cents>>;

export interface CountyBenchmark {
  readonly countyFips: string;
  readonly countyName: string;
  readonly stateCode: string;
  readonly ratingAreaId: string;
  readonly slcspPlanId: string;
  readonly slcspRateByAge: AgeRateTable;
  readonly lcbpPlanId: string | null;
  readonly lcbpRateByAge: AgeRateTable | null;
  readonly silverPlanCount: number;
}

export interface BenchmarkShard {
  readonly planYear: PlanYear;
  /** ISO timestamp the shard was generated. */
  readonly generated: string;
  /** Source dataset identifier and publication date, shown in the UI. */
  readonly sourceFile: string;
  readonly sourcePublished: string;
  /** ZIP -> candidate county FIPS codes. Multi-entry means an ambiguous ZIP. */
  readonly zipToCounties: Readonly<Record<string, readonly string[]>>;
  readonly counties: Readonly<Record<string, CountyBenchmark>>;
}

export class ShardIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShardIntegrityError";
  }
}

/** Validate a shard's internal consistency before it is served. */
export function validateShard(shard: BenchmarkShard): string[] {
  const problems: string[] = [];

  for (const [zip, counties] of Object.entries(shard.zipToCounties)) {
    if (!/^\d{5}$/.test(zip)) problems.push(`ZIP "${zip}" is not five digits.`);
    if (counties.length === 0) problems.push(`ZIP ${zip} maps to no county.`);
    for (const fips of counties) {
      if (!shard.counties[fips]) {
        problems.push(`ZIP ${zip} references unknown county FIPS ${fips}.`);
      }
    }
  }

  for (const [fips, county] of Object.entries(shard.counties)) {
    if (county.countyFips !== fips) {
      problems.push(`County key ${fips} disagrees with its countyFips ${county.countyFips}.`);
    }
    if (!/^\d{5}$/.test(fips)) problems.push(`County FIPS "${fips}" is not five digits.`);

    const ages = Object.keys(county.slcspRateByAge).map(Number);
    for (let age = 14; age <= 64; age += 1) {
      if (!ages.includes(age)) {
        problems.push(`County ${fips} benchmark is missing a rate for age ${age}.`);
        break;
      }
    }
    for (const [age, rate] of Object.entries(county.slcspRateByAge)) {
      if (!Number.isInteger(rate) || rate <= 0) {
        problems.push(`County ${fips} has a non-positive rate ${rate} at age ${age}.`);
        break;
      }
    }
    // The 3:1 age band is a hard statutory ceiling; a violation means the
    // build joined the wrong rows.
    const at21 = county.slcspRateByAge["21"];
    const at64 = county.slcspRateByAge["64"];
    if (at21 && at64 && at64 > at21 * 3.0001) {
      problems.push(
        `County ${fips} violates the 3:1 age band: ${at64} at 64 vs ${at21} at 21.`,
      );
    }
  }

  return problems;
}

/** The per-plan-year manifest written alongside shards; see src/etl/run.ts. */
export interface ShardIndex {
  readonly planYear: PlanYear;
  readonly generated: string;
  readonly shardCount: number;
  readonly countiesBuilt: number;
  readonly countiesSkipped: number;
  readonly prefixes: readonly string[];
}

export interface ShardLoader {
  /** Return the shard for a ZIP's 3-digit prefix, or null if not built. */
  load(planYear: PlanYear, zip3: string): Promise<BenchmarkShard | null>;
  /**
   * Return the plan year's index.json manifest, or null if no dataset has
   * been built for that plan year at all. Optional: not every loader (e.g.
   * MemoryShardLoader in tests) has a manifest to read.
   */
  loadIndex?(planYear: PlanYear): Promise<ShardIndex | null>;
}

/** Region a state falls in for poverty-guideline purposes. */
export function regionForState(stateCode: string): FplRegion {
  if (stateCode === "AK") return "alaska";
  if (stateCode === "HI") return "hawaii";
  return "contiguous";
}

function rateFor(table: AgeRateTable, age: number): Cents | null {
  const key = String(age <= 14 ? 14 : age >= 64 ? 64 : age);
  return table[key] ?? null;
}

/**
 * Serves benchmarks from built shards. Never estimates: any gap in the data
 * produces a typed `unavailable` result naming the specific reason.
 */
export class StaticBenchmarkProvider implements BenchmarkProvider {
  readonly name = "static-shard";

  constructor(private readonly loader: ShardLoader) {}

  async getFreshness(planYear: PlanYear): Promise<BenchmarkFreshness | null> {
    const index = await this.loader.loadIndex?.(planYear);
    return index ? { generated: index.generated } : null;
  }

  async getBenchmark(request: BenchmarkRequest): Promise<BenchmarkResult> {
    const zip = request.zip.trim();
    if (!/^\d{5}$/.test(zip)) {
      return {
        kind: "unavailable",
        reason: "unknown-zip",
        message: `"${request.zip}" is not a five-digit ZIP code.`,
      };
    }

    const shard = await this.loader.load(request.planYear, zip.slice(0, 3));
    if (!shard) {
      return {
        kind: "unavailable",
        reason: "plan-year-not-published",
        message:
          `No benchmark data is built for plan year ${request.planYear}. CMS ` +
          `publishes plan-year data around October of the preceding year; ` +
          `PY2027 files were not available as of 2026-07-27.`,
      };
    }

    const candidates = shard.zipToCounties[zip];
    if (!candidates || candidates.length === 0) {
      return {
        kind: "unavailable",
        reason: "unknown-zip",
        message: `ZIP ${zip} is not present in the plan year ${request.planYear} crosswalk.`,
      };
    }

    let fips = request.countyFips;
    if (!fips) {
      if (candidates.length > 1) {
        // A ZIP spanning several counties can span several rating areas, and
        // therefore several different benchmark premiums. Ask rather than guess.
        return {
          kind: "unavailable",
          reason: "ambiguous-zip",
          message:
            `ZIP ${zip} spans ${candidates.length} counties, which may sit in ` +
            `different rating areas. Select a county to get an exact benchmark.`,
          candidateCounties: candidates.map((f) => {
            const c = shard.counties[f];
            return { fips: f, name: c?.countyName ?? "Unknown", state: c?.stateCode ?? "" };
          }),
        };
      }
      fips = candidates[0]!;
    }

    const county = candidates.includes(fips) ? shard.counties[fips] : undefined;
    if (!county) {
      return {
        kind: "unavailable",
        reason: "unknown-zip",
        message: `County FIPS ${fips} is not in the plan year ${request.planYear} dataset.`,
      };
    }

    if (!usesFederalData(county.stateCode)) {
      const marketplace = lookupMarketplace(county.stateCode);
      return {
        kind: "unavailable",
        reason: "state-based-exchange",
        message:
          `${marketplace?.name ?? county.stateCode} runs its own Marketplace, so its ` +
          `plans and rates are not in the federal public use files.` +
          (marketplace?.hasStateSubsidy
            ? ` ${marketplace.name} also offers its own premium assistance on top of ` +
              `the federal credit, so a federal-only estimate would understate your help.`
            : ""),
        ...(marketplace ? { exchangeUrl: marketplace.url, exchangeName: marketplace.exchangeName } : {}),
      };
    }

    const { rated } = selectRatedMembers(request.members);
    if (rated.length === 0) {
      return {
        kind: "unavailable",
        reason: "dataset-not-loaded",
        message: "No household member is seeking coverage, so no benchmark applies.",
      };
    }

    let monthlySlcsp = 0;
    for (const member of rated) {
      const rate = rateFor(county.slcspRateByAge, member.age);
      if (rate === null) {
        return {
          kind: "unavailable",
          reason: "dataset-not-loaded",
          message:
            `The benchmark plan in ${county.countyName}, ${county.stateCode} has no ` +
            `filed rate for age ${member.age}.`,
        };
      }
      monthlySlcsp += rate;
    }

    let monthlyLcbp: Cents | null = null;
    if (county.lcbpRateByAge) {
      let total = 0;
      let complete = true;
      for (const member of rated) {
        const rate = rateFor(county.lcbpRateByAge, member.age);
        if (rate === null) {
          complete = false;
          break;
        }
        total += rate;
      }
      monthlyLcbp = complete ? total : null;
    }

    return {
      kind: "quote",
      planYear: shard.planYear,
      monthlySlcsp,
      monthlyLcbp,
      ratingAreaId: county.ratingAreaId,
      countyFips: county.countyFips,
      region: regionForState(county.stateCode),
      slcspPlanId: county.slcspPlanId,
      sourceFile: shard.sourceFile,
      sourcePublished: shard.sourcePublished,
      generated: shard.generated,
    };
  }
}

/** An in-memory loader, used by tests and by the dev server. */
export class MemoryShardLoader implements ShardLoader {
  private readonly shards = new Map<string, BenchmarkShard>();
  private readonly indexes = new Map<PlanYear, ShardIndex>();

  add(zip3: string, shard: BenchmarkShard): this {
    const problems = validateShard(shard);
    if (problems.length > 0) {
      throw new ShardIntegrityError(
        `Refusing to load shard ${shard.planYear}/${zip3}:\n  ${problems.join("\n  ")}`,
      );
    }
    this.shards.set(`${shard.planYear}/${zip3}`, shard);
    return this;
  }

  /** Set the index.json manifest a test wants loadIndex() to return. */
  setIndex(planYear: PlanYear, index: ShardIndex): this {
    this.indexes.set(planYear, index);
    return this;
  }

  async load(planYear: PlanYear, zip3: string): Promise<BenchmarkShard | null> {
    return this.shards.get(`${planYear}/${zip3}`) ?? null;
  }

  async loadIndex(planYear: PlanYear): Promise<ShardIndex | null> {
    return this.indexes.get(planYear) ?? null;
  }
}
