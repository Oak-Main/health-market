// Read-only diagnostic: compare estimator outcomes from two shard roots for every crosswalk ZIP/county pair.
// npx tsx scripts/diagnostics/compare-estimates.ts <referenceRoot> <candidateRoot> <2026|2027>
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileShardLoader } from "../../src/data/file-loader";
import { StaticBenchmarkProvider } from "../../src/data/shard";
const [oldRoot, newRoot, yearArg] = process.argv.slice(2);
const year = Number(yearArg);
const households: Record<string, number[]> = { single40: [40], couple25: [25, 25], family_47_43_12: [47, 43, 12], childOnly10: [10], age64: [64], teen17: [17] };
const pairs: [string, string][] = [];
for (const f of (await readdir(join(oldRoot, String(year)))).filter(f => f !== "index.json")) {
  const s = JSON.parse(await readFile(join(oldRoot, String(year), f), "utf8"));
  for (const [zip, fips] of Object.entries<string[]>(s.zipToCounties)) for (const c of fips) pairs.push([zip, c]);
}
const a = new StaticBenchmarkProvider(new FileShardLoader(oldRoot)), b = new StaticBenchmarkProvider(new FileShardLoader(newRoot));
const tally: Record<string, Record<string, number>> = {};
let deltas = 0, calls = 0; const samples: string[] = [];
for (const [zip, countyFips] of pairs) for (const [h, ages] of Object.entries(households)) {
  const req = { planYear: year, zip, countyFips, members: ages.map(age => ({ age, seeksCoverage: true })) };
  const [x, y] = await Promise.all([a.getBenchmark(req as any), b.getBenchmark(req as any)]);
  const key = (r: any) => r.kind === "quote" ? `quote:${r.slcspPlanId}:${r.monthlySlcsp}` : `unavailable:${r.reason}`;
  calls++;
  const t = (tally[h] ??= {}); const k = x.kind === "quote" ? "quote" : "unavailable:" + (x as any).reason + ((x as any).message?.includes("dental") ? ":dental-withheld" : ""); t[k] = (t[k] ?? 0) + 1;
  if (key(x) !== key(y)) { deltas++; if (samples.length < 10) samples.push(`${zip}/${countyFips}/${h}: ${key(x)} -> ${key(y)}`); }
  if (h === "single40" && x.kind === "quote" && calls % 20000 === 1) samples.push(`sample ${zip}/${countyFips}/${h}: ${key(x)} == ${key(y)}`);
}
console.log(JSON.stringify({ year, pairs: pairs.length, calls, deltas, tally, samples }, null, 1));
if (deltas) process.exitCode = 1;
