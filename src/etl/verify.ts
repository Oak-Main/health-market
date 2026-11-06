/** Verify each independently staged plan year before either is published. */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FileShardLoader } from "../data/file-loader";
import { StaticBenchmarkProvider, type ShardIndex } from "../data/shard";
import { BENCHMARK_SOURCE_RELEASE, DATASETS } from "./sources";
import current from "./py2027/sources.json";
import comparisonCases from "./py2027/marketplace-cases.json";

const root = process.argv[2];
if (!root) throw new Error("Pass the staged data directory and plan year");
const year = Number(process.argv[3] ?? BENCHMARK_SOURCE_RELEASE.planYear);
if (year !== 2026 && year !== 2027) throw new Error("Unregistered benchmark year");
const modern = year === current.planYear;
const release = modern ? current : {
  ...BENCHMARK_SOURCE_RELEASE, sourceFile: DATASETS.ratePuf.id + " + " + DATASETS.qhpLandscapeIndividualMedical.id,
};
const dir = join(root, String(year));
const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as ShardIndex & {
  shardsFailedValidation: number; sourceCountyCount: number; crosswalkPairs?: number; crosswalkZips?: number;
};
const prefixes = index.prefixes;
if (index.planYear !== year || !Number.isInteger(index.countiesBuilt) || index.countiesBuilt < release.minimumCounties ||
    !Number.isInteger(index.countiesSkipped) || index.countiesSkipped < 0 ||
    !Number.isInteger(index.sourceCountyCount) || index.sourceCountyCount < index.countiesBuilt + index.countiesSkipped ||
    index.shardsFailedValidation !== 0 || !Array.isArray(prefixes) || !prefixes.length || prefixes.length !== index.shardCount ||
    new Set(prefixes).size !== prefixes.length || !prefixes.every(p => /^\d{3}$/.test(p))) {
  throw new Error("Invalid or empty benchmark manifest");
}
const actual = (await readdir(dir)).filter(p => p !== "index.json").sort();
const expected = prefixes.map(p => p + ".json").sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Manifest and shard files differ");
const loader = new FileShardLoader(root);
const coveredCounties = new Set<string>();
let pricedZips = 0, pricedPairs = 0, crosswalkZips = 0, crosswalkPairs = 0;
for (const prefix of prefixes) {
  const shard = await loader.load(year, prefix);
  if (!shard || Boolean(shard.market) !== modern || shard.sourceFile !== release.sourceFile ||
      shard.sourcePublished !== release.ratePublished || !Number.isFinite(Date.parse(shard.generated)) ||
      (modern && shard.generated !== index.generated) || !Object.keys(shard.zipToCounties).length ||
      Object.keys(shard.zipToCounties).some(zip => !zip.startsWith(prefix) || zip === "00000")) {
    throw new Error("Invalid production shard " + prefix);
  }
  for (const [zip, candidates] of Object.entries(shard.zipToCounties)) {
    const priced = shard.market ? Object.keys(shard.market.locations[zip] ?? {}) : candidates;
    if (priced.length) pricedZips++;
    pricedPairs += priced.length;
    crosswalkZips++;
    crosswalkPairs += candidates.length;
    for (const fips of priced) coveredCounties.add(fips);
  }
}
if (coveredCounties.size < release.minimumCounties || coveredCounties.size < index.sourceCountyCount * release.minimumSourceShare) {
  throw new Error(`Only ${coveredCounties.size} of ${index.sourceCountyCount} source counties are reachable through ZIP codes.`);
}
if (modern) {
  const observed = { reachableCounties: coveredCounties.size, pricedZips, pricedZipCountyPairs: pricedPairs, crosswalkZips, crosswalkPairs };
  for (const [key, count] of Object.entries(observed)) {
    if (count !== index[key as keyof typeof index] || count !== current.coverage[key as keyof typeof observed]) {
      throw new Error(`Unreconciled PY2027 geographic count: ${key} = ${count}`);
    }
  }
  if (index.sourceCountyCount !== current.coverage.sourceCountyCount || index.countiesBuilt !== current.coverage.countiesBuilt) {
    throw new Error("The registered PY2027 source or derived county count changed");
  }
  const provider = new StaticBenchmarkProvider(loader);
  for (const c of comparisonCases) {
    const result = await provider.getBenchmark({ planYear: year, zip: c.zip, countyFips: c.countyFips,
      members: c.ages.map(age => ({ age, seeksCoverage: true })) });
    if (result.kind !== "quote" || result.slcspPlanId !== c.planId || result.monthlySlcsp !== c.monthlySlcsp) {
      throw new Error(`Marketplace SLCSP mismatch for ${c.zip}/${c.countyFips}, ages ${c.ages}`);
    }
  }
}
console.log(`Verified ${prefixes.length} shards for ${year}: ${index.sourceCountyCount} source counties, ${index.countiesBuilt} derived, ${coveredCounties.size} ZIP-reachable.`);
