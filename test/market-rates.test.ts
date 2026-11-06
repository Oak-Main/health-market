import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { validateShard } from "../src/data/shard";
import { marketBenchmark, validateMarket, type MarketRates } from "../src/data/market-rates";
import { parseCsvTable, readRateRows } from "../src/etl/csv";

const p1 = "11111HI0010001/1";
const p2 = "11111HI0010002/1";
const p3 = "11111HI0010003/1";
const rates = (n: number) => Array<number>(51).fill(n);
function market(): MarketRates {
  return {
    counties: { "15003": { countyName: "Honolulu", stateCode: "HI" } },
    locations: { "96813": { "15003": "a" } },
    groups: { a: { ratingAreaId: "Rating Area 1", plans: [p1, p2, p3], dental: ["d1/1", "d2/1", "d3/1"] } },
    plans: {
      [p1]: { planId: p1.split("/")[0]!, cents: rates(10000), embeddedDental: false },
      [p2]: { planId: p2.split("/")[0]!, cents: rates(10400), embeddedDental: false },
      [p3]: { planId: p3.split("/")[0]!, cents: rates(11500), embeddedDental: true },
    },
    dental: { "d1/1": { ages: Array(5).fill(700) }, "d2/1": { tiers: [1800, 3000, 3400, 4000] }, "d3/1": { ages: Array(5).fill(1100) } },
  };
}
describe("2027 silver ranking", () => {
  it("ranks adult medical EHB and retains separate equal-priced plans", () => {
    const m = market();
    expect(marketBenchmark(m, "a", [40], [])?.plan.monthly).toBe(10400);
    expect(marketBenchmark({ ...m, plans: { ...m.plans, [p2]: { ...m.plans[p2]!, cents: rates(10000) } } }, "a", [40], [])?.plan.monthly).toBe(10000);
  });
  it("adds the second dental EHB premium before ranking applicable medical plans", () => {
    const result = marketBenchmark(market(), "a", [16], [16]);
    expect(result?.plan.monthly).toBe(11500);
  });
  it("withholds a child quote when a missing dental component could change the benchmark", () => {
    const m = market();
    const incomplete = { ...m, groups: { a: { ...m.groups.a!, dental: [] } } };
    expect(marketBenchmark(incomplete, "a", [14], [14])).toBeNull();
    expect(marketBenchmark(incomplete, "a", [40], [])?.plan.monthly).toBe(10400);
  });
  it("checks geographic and plan references before serving a market", () => {
    expect(validateMarket(market(), { "96813": ["15003"] })).toEqual([]);
    expect(validateMarket(market(), { "96813": ["02020"] })).not.toEqual([]);
  });
  it("streams the historical Rate PUF with the same quoting and whitespace rules", () => {
    const source = '\ufeffPlanId,Age,Comment,IndividualRate\r\nABC,40,"a, b\n""c""",120.50\r\n';
    const keys = ["PlanId", "Age", "Comment", "IndividualRate"];
    expect([...readRateRows(source, keys)]).toEqual(parseCsvTable(source, keys).rows);
    expect([...readRateRows("CMS rate export\r\nDisplayed records,1\r\n" + source, keys)]).toEqual(parseCsvTable(source, keys).rows);
    expect(() => [...readRateRows(source, ["Missing"])]).toThrow();
  });
});

it("displays the benchmark, estimated credit and resulting premium to the cent", () => {
  const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const page = { getElementById: () => ({ addEventListener() {} }) };
  const response = { result: {
    benchmark: { monthlySlcsp: 76806 }, ptc: { monthlyPtc: 39048, fpl: {}, workings: [] },
    cliff: { workings: [] }, csr: { variant: "standard-silver" },
  } };
  const html = runInNewContext(script + "\nrenderResult(response)", { document: page, response });
  for (const value of ["$768.06", "$390.48", "$377.58"]) expect(html).toContain(value);
});

it("references the current calculator bytes from the public homepage", () => {
  const bytes = readFileSync(new URL("../public/app.js", import.meta.url));
  const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  expect(html).toContain(`<script src="/app.js?v=${revision}" type="module">`);
});

it("requires ZIP-specific pricing data in every 2027 shard", () => {
  const legacy = { planYear: 2027, generated: "", sourceFile: "CMS", sourcePublished: "", zipToCounties: {}, counties: {} };
  expect(validateShard(legacy)).toContain("Unexpected market schema for plan year");
  expect(validateShard({ ...legacy, planYear: 2026 })).toEqual([]);
});
