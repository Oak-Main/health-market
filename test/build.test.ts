import { describe, expect, it } from "vitest";

import {
  buildShards,
  checkCompositionInvariance,
  buildPlanRates,
  indexPlanAttributes,
  normalizeGeographicCode,
  type CountyInput,
  type CsvRow,
} from "../src/etl/build.js";
import { parseCsv, parseCsvTable, parseMoneyToCents, parseRatePufAge, CsvError } from "../src/etl/csv.js";
import { xlsxToCsv } from "../src/etl/sources.js";
import { validateShard } from "../src/data/shard.js";
import type { MetalLevel, NormalisedPlanRate } from "../src/etl/slcsp.js";

it("normalizes geographic codes without admitting a blank, malformed or all-zero ZIP or county", () => {
  for (const raw of ["", "  ", "0", "00000", "0xy45", "123456"]) expect(normalizeGeographicCode(raw)).toBeNull();
  expect(normalizeGeographicCode(" 1234 ")).toBe("01234");
});

it("keeps the next CMS cell and next row when styled empty cells or rows are self-closing", () => {
  const xml = '<worksheet><row r="1"/><row r="2"><c r="A2"/><c r="B2" s="3"/><c r="C2"><v>77</v></c></row></worksheet>';
  expect(xlsxToCsv({ "xl/worksheets/sheet1.xml": new TextEncoder().encode(xml) }, "fixture")).toBe("\r\n,,77\r\n");
});

const USD = (d: number): number => Math.round(d * 100);

/** Uniform-age-curve plan: every plan scales identically with age. */
function uniformPlan(
  planId: string,
  metalLevel: MetalLevel,
  baseAt21: number,
): NormalisedPlanRate {
  const rateByAge = new Map<number, number>();
  for (let age = 14; age <= 64; age += 1) {
    // Shared curve: factor depends only on age, never on the plan.
    const factor = 1 + (age - 21) * 0.04;
    rateByAge.set(age, Math.round(USD(baseAt21) * factor));
  }
  return {
    planId,
    metalLevel,
    ratingAreaId: "Rating Area 1",
    stateCode: "TX",
    rateByAge,
    onExchange: true,
  };
}

/** A plan that illegally uses its own age curve — the invariance breaker. */
function rogueCurvePlan(planId: string, baseAt21: number): NormalisedPlanRate {
  const rateByAge = new Map<number, number>();
  for (let age = 14; age <= 64; age += 1) {
    const factor = 1 + (age - 21) * 0.001; // almost flat
    rateByAge.set(age, Math.round(USD(baseAt21) * factor));
  }
  return {
    planId,
    metalLevel: "Silver",
    ratingAreaId: "Rating Area 1",
    stateCode: "TX",
    rateByAge,
    onExchange: true,
  };
}

describe("CSV parsing", () => {
  it("handles quoted fields containing commas and newlines", () => {
    const rows = parseCsv('a,b\n"one, two","line1\nline2"\n');
    expect(rows[1]).toEqual(["one, two", "line1\nline2"]);
  });

  it("handles doubled quotes", () => {
    expect(parseCsv('a\n"He said ""hi"""\n')[1]).toEqual(['He said "hi"']);
  });

  it("strips a UTF-8 BOM", () => {
    const table = parseCsvTable("﻿PlanId,Age\nX,21\n", ["PlanId"]);
    expect(table.header[0]).toBe("PlanId");
  });

  it("throws when a required column is missing, rather than yielding undefined", () => {
    // Silent column drift is the failure mode that produces plausible-but-wrong
    // premiums, so this must be loud.
    expect(() => parseCsvTable("PlanId,Age\nX,21\n", ["PlanId", "IndividualRate"])).toThrow(
      CsvError,
    );
  });

  it("parses CMS money strings, distinguishing blank from zero", () => {
    expect(parseMoneyToCents("$1,234.56")).toBe(123_456);
    expect(parseMoneyToCents("410.5")).toBe(41_050);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("n/a")).toBeNull();
    expect(parseMoneyToCents("0")).toBe(0);
  });

  it("parses Rate PUF age labels", () => {
    expect(parseRatePufAge("0-14")).toBe(14);
    expect(parseRatePufAge("64 and over")).toBe(64);
    expect(parseRatePufAge("37")).toBe(37);
    expect(parseRatePufAge("Family Option")).toBeNull();
  });
});

