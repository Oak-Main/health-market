import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/api/handler";
import { NullBenchmarkProvider } from "../src/core/benchmark";
import { AssetShardLoader } from "../src/data/file-loader";
import { determineCsr } from "../src/core/csr";

const endpoint = "https://example.test/api/income-check";
const base = { planYear: 2027, region: "alaska", householdSize: 1, income: 79800 };
async function check(overrides = {}) {
  return handleRequest(new Request(endpoint, { method: "POST", body: JSON.stringify({ ...base, ...overrides }) }), new NullBenchmarkProvider());
}

describe("income checks without a ZIP premium", () => {
  it("returns a verified range and contribution independently of benchmark data", async () => {
    const response = await check();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ incomeStatus: "within", minimumIncome: 1995000, maximumIncome: 7980000,
      annualRequiredContribution: 815556, applicablePercentage: 1022, estimatedMonthlyBenchmarkCredit: null });
  });
  it("labels the user-supplied premium and respects the cliff to the cent", async () => {
    const inputs = { region: "hawaii", monthlyBenchmark: 1000 };
    const at = await (await check({ ...inputs, income: 73440 })).json();
    expect(at).toMatchObject({ incomeStatus: "within", annualRequiredContribution: 750557,
      suppliedMonthlyBenchmark: 100000, estimatedMonthlyBenchmarkCredit: 37454 });
    const above = await (await check({ ...inputs, income: 73440.01 })).json();
    expect(above).toMatchObject({ incomeStatus: "above", estimatedMonthlyBenchmarkCredit: 0 });
  });
  it("rejects invalid locations, fractions of a cent, and empty numeric inputs", async () => {
    for (const inputs of [{ region: "" }, { region: "PR" }, { income: "" }, { householdSize: 0 },
      { income: 79800.001 }, { monthlyBenchmark: 0 }, { monthlyBenchmark: 0.001 }, { planYear: 2030 }]) {
      expect((await check(inputs)).status).toBe(400);
    }
  });
  it("treats a Cloudflare HTML fallback as a missing shard or index", async () => {
    const loader = new AssetShardLoader({ fetch: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html; charset=utf-8" } }) });
    expect(await loader.load(2027, "968")).toBeNull();
    expect(await loader.loadIndex(2027)).toBeNull();
  });
  it("keeps malformed JSON and upstream faults visible", async () => {
    const badJson = new AssetShardLoader({ fetch: async () => new Response("invalid", { headers: { "content-type": "application/json" } }) });
    await expect(badJson.load(2027, "995")).rejects.toThrow();
    const failed = new AssetShardLoader({ fetch: async () => new Response("failure", { status: 502 }) });
    await expect(failed.loadIndex(2027)).rejects.toThrow(/502/);
  });
  it("uses exact income for cost-sharing cutoffs independent of tax-form truncation", () => {
    for (const [percent, variant] of [[150.001, "csr-87"], [200.001, "csr-73"], [250.001, "standard-silver"]] as const) {
      expect(determineCsr(percent, true).variant).toBe(variant);
    }
  });
});
