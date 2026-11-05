/**
 * SYNTHETIC BENCHMARK DATA — NOT REAL CMS PREMIUMS.
 *
 * This fixture exists so the API, the dev server and the integration tests can
 * run end to end without network access. Every premium in it is invented.
 *
 * It is deliberately loud about that: `sourceFile` is a shouting sentinel that
 * flows through the API response and into the UI's provenance line, so if this
 * ever reaches production the string "SYNTHETIC" appears on the page rather
 * than a plausible-looking file name. `assertNotSynthetic()` is the guard to
 * call in any production bootstrap.
 *
 * Real data comes from `npm run etl`, run somewhere with access to CMS.
 */

import type { AgeRateTable, BenchmarkShard, CountyBenchmark } from "../data/shard";

export const SYNTHETIC_SOURCE = "SYNTHETIC-FIXTURE — NOT REAL CMS DATA";

/**
 * Build an age-rate table from a 21-year-old base rate using the federal
 * default standard age curve's shape. Approximated between verified anchor
 * points — fine for a fixture, never acceptable for real output.
 */
function syntheticAgeTable(baseAt21Cents: number): AgeRateTable {
  const anchors: [number, number][] = [
    [14, 0.765],
    [21, 1.0],
    [40, 1.278],
    [50, 1.786],
    [55, 2.23],
    [64, 3.0],
  ];
  const table: Record<string, number> = {};
  for (let age = 14; age <= 64; age += 1) {
    let factor = 1;
    for (let i = 0; i < anchors.length - 1; i += 1) {
      const [a0, f0] = anchors[i]!;
      const [a1, f1] = anchors[i + 1]!;
      if (age >= a0 && age <= a1) {
        factor = f0 + ((f1 - f0) * (age - a0)) / (a1 - a0);
        break;
      }
    }
    if (age <= 14) factor = 0.765;
    if (age >= 64) factor = 3.0;
    table[String(age)] = Math.round(baseAt21Cents * factor);
  }
  return table;
}

function county(
  countyFips: string,
  countyName: string,
  stateCode: string,
  ratingAreaId: string,
  silverBaseAt21: number,
  bronzeBaseAt21: number,
): CountyBenchmark {
  return {
    countyFips,
    countyName,
    stateCode,
    ratingAreaId,
    slcspPlanId: `SYNTH-${countyFips}-SILVER-02`,
    slcspRateByAge: syntheticAgeTable(silverBaseAt21),
    lcbpPlanId: `SYNTH-${countyFips}-BRONZE-01`,
    lcbpRateByAge: syntheticAgeTable(bronzeBaseAt21),
    silverPlanCount: 6,
  };
}

/** Harris County, TX (FFM state) and a multi-county ZIP for the ambiguity path. */
export function syntheticShard(planYear: number): BenchmarkShard {
  return {
    planYear,
    generated: new Date().toISOString(),
    sourceFile: SYNTHETIC_SOURCE,
    // Deliberately "yesterday" rather than a fixed date: this fixture backs
    // both the API's staleness gate tests and unrelated tests that just need
    // a working shard, and a fixed date would eventually go stale on its own
    // and start failing tests that have nothing to do with staleness. The
    // SYNTHETIC sourceFile above is what actually flags this as fake data —
    // this date only needs to be recent, not meaningful.
    sourcePublished: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    zipToCounties: {
      // Single-county ZIP, federally-facilitated state.
      "77002": ["48201"],
      // Multi-county ZIP: must trigger the ambiguous-zip path.
      "77532": ["48201", "48291"],
      // State-based exchange ZIP: must route to Covered California.
      "90210": ["06037"],
    },
    counties: {
      "48201": county("48201", "Harris", "TX", "Rating Area 7", 42_000, 31_000),
      "48291": county("48291", "Liberty", "TX", "Rating Area 7", 44_500, 33_000),
      "06037": county("06037", "Los Angeles", "CA", "Rating Area 15", 46_000, 35_000),
    },
  };
}

export class SyntheticDataInProductionError extends Error {
  constructor() {
    super(
      "Refusing to start: the loaded benchmark dataset is the synthetic " +
        "fixture, which contains invented premiums. Run `npm run etl` from an " +
        "environment with network access to CMS and deploy the generated shards.",
    );
    this.name = "SyntheticDataInProductionError";
  }
}

/** Call this in any production bootstrap path. */
export function assertNotSynthetic(shard: Pick<BenchmarkShard, "sourceFile">): void {
  if (shard.sourceFile.includes("SYNTHETIC")) throw new SyntheticDataInProductionError();
}