describe("plan attribute indexing", () => {
  const rows: CsvRow[] = [
    {
      BusinessYear: "2026",
      StateCode: "TX",
      StandardComponentId: "P-SILVER",
      MetalLevel: "Silver",
      MarketCoverage: "Individual",
      DentalOnlyPlan: "No",
      ServiceAreaId: "TXS001",
    },
    {
      BusinessYear: "2026",
      StateCode: "TX",
      StandardComponentId: "P-DENTAL",
      MetalLevel: "Silver",
      MarketCoverage: "Individual",
      DentalOnlyPlan: "Yes",
      ServiceAreaId: "TXS001",
    },
    {
      BusinessYear: "2026",
      StateCode: "TX",
      StandardComponentId: "P-SHOP",
      MetalLevel: "Gold",
      MarketCoverage: "SHOP (Small Group)",
      DentalOnlyPlan: "No",
      ServiceAreaId: "TXS001",
    },
  ];

  it("keeps individual medical plans only", () => {
    const index = indexPlanAttributes(rows);
    expect([...index.keys()]).toEqual(["P-SILVER"]);
  });

  it("normalises metal levels including Expanded Bronze", () => {
    const index = indexPlanAttributes([
      { ...rows[0]!, StandardComponentId: "EB", MetalLevel: "Expanded Bronze" },
    ]);
    expect(index.get("EB")?.metalLevel).toBe("Expanded Bronze");
  });
});

describe("rate folding", () => {
  const attributes = indexPlanAttributes([
    {
      BusinessYear: "2026",
      StateCode: "TX",
      StandardComponentId: "P1",
      MetalLevel: "Silver",
      MarketCoverage: "Individual",
      DentalOnlyPlan: "No",
      ServiceAreaId: "TXS001",
    },
  ]);

  it("skips Family Option rows and other plan years", () => {
    const rates = buildPlanRates(
      [
        { BusinessYear: "2026", PlanId: "P1", RatingAreaId: "Rating Area 1", Age: "21", IndividualRate: "300" },
        { BusinessYear: "2026", PlanId: "P1", RatingAreaId: "Rating Area 1", Age: "Family Option", IndividualRate: "900" },
        { BusinessYear: "2025", PlanId: "P1", RatingAreaId: "Rating Area 1", Age: "22", IndividualRate: "310" },
      ],
      attributes,
      2026,
    );
    const plan = rates.get("P1|Rating Area 1")!;
    expect([...plan.rateByAge.keys()]).toEqual([21]);
    expect(plan.rateByAge.get(21)).toBe(USD(300));
  });

  it("keys separate rating areas separately", () => {
    const rates = buildPlanRates(
      [
        { BusinessYear: "2026", PlanId: "P1", RatingAreaId: "Rating Area 1", Age: "21", IndividualRate: "300" },
        { BusinessYear: "2026", PlanId: "P1", RatingAreaId: "Rating Area 2", Age: "21", IndividualRate: "350" },
      ],
      attributes,
      2026,
    );
    expect(rates.size).toBe(2);
    expect(rates.get("P1|Rating Area 2")!.rateByAge.get(21)).toBe(USD(350));
  });

  it("ignores plans with no attribute record", () => {
    const rates = buildPlanRates(
      [{ BusinessYear: "2026", PlanId: "UNKNOWN", RatingAreaId: "Rating Area 1", Age: "21", IndividualRate: "300" }],
      attributes,
      2026,
    );
    expect(rates.size).toBe(0);
  });
});

