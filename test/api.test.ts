import { describe, expect, it } from "vitest";

import { DISCLAIMER, estimate, handleRequest, validate } from "../src/api/handler.js";
import { NullBenchmarkProvider } from "../src/core/benchmark.js";
import { UnverifiedDataError } from "../src/core/plan-years.js";
import {
  MemoryShardLoader,
  StaticBenchmarkProvider,
  validateShard,
} from "../src/data/shard.js";
import {
  marketplaceCounts,
  lookupMarketplace,
  STATE_MARKETPLACES,
  usesFederalData,
} from "../src/data/exchanges.js";
import {
  assertNotSynthetic,
  SyntheticDataInProductionError,
  syntheticShard,
} from "../src/fixtures/synthetic-shard.js";

function provider(): StaticBenchmarkProvider {
  const loader = new MemoryShardLoader();
  // Shards are keyed by the ZIP's three-digit prefix; the fixture spans three.
  loader.add("770", syntheticShard(2026));
  loader.add("775", syntheticShard(2026));
  loader.add("902", syntheticShard(2026));
  return new StaticBenchmarkProvider(loader);
}

const base = {
  planYear: 2026,
  zip: "77002",
  householdSize: 2,
  income: 80_000,
  ages: [60, 58],
};

describe("state marketplace routing", () => {
  it("covers all 50 states plus DC, exactly once each", () => {
    expect(STATE_MARKETPLACES).toHaveLength(51);
    expect(new Set(STATE_MARKETPLACES.map((m) => m.state)).size).toBe(51);
  });

  it("matches the CMS plan-year 2026 split: 28 FFM, 2 SBE-FP, 21 SBE", () => {
    // This assertion caught a real omission: the source list this was first
    // transcribed from left out Oklahoma, and 27 + 2 + 21 = 50 rather than 51.
    expect(marketplaceCounts()).toEqual({ FFM: 28, "SBE-FP": 2, SBE: 21 });
  });

  it("includes every US state postal code exactly once", () => {
    const ALL_STATES = (
      "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO " +
      "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY"
    ).split(" ");
    expect(ALL_STATES).toHaveLength(50);
    const covered = new Set(STATE_MARKETPLACES.map((m) => m.state));
    expect(ALL_STATES.filter((s) => !covered.has(s))).toEqual([]);
    expect(covered.has("DC")).toBe(true);
  });

  it("routes federal-data states to the PUFs and SBE states away from them", () => {
    expect(usesFederalData("TX")).toBe(true);
    expect(usesFederalData("AR")).toBe(true); // SBE-FP still uses the federal platform
    expect(usesFederalData("CA")).toBe(false);
    expect(usesFederalData("PA")).toBe(false);
  });

  it("routes 2027 Oregon to its own platform and Oklahoma to HealthCare.gov, preserving 2026 routing", () => {
    expect(usesFederalData("OR", 2026)).toBe(true);
    expect(usesFederalData("OR", 2027)).toBe(false);
    expect(lookupMarketplace("OR", 2027)?.url).toBe("https://explorehealthor.gov/");
    expect(lookupMarketplace("OK", 2027)).toMatchObject({ type: "SBE-FP", url: "https://www.healthcare.gov" });
    expect(usesFederalData("OK", 2027)).toBe(true);
    expect(marketplaceCounts(2027)).toEqual({ FFM: 27, "SBE-FP": 2, SBE: 22 });
  });

  it("flags states with their own premium assistance", () => {
    expect(lookupMarketplace("CA")?.hasStateSubsidy).toBe(true);
    expect(lookupMarketplace("NY")?.hasStateSubsidy).toBe(true);
    expect(lookupMarketplace("TX")?.hasStateSubsidy).toBe(false);
  });

  it("gives every entry a usable https URL", () => {
    for (const m of STATE_MARKETPLACES) {
      expect(m.url).toMatch(/^https:\/\//);
    }
  });
});

describe("shard integrity", () => {
  it("accepts a well-formed shard", () => {
    expect(validateShard(syntheticShard(2026))).toEqual([]);
  });

  it("rejects a shard whose ZIP points at a missing county", () => {
    const shard = syntheticShard(2026);
    const broken = { ...shard, zipToCounties: { ...shard.zipToCounties, "77002": ["99999"] } };
    expect(validateShard(broken).some((p) => p.includes("unknown county"))).toBe(true);
  });

  it("rejects a shard that violates the 3:1 age band", () => {
    const shard = syntheticShard(2026);
    const county = shard.counties["48201"]!;
    const broken = {
      ...shard,
      counties: {
        ...shard.counties,
        "48201": {
          ...county,
          slcspRateByAge: { ...county.slcspRateByAge, "64": county.slcspRateByAge["21"]! * 4 },
        },
      },
    };
    expect(validateShard(broken).some((p) => p.includes("3:1 age band"))).toBe(true);
  });

  it("refuses to load an invalid shard rather than serving it", () => {
    const shard = syntheticShard(2026);
    const broken = { ...shard, zipToCounties: { ...shard.zipToCounties, "77002": [] } };
    expect(() => new MemoryShardLoader().add("770", broken)).toThrow(/Refusing to load/);
  });
});

describe("synthetic-data guard", () => {
  it("blocks the fixture from a production bootstrap", () => {
    expect(() => assertNotSynthetic(syntheticShard(2026))).toThrow(
      SyntheticDataInProductionError,
    );
  });

  it("allows a real shard through", () => {
    expect(() => assertNotSynthetic({ sourceFile: "rate-puf-2026.csv" })).not.toThrow();
  });

  it("leaks the SYNTHETIC marker into the API response provenance", async () => {
    const response = await estimate(validate(base), provider());
    expect(JSON.stringify(response.provenance)).toContain("SYNTHETIC");
  });
});

describe("request validation", () => {
  it("accepts a well-formed request", () => {
    expect(() => validate(base)).not.toThrow();
  });

  it("rejects an unsupported plan year", () => {
    expect(() => validate({ ...base, planYear: 2019 })).toThrow(/planYear/);
  });

  it("rejects a malformed ZIP", () => {
    expect(() => validate({ ...base, zip: "770" })).toThrow(/zip/);
    expect(() => validate({ ...base, zip: "abcde" })).toThrow(/zip/);
  });

  it("rejects more applicants than household members", () => {
    expect(() => validate({ ...base, householdSize: 1, ages: [40, 38] })).toThrow(/ages/);
  });

  it("rejects negative income and absurd ages", () => {
    expect(() => validate({ ...base, income: -1 })).toThrow(/income/);
    expect(() => validate({ ...base, ages: [200] })).toThrow(/ages/);
  });

  it("collects every problem rather than stopping at the first", () => {
    try {
      validate({ planYear: 1999, zip: "x", householdSize: 0, income: -5, ages: [] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { problems: unknown[] }).problems.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("estimate", () => {
  it("returns a full result with workings and provenance", async () => {
    const response = await estimate(validate(base), provider());
    expect(response.ok).toBe(true);

    const result = response.result as Record<string, any>;
    expect(result["ptc"].annualPtc).toBeGreaterThan(0);
    expect(result["ptc"].workings.length).toBeGreaterThan(3);
    expect(result["cliff"].cliffIncome).toBe(8_460_000); // 4 x $21,150 (2025 FPL, 2-person)
    expect(result["benchmark"].monthlySlcsp).toBeGreaterThan(0);
    expect(response.disclaimer).toBe(DISCLAIMER);
  });

  it("reports the ambiguous-ZIP case instead of guessing a county", async () => {
    const response = await estimate(validate({ ...base, zip: "77532" }), provider());
    expect(response.ok).toBe(false);
    const unavailable = response.unavailable as Record<string, any>;
    expect(unavailable["reason"]).toBe("ambiguous-zip");
    expect(unavailable["candidateCounties"]).toHaveLength(2);
  });

  it("resolves an ambiguous ZIP once a county is supplied", async () => {
    const response = await estimate(
      validate({ ...base, zip: "77532", countyFips: "48291" }),
      provider(),
    );
    expect(response.ok).toBe(true);
    expect((response.result as any).location.countyFips).toBe("48291");
  });

  it("routes a state-based-exchange ZIP to the state marketplace", async () => {
    const response = await estimate(validate({ ...base, zip: "90210" }), provider());
    expect(response.ok).toBe(false);
    const unavailable = response.unavailable as Record<string, any>;
    expect(unavailable["reason"]).toBe("state-based-exchange");
    expect(unavailable["exchangeUrl"]).toBe("https://www.coveredca.com");
    expect(unavailable["message"]).toMatch(/premium assistance/);
  });

  it("reports a missing local PY2027 benchmark without making a CMS publication claim", async () => {
    // No PY2027 shard is installed in this test provider.
    const response = await estimate(validate({ ...base, planYear: 2027 }), provider());
    expect(response.ok).toBe(false);
    expect((response.unavailable as any).reason).toBe("dataset-not-loaded");
  });

  it("never invents a premium when no dataset is loaded", async () => {
    const response = await estimate(validate(base), new NullBenchmarkProvider());
    expect(response.ok).toBe(false);
    expect((response.unavailable as any).reason).toBe("dataset-not-loaded");
    expect(response.result).toBeUndefined();
  });

  it("includes the curve only when asked", async () => {
    const without = await estimate(validate(base), provider());
    expect((without.result as any).curve).toBeUndefined();

    const withCurve = await estimate(validate({ ...base, includeCurve: true }), provider());
    expect((withCurve.result as any).curve.length).toBeGreaterThan(50);
  });

  it("evaluates employer coverage when supplied", async () => {
    const response = await estimate(
      validate({
        ...base,
        employerCoverage: { employeeMonthlyContribution: 100, providesMinimumValue: true },
      }),
      provider(),
    );
    const affordability = (response.result as any).affordability;
    expect(affordability.isAffordable).toBe(true);
    expect(affordability.barsFromPtc).toBe(true);
    expect(affordability.thresholdPercentage).toBe(996); // 9.96% for PY2026
  });
});

it("refuses a county from another ZIP in the same shard", async () => {
  const result = await estimate(validate({ ...base, countyFips: "06037" }), provider());
  expect(result.ok).toBe(false);
  expect(result.unavailable).toMatchObject({ reason: "unknown-zip" });
});

describe("staleness gate", () => {
  function providerWithBuildDate(generated: string): StaticBenchmarkProvider {
    const loader = new MemoryShardLoader();
    loader.add("770", { ...syntheticShard(2026), generated, sourcePublished: "2026-08-04" });
    return new StaticBenchmarkProvider(loader);
  }

  it("refuses a shard built more than 21 days ago rather than serving it silently", async () => {
    const stale = providerWithBuildDate("2020-01-01");
    await expect(estimate(validate(base), stale)).rejects.toThrow(UnverifiedDataError);
    await expect(estimate(validate(base), stale)).rejects.toThrow(/staleness threshold/);
  });

  it("refuses invalid and future build dates", async () => {
    for (const date of ["invalid", "2099-01-01"]) {
      await expect(estimate(validate(base), providerWithBuildDate(date))).rejects.toThrow(UnverifiedDataError);
    }
  });

  it("serves a shard built within the last 21 days", async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await estimate(validate(base), providerWithBuildDate(recent));
    expect(response.ok).toBe(true);
  });

  it("surfaces the staleness rejection as a 503 through the HTTP adapter, not a 500", async () => {
    const stale = providerWithBuildDate("2020-01-01");
    const response = await handleRequest(
      new Request("https://example.test/api/estimate", {
        method: "POST",
        body: JSON.stringify(base),
      }),
      stale,
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("data_unverified");
  });
});

describe("HTTP adapter", () => {
  const call = (path: string, init?: RequestInit): Promise<Response> =>
    handleRequest(new Request(`https://example.test${path}`, init), provider());

  it("serves a health check", async () => {
    const response = await call("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it("handles POST", async () => {
    const response = await call("/api/estimate", {
      method: "POST",
      body: JSON.stringify(base),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("handles GET with query parameters", async () => {
    const response = await call(
      "/api/estimate?planYear=2026&zip=77002&householdSize=2&income=80000&ages=60,58",
    );
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it("returns 400 on validation failure with the specific problems", async () => {
    const response = await call("/api/estimate", {
      method: "POST",
      body: JSON.stringify({ ...base, zip: "nope" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("validation_failed");
    expect(body.problems[0].field).toBe("zip");
  });

  it("returns 400 on malformed JSON", async () => {
    const response = await call("/api/estimate", { method: "POST", body: "{oops" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid_json");
  });

  it("returns 422 when data is unavailable, not 200 with a fake number", async () => {
    const response = await call("/api/estimate", {
      method: "POST",
      body: JSON.stringify({ ...base, planYear: 2027 }),
    });
    expect(response.status).toBe(422);
  });

  it("returns 405 for unsupported methods and 404 for unknown paths", async () => {
    expect((await call("/api/estimate", { method: "DELETE" })).status).toBe(405);
    expect((await call("/api/nope")).status).toBe(404);
  });

  it("sets no-store and anti-sniffing headers", async () => {
    const response = await call("/api/health");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("health check freshness", () => {
  it("reports dataStale=true and no timestamp when no dataset has been built at all", async () => {
    const response = await handleRequest(
      new Request("https://example.test/api/health"),
      provider(), // built by the top-level provider() helper, which never calls setIndex()
    );
    const body = await response.json();
    expect(body.dataGenerated).toBeNull();
    expect(body.dataAgeDays).toBeNull();
    expect(body.dataStale).toBe(true);
  });

  it("reports dataStale=false with an age in days for a freshly-built dataset", async () => {
    const loader = new MemoryShardLoader();
    loader.add("770", syntheticShard(2026));
    const generated = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    loader.setIndex(2026, {
      planYear: 2026,
      generated,
      shardCount: 1,
      countiesBuilt: 3,
      countiesSkipped: 0,
      prefixes: ["770"],
    });

    const response = await handleRequest(
      new Request("https://example.test/api/health"),
      new StaticBenchmarkProvider(loader),
    );
    const body = await response.json();
    expect(body.dataGenerated).toBe(generated);
    expect(body.dataAgeDays).toBe(2);
    expect(body.dataStale).toBe(false);
  });

  it("reports dataStale=true once the built dataset exceeds the staleness threshold", async () => {
    const loader = new MemoryShardLoader();
    loader.add("770", syntheticShard(2026));
    loader.setIndex(2026, {
      planYear: 2026,
      generated: "2020-01-01T00:00:00.000Z",
      shardCount: 1,
      countiesBuilt: 3,
      countiesSkipped: 0,
      prefixes: ["770"],
    });

    const response = await handleRequest(
      new Request("https://example.test/api/health"),
      new StaticBenchmarkProvider(loader),
    );
    const body = await response.json();
    expect(body.dataStale).toBe(true);
    expect(body.dataAgeDays).toBeGreaterThan(21);
  });
});
