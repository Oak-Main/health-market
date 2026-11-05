/** Verify the complete staged release before replacing deployed data. */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FileShardLoader } from "../data/file-loader";
import type { ShardIndex } from "../data/shard";
import { BENCHMARK_SOURCE_RELEASE, DATASETS } from "./sources";

const root = process.argv[2];
if (!root) throw new Error("Pass the staged benchmark directory, e.g. npm run etl:verify -- public/data 2026 after benchmarks:prepare");
const year = Number(process.argv[3] ?? BENCHMARK_SOURCE_RELEASE.planYear);
if (year !== BENCHMARK_SOURCE_RELEASE.planYear) throw new Error("Unregistered benchmark year");
const dir = join(root, String(year));
const index = JSON.parse(await readFile(join(dir, "index.json"), "utf8")) as ShardIndex & { shardsFailedValidation: number };
const prefixes = index.prefixes;
if (index.planYear !== year || !Number.isInteger(index.countiesBuilt) || index.countiesBuilt < 1 || index.shardsFailedValidation !== 0 ||
    !Array.isArray(prefixes) || !prefixes.length || prefixes.length !== index.shardCount ||
    new Set(prefixes).size !== prefixes.length || !prefixes.every(p => /^\d{3}$/.test(p))) {
  throw new Error("Invalid or empty benchmark manifest");
}
const actual = (await readdir(dir)).filter(p => p !== "index.json").sort();
const expected = prefixes.map(p => p + ".json").sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Manifest and shard files differ");
const loader = new FileShardLoader(root);
for (const prefix of prefixes) {
  const shard = await loader.load(year, prefix);
  if (!shard || shard.sourceFile !== DATASETS.ratePuf.id + " + " + DATASETS.qhpLandscapeIndividualMedical.id ||
      shard.sourcePublished !== BENCHMARK_SOURCE_RELEASE.ratePublished || !Number.isFinite(Date.parse(shard.generated)) ||
      !Object.keys(shard.zipToCounties).length || Object.keys(shard.zipToCounties).some(zip => !zip.startsWith(prefix) || zip === "00000")) {
    throw new Error("Invalid production shard " + prefix);
  }
}
console.log("Verified " + prefixes.length + " benchmark shards for " + year);