describe("composition invariance", () => {
  it("holds when every plan shares the state age curve", () => {
    const plans = [
      uniformPlan("S1", "Silver", 300),
      uniformPlan("S2", "Silver", 400),
      uniformPlan("S3", "Silver", 500),
    ];
    expect(checkCompositionInvariance(plans)).toBeNull();
  });

  it("detects a plan that uses its own curve", () => {
    // The rogue plan is cheapest at 21 but relatively cheaper still at 64,
    // so the second-lowest silver plan changes with age.
    const plans = [
      uniformPlan("S1", "Silver", 300),
      rogueCurvePlan("ROGUE", 310),
      uniformPlan("S3", "Silver", 500),
    ];
    const failure = checkCompositionInvariance(plans);
    expect(failure).not.toBeNull();
    expect(failure!.probe).toBeTruthy();
  });
});

describe("buildShards", () => {
  const options = {
    planYear: 2026,
    sourceFile: "rate-puf-2026.csv",
    sourcePublished: "2025-10-15",
    generated: "2026-07-27T00:00:00.000Z",
    zipToCounties: { "77002": ["48201"], "77532": ["48201", "48291"] },
  };

  const good: CountyInput = {
    countyFips: "48201",
    countyName: "Harris",
    stateCode: "TX",
    ratingAreaId: "Rating Area 7",
    plans: [
      uniformPlan("S1", "Silver", 300),
      uniformPlan("S2", "Silver", 400),
      uniformPlan("B1", "Bronze", 220),
    ],
  };

  it("emits a valid shard with the second-lowest silver plan", () => {
    const outcome = buildShards([good], options);
    const shard = outcome.shards.get("770")!;
    expect(validateShard(shard)).toEqual([]);
    expect(shard.counties["48201"]!.slcspPlanId).toBe("S2");
    expect(shard.counties["48201"]!.lcbpPlanId).toBe("B1");
    expect(outcome.countiesBuilt).toBe(1);
  });

  it("groups ZIPs into three-digit prefix shards", () => {
    const outcome = buildShards([good], options);
    expect([...outcome.shards.keys()].sort()).toEqual(["770", "775"]);
  });

  it("drops references to counties that were skipped", () => {
    // 48291 is never built, so ZIP 77532 must reference only 48201.
    const outcome = buildShards([good], options);
    expect(outcome.shards.get("775")!.zipToCounties["77532"]).toEqual(["48201"]);
  });

  it("SKIPS a county whose benchmark depends on composition, with a warning", () => {
    const rogue: CountyInput = {
      ...good,
      countyFips: "48999",
      plans: [
        uniformPlan("S1", "Silver", 300),
        rogueCurvePlan("ROGUE", 310),
        uniformPlan("S3", "Silver", 500),
      ],
    };
    const outcome = buildShards([rogue], { ...options, zipToCounties: { "99999": ["48999"] } });
    expect(outcome.countiesBuilt).toBe(0);
    expect(outcome.shards.size).toBe(0);
    expect(outcome.warnings[0]).toMatch(/SKIPPED 48999/);
    expect(outcome.warnings[0]).toMatch(/composition/);
  });

  it("SKIPS a county with no silver plan rather than substituting a metal", () => {
    const noSilver: CountyInput = {
      ...good,
      countyFips: "48888",
      plans: [uniformPlan("B1", "Bronze", 220), uniformPlan("G1", "Gold", 600)],
    };
    const outcome = buildShards([noSilver], { ...options, zipToCounties: { "88888": ["48888"] } });
    expect(outcome.countiesBuilt).toBe(0);
    expect(outcome.warnings[0]).toMatch(/no on-exchange silver plan/);
  });

  it("produces shards that pass independent integrity validation", () => {
    const outcome = buildShards([good], options);
    for (const shard of outcome.shards.values()) {
      expect(validateShard(shard)).toEqual([]);
    }
  });
});
