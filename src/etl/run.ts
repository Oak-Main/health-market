/**
 * ETL orchestration: fetch CMS public use files, derive benchmarks, write shards.
 *
 *   npm run etl -- --plan-year=2026 --out=public/data
 *   npm run etl -- --plan-year=2026 --from-dir=./downloads   (offline)
 *
 * Must be run from an environment with outbound HTTPS to healthdata.gov,
 * data.healthcare.gov and download.cms.gov. Shards are committed to the repo
 * and served as static assets, so production never talks to CMS at request time.
 *
 * Runs only for the registered CMS release. New plan years require their own
 * reviewed sources before this pipeline will build or label public premiums.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateShard } from "../data/shard";
import {
  buildPlanRates,
  buildShards,
  indexPlanAttributes,
  normalizeGeographicCode,
  resolveRatingArea,
  type CountyInput,
  type CsvRow,
} from "./build";
import { parseCsvTable, parseMoneyToCents } from "./csv";
import { BENCHMARK_SOURCE_RELEASE, DATASETS, fetchText, NetworkBlockedError, type DatasetKey } from "./sources";
import type { NormalisedPlanRate } from "./slcsp";

interface Args {
  planYear: number;
  outDir: string;
  fromDir: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  const planYear = Number(get("plan-year") ?? new Date().getUTCFullYear());
  if (planYear !== BENCHMARK_SOURCE_RELEASE.planYear) {
    throw new Error(`The registered benchmark sources cover plan year ${BENCHMARK_SOURCE_RELEASE.planYear}, not ${planYear}.`);
  }
  return {
    planYear,
    outDir: get("out") ?? "public/data",
    fromDir: get("from-dir") ?? null,
  };
}

async function load(name: DatasetKey, args: Args): Promise<string> {
  const dataset = DATASETS[name];
  if (args.fromDir) {
    const path = join(args.fromDir, `${dataset.id}.csv`);
    console.log(`  reading ${path}`);
    return readFile(path, "utf8");
  }
  const url = dataset.downloadUrl;
  console.log(`  fetching ${url}`);
  return fetchText(url);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`ETL for plan year ${args.planYear} -> ${args.outDir}\n`);

  console.log("1/5 Loading source files");
  const sourceKeys = [
    "planAttributesPuf",
    "ratePuf",
    "qhpLandscapeIndividualMedical",
    "slcspCountyZip",
  ] as const satisfies readonly DatasetKey[];
  const results = await Promise.allSettled(sourceKeys.map((key) => load(key, args)));

  const failed: DatasetKey[] = [];
  const loadedByKey = {} as Record<DatasetKey, string>;
  for (const [i, key] of sourceKeys.entries()) {
    const result = results[i];
    if (!result) continue; // unreachable: results has one entry per sourceKeys entry
    if (result.status === "rejected") {
      failed.push(key);
      console.error(`  FAILED to load ${key}: ${String(result.reason)}`);
    } else {
      loadedByKey[key] = result.value;
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `ETL aborted: failed to load ${failed.join(", ")}. The other ` +
        `${sourceKeys.length - failed.length} source(s) loaded fine — this is a ` +
        `problem with the failed dataset(s) specifically (renamed/retired Socrata ID, ` +
        `moved PUF path, etc.), not a general network outage. Check each failed ` +
        `dataset's landingPage in src/etl/sources.ts.`,
    );
  }

  const attributesCsv = loadedByKey.planAttributesPuf;
  const ratesCsv = loadedByKey.ratePuf;
  const landscapeCsv = loadedByKey.qhpLandscapeIndividualMedical;
  const zipCsv = loadedByKey.slcspCountyZip;

  console.log("2/5 Parsing");
  const attributes = indexPlanAttributes(
    parseCsvTable(attributesCsv, ["StandardComponentId", "MetalLevel", "MarketCoverage"]).rows,
  );
  const rates = buildPlanRates(
    parseCsvTable(ratesCsv, ["PlanId", "RatingAreaId", "Age", "IndividualRate"]).rows,
    attributes,
    args.planYear,
  );
  const landscape = parseCsvTable(landscapeCsv, ["FIPS County Code", "Plan ID (Standard Component)"]).rows;
  const zipRows = parseCsvTable(zipCsv, []).rows;
  console.log(
    `  ${attributes.size} plans, ${rates.size} plan/rating-area rate tables, ` +
      `${landscape.length} landscape rows`,
  );

  console.log("3/5 Joining counties to rating areas");
  const ratesByPlan = new Map<string, NormalisedPlanRate[]>();
  for (const rate of rates.values()) {
    const bucket = ratesByPlan.get(rate.planId) ?? [];
    bucket.push(rate);
    ratesByPlan.set(rate.planId, bucket);
  }

  const countyPlans = new Map<string, { meta: CsvRow; plans: NormalisedPlanRate[] }>();
  let unresolved = 0;

  for (const row of landscape) {
    const fips = normalizeGeographicCode(row["FIPS County Code"] ?? "");
    const planId = (row["Plan ID (Standard Component)"] ?? row["Plan ID"] ?? "").trim();
    if (!fips || !planId) continue;

    const candidates = ratesByPlan.get(planId);
    if (!candidates || candidates.length === 0) continue;

    const age40 = parseMoneyToCents(
      row["Premium Adult Individual Age 40"] ?? row["Premium Adult Individual Age 40 "] ?? "",
    );
    let chosen: NormalisedPlanRate | undefined;
    if (candidates.length === 1) {
      chosen = candidates[0];
    } else if (age40 !== null) {
      const areaId = resolveRatingArea(age40, candidates);
      chosen = candidates.find((c) => c.ratingAreaId === areaId);
    }
    if (!chosen) {
      unresolved += 1;
      continue;
    }

    const entry = countyPlans.get(fips) ?? { meta: row, plans: [] };
    entry.plans.push(chosen);
    countyPlans.set(fips, entry);
  }
  console.log(`  ${countyPlans.size} counties, ${unresolved} unresolved plan/county rows`);

  const counties: CountyInput[] = [...countyPlans].map(([countyFips, { meta, plans }]) => ({
    countyFips,
    countyName: (meta["County Name"] ?? "").trim() || "Unknown",
    stateCode: (meta["State Code"] ?? "").trim(),
    ratingAreaId: plans[0]?.ratingAreaId ?? "Unknown",
    plans,
  }));

  const zipToCounties: Record<string, string[]> = {};
  for (const row of zipRows) {
    const zip = normalizeGeographicCode(row["zipcode"] ?? row["ZIP Code"] ?? row["Zip Code"] ?? row["zip"] ?? "");
    const fips = normalizeGeographicCode(row["countycode"] ?? row["FIPS"] ?? row["fips"] ?? row["county"] ?? "");
    if (!zip || !fips) continue;
    (zipToCounties[zip] ??= []).push(fips);
  }
  console.log(`  ${Object.keys(zipToCounties).length} ZIP codes in the crosswalk`);

  console.log("4/5 Deriving benchmarks");
  const outcome = buildShards(counties, {
    planYear: args.planYear,
    sourceFile: `${DATASETS.ratePuf.id} + ${DATASETS.qhpLandscapeIndividualMedical.id}`,
    sourcePublished: BENCHMARK_SOURCE_RELEASE.ratePublished,
    generated: new Date().toISOString(),
    zipToCounties,
  });
  console.log(`  built ${outcome.countiesBuilt}, skipped ${outcome.countiesSkipped}`);
  for (const warning of outcome.warnings.slice(0, 25)) console.log(`  ! ${warning}`);
  if (outcome.warnings.length > 25) {
    console.log(`  ! ...and ${outcome.warnings.length - 25} more warnings`);
  }

  console.log("5/5 Validating and writing");
  if (outcome.shards.size === 0 || outcome.countiesBuilt === 0) {
    throw new Error("ETL produced no usable benchmark dataset.");
  }
  const invalidShards: string[] = [];
  for (const [prefix, shard] of outcome.shards) {
    const problems = validateShard(shard);
    if (problems.length) invalidShards.push(`${prefix}: ${problems.join("; ")}`);
  }
  if (invalidShards.length) throw new Error(`Invalid benchmark shards:\n${invalidShards.join("\n")}`);
  const dir = join(args.outDir, String(args.planYear));
  await mkdir(dir, { recursive: true });
  const writtenPrefixes = [...outcome.shards.keys()].sort();
  for (const [prefix, shard] of outcome.shards) {
    await writeFile(join(dir, `${prefix}.json`), JSON.stringify(shard));
  }

  await writeFile(
    join(dir, "index.json"),
    JSON.stringify({
      planYear: args.planYear,
      generated: new Date().toISOString(),
      shardCount: writtenPrefixes.length,
      shardsFailedValidation: 0,
      countiesBuilt: outcome.countiesBuilt,
      countiesSkipped: outcome.countiesSkipped,
      warnings: outcome.warnings,
      prefixes: writtenPrefixes,
    }, null, 2),
  );

  console.log(`\nWrote ${writtenPrefixes.length} shards to ${dir}`);
}

main().catch((error: unknown) => {
  if (error instanceof NetworkBlockedError) {
    console.error(`\n${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
