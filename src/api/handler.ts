/**
 * The estimate API.
 *
 * Transport-agnostic: `estimate()` is a pure async function over a validated
 * request. `handleRequest()` adapts it to the WHATWG Request/Response pair
 * used by both Cloudflare Pages Functions and Node's built-in server.
 *
 * PRIVACY POSTURE
 * ---------------
 * Nothing here persists anything. No identifiers, no logging of inputs, no
 * cookies. The compliance memo's recommendation was to collect zero PII so
 * that 45 CFR 155.260 never attaches and no state data-broker regime applies;
 * this module is where that promise is kept. The same math also runs
 * client-side, so the API is an optimisation, not a requirement.
 */

import { assessAffordability } from "../core/affordability";
import { type BenchmarkProvider, isQuote } from "../core/benchmark";
import { analyzeCliff, buildPtcCurve } from "../core/cliff";
import { determineCsr } from "../core/csr";
import {
  getPlanYear,
  SUPPORTED_PLAN_YEARS,
  UnsupportedPlanYearError,
  UnverifiedDataError,
} from "../core/plan-years";
import { cliffIncomeFor, computeFpl } from "../core/fpl";
import { computePtc, monthlyFromAnnual, requiredContributionAt } from "../core/ptc";
import { regionForState } from "../data/shard";
import type { Cents, Household, HouseholdMember, PlanYear } from "../core/types";

export interface EstimateRequest {
  readonly planYear: PlanYear;
  readonly zip: string;
  readonly countyFips?: string;
  /** Tax-household size for FPL purposes. */
  readonly householdSize: number;
  /** Annual modified adjusted gross income, in dollars. */
  readonly income: number;
  /** Ages of people seeking coverage. */
  readonly ages: readonly number[];
  /** Optional employer-coverage test. */
  readonly employerCoverage?: {
    readonly employeeMonthlyContribution: number;
    readonly providesMinimumValue: boolean;
  };
  /** Include the income/credit curve for charting. Off by default (payload size). */
  readonly includeCurve?: boolean;
}

export interface ValidationProblem {
  readonly field: string;
  readonly message: string;
}

export class RequestValidationError extends Error {
  constructor(readonly problems: readonly ValidationProblem[]) {
    super(`Invalid request: ${problems.map((p) => `${p.field} — ${p.message}`).join("; ")}`);
    this.name = "RequestValidationError";
  }
}

const MAX_HOUSEHOLD = 20;
const MAX_INCOME = 100_000_000;

/**
 * A benchmark shard older than this is treated as stale rather than trusted.
 * The refresh cron runs weekly (7 days); this allows for two missed runs
 * before refusing to serve the number, rather than serving an arbitrarily
 * old snapshot with full confidence forever.
 */
const STALE_AFTER_DAYS = 21;

export function validate(input: unknown): EstimateRequest {
  const problems: ValidationProblem[] = [];
  const raw = (input ?? {}) as Record<string, unknown>;

  const planYear = Number(raw["planYear"]);
  if (!SUPPORTED_PLAN_YEARS.includes(planYear)) {
    problems.push({
      field: "planYear",
      message: `must be one of ${SUPPORTED_PLAN_YEARS.join(", ")}`,
    });
  }

  const zip = String(raw["zip"] ?? "").trim();
  if (!/^\d{5}$/.test(zip)) {
    problems.push({ field: "zip", message: "must be a five-digit ZIP code" });
  }

  const householdSize = Number(raw["householdSize"]);
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > MAX_HOUSEHOLD) {
    problems.push({
      field: "householdSize",
      message: `must be an integer between 1 and ${MAX_HOUSEHOLD}`,
    });
  }

  const income = Number(raw["income"]);
  if (!Number.isFinite(income) || income < 0 || income > MAX_INCOME) {
    problems.push({
      field: "income",
      message: `must be a number between 0 and ${MAX_INCOME}`,
    });
  }

  const agesRaw = raw["ages"];
  const ages = Array.isArray(agesRaw) ? agesRaw.map(Number) : [];
  if (ages.length === 0) {
    problems.push({ field: "ages", message: "at least one age is required" });
  } else if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 120)) {
    problems.push({ field: "ages", message: "each age must be an integer from 0 to 120" });
  } else if (ages.length > MAX_HOUSEHOLD) {
    problems.push({ field: "ages", message: `at most ${MAX_HOUSEHOLD} people` });
  }

  if (
    Number.isInteger(householdSize) &&
    ages.length > 0 &&
    ages.length > householdSize
  ) {
    problems.push({
      field: "ages",
      message: "more people are seeking coverage than there are in the household",
    });
  }

  const countyFipsRaw = raw["countyFips"];
  let countyFips: string | undefined;
  if (countyFipsRaw !== undefined && countyFipsRaw !== null && countyFipsRaw !== "") {
    countyFips = String(countyFipsRaw).trim();
    if (!/^\d{5}$/.test(countyFips)) {
      problems.push({ field: "countyFips", message: "must be a five-digit FIPS code" });
    }
  }

  let employerCoverage: EstimateRequest["employerCoverage"];
  const ec = raw["employerCoverage"] as Record<string, unknown> | undefined;
  if (ec) {
    const contribution = Number(ec["employeeMonthlyContribution"]);
    if (!Number.isFinite(contribution) || contribution < 0) {
      problems.push({
        field: "employerCoverage.employeeMonthlyContribution",
        message: "must be a non-negative number",
      });
    } else {
      employerCoverage = {
        employeeMonthlyContribution: contribution,
        providesMinimumValue: Boolean(ec["providesMinimumValue"]),
      };
    }
  }

  if (problems.length > 0) throw new RequestValidationError(problems);

  return {
    planYear,
    zip,
    householdSize,
    income,
    ages,
    includeCurve: Boolean(raw["includeCurve"]),
    ...(countyFips ? { countyFips } : {}),
    ...(employerCoverage ? { employerCoverage } : {}),
  };
}

const toCents = (dollars: number): Cents => Math.round(dollars * 100);

export interface EstimateResponse {
  readonly ok: boolean;
  readonly planYear: PlanYear;
  readonly asOf: string;
  readonly result?: unknown;
  readonly unavailable?: unknown;
  readonly provenance: unknown;
  readonly disclaimer: string;
}

export const DISCLAIMER =
  "This website is not the Health Insurance Marketplace website and is not " +
  "affiliated with the U.S. government. It provides estimates only and may not " +
  "display all Qualified Health Plans offered in your state. Only the " +
  "Marketplace can determine your eligibility. To see all available plans and " +
  "to enroll, go to HealthCare.gov or your state's Marketplace.";

export async function estimate(
  request: EstimateRequest,
  provider: BenchmarkProvider,
): Promise<EstimateResponse> {
  const params = getPlanYear(request.planYear);
  const asOf = new Date().toISOString();

  const members: HouseholdMember[] = request.ages.map((age) => ({
    age,
    seeksCoverage: true,
  }));

  const benchmark = await provider.getBenchmark({
    planYear: request.planYear,
    zip: request.zip,
    ...(request.countyFips ? { countyFips: request.countyFips } : {}),
    members,
  });

  const provenance = {
    applicablePercentageTable: params.applicablePercentageTable.provenance,
    povertyGuidelines: params.povertyGuidelines.provenance,
    enhancedCreditsActive: params.enhancedCreditsActive,
    openEnrollment: params.openEnrollment,
    benchmarkProvider: provider.name,
    ...(isQuote(benchmark)
      ? { benchmarkSource: benchmark.sourceFile, benchmarkPublished: benchmark.sourcePublished }
      : {}),
  };

  if (!isQuote(benchmark)) {
    return {
      ok: false,
      planYear: request.planYear,
      asOf,
      unavailable: benchmark,
      provenance,
      disclaimer: DISCLAIMER,
    };
  }

  const ageDays = (Date.now() - Date.parse(benchmark.generated)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    throw new UnverifiedDataError("The benchmark has an invalid refresh date.");
  }
  if (ageDays > STALE_AFTER_DAYS) {
    throw new UnverifiedDataError(
      `Benchmark data for this region was last built ${benchmark.generated} ` +
        `(${Math.floor(ageDays)} days ago), exceeding the ${STALE_AFTER_DAYS}-day ` +
        `staleness threshold. The weekly refresh pipeline may be broken — see /api/health.`,
    );
  }

  const household: Household = {
    size: request.householdSize,
    members,
    annualIncome: toCents(request.income),
    region: benchmark.region,
  };

  const annualBenchmark = benchmark.monthlySlcsp * 12;

  const ptc = computePtc(params, household, annualBenchmark);
  const cliff = analyzeCliff(params, household, annualBenchmark);
  const csr = determineCsr(ptc.fpl.exactRatio * 100, true);

  const affordability = request.employerCoverage
    ? assessAffordability(params, {
        annualIncome: household.annualIncome,
        employeeAnnualContribution: toCents(
          request.employerCoverage.employeeMonthlyContribution * 12,
        ),
        providesMinimumValue: request.employerCoverage.providesMinimumValue,
      })
    : null;

  const curve = request.includeCurve
    ? buildPtcCurve(params, household, annualBenchmark)
    : undefined;

  return {
    ok: true,
    planYear: request.planYear,
    asOf,
    result: {
      location: {
        zip: request.zip,
        countyFips: benchmark.countyFips,
        ratingAreaId: benchmark.ratingAreaId,
        region: benchmark.region,
      },
      benchmark: {
        monthlySlcsp: benchmark.monthlySlcsp,
        annualSlcsp: annualBenchmark,
        monthlyLcbp: benchmark.monthlyLcbp,
        slcspPlanId: benchmark.slcspPlanId,
      },
      ptc,
      cliff,
      csr,
      affordability,
      ...(curve ? { curve } : {}),
    },
    provenance,
    disclaimer: DISCLAIMER,
  };
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

/** Income and contribution are computable without a local benchmark premium. */
async function incomeCheck(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const { planYear, region, householdSize, income, monthlyBenchmark } = (input ?? {}) as Record<string, unknown>;
  if (typeof planYear !== "number" || !SUPPORTED_PLAN_YEARS.includes(planYear) ||
      (region !== "alaska" && region !== "hawaii" && region !== "contiguous") ||
      typeof householdSize !== "number" || !Number.isInteger(householdSize) || householdSize < 1 || householdSize > MAX_HOUSEHOLD ||
      typeof income !== "number" || !Number.isFinite(income) || income < 0 || income > MAX_INCOME || Number(income.toFixed(2)) !== income ||
      (monthlyBenchmark !== undefined &&
        (typeof monthlyBenchmark !== "number" || !Number.isFinite(monthlyBenchmark) || monthlyBenchmark <= 0 || monthlyBenchmark > MAX_INCOME || Number(monthlyBenchmark.toFixed(2)) !== monthlyBenchmark))) {
    return json({ ok: false, error: "invalid_income_check",
      message: "Enter a supported plan year, region, household size and annual income. Any monthly benchmark must be greater than zero." }, 400);
  }

  const params = getPlanYear(planYear);
  const incomeCents = toCents(income);
  const fpl = computeFpl(params, incomeCents, householdSize, region);
  const upper = cliffIncomeFor(params, householdSize, region);
  const above = upper !== null && incomeCents > upper;
  const below = fpl.form8962Percent < params.minFplPercent;
  const contribution = requiredContributionAt(params, incomeCents, householdSize, region);
  const benchmark = monthlyBenchmark === undefined ? null : toCents(monthlyBenchmark);
  // A benchmark supplied by the user belongs to the coverage household. The
  // actual credit is also limited by the enrolled plan's qualifying premium.
  const benchmarkCredit = benchmark === null ? null : contribution === null ? 0 :
    monthlyFromAnnual(Math.max(0, benchmark * 12 - contribution.annual));
  return json({
    ok: true, planYear, region, householdSize, fpl,
    minimumIncome: fpl.fplAmount * params.minFplPercent / 100, maximumIncome: upper,
    incomeStatus: above ? "above" : below ? "below" : "within",
    applicablePercentage: contribution?.centiPercent ?? null,
    annualRequiredContribution: contribution?.annual ?? null,
    suppliedMonthlyBenchmark: benchmark, estimatedMonthlyBenchmarkCredit: benchmarkCredit,
    povertySource: params.povertyGuidelines.provenance.url,
    rateSource: params.applicablePercentageTable.provenance.url,
    disclaimer: DISCLAIMER,
  }, 200);
}

/** WHATWG adapter. Works unchanged on Cloudflare Pages Functions and Node. */
export async function handleRequest(
  request: Request,
  provider: BenchmarkProvider,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/income-check") return incomeCheck(request);

  if (url.pathname === "/api/health") {
    // Report freshness for the most recent supported plan year with data,
    // not just the first configured one — a currently-served ZIP could sit
    // on an older plan year while the newest is still unpublished.
    let freshness: { generated: string } | null = null;
    for (const planYear of SUPPORTED_PLAN_YEARS) {
      const found = await provider.getFreshness?.(planYear);
      if (found) {
        freshness = found;
        break;
      }
    }
    const ageDays = freshness
      ? (Date.now() - new Date(freshness.generated).getTime()) / 86_400_000
      : null;
    return json(
      {
        ok: true,
        supportedPlanYears: SUPPORTED_PLAN_YEARS,
        provider: provider.name,
        dataGenerated: freshness?.generated ?? null,
        dataAgeDays: ageDays === null ? null : Math.floor(ageDays),
        // true whenever there is no dataset to report on at all, matching
        // estimate()'s STALE_AFTER_DAYS threshold when there is one.
        dataStale: ageDays === null || !Number.isFinite(ageDays) || ageDays < 0 || ageDays > STALE_AFTER_DAYS,
      },
      200,
    );
  }

  if (url.pathname !== "/api/estimate") {
    return json({ ok: false, error: "not_found" }, 404);
  }

  let input: unknown;
  try {
    if (request.method === "POST") {
      input = await request.json();
    } else if (request.method === "GET") {
      const q = url.searchParams;
      input = {
        planYear: q.get("planYear"),
        zip: q.get("zip"),
        countyFips: q.get("countyFips"),
        householdSize: q.get("householdSize"),
        income: q.get("income"),
        ages: (q.get("ages") ?? "").split(",").filter(Boolean).map(Number),
        includeCurve: q.get("includeCurve") === "true",
      };
    } else {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  try {
    const validated = validate(input);
    const response = await estimate(validated, provider);
    return json(response, response.ok ? 200 : 422);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return json({ ok: false, error: "validation_failed", problems: error.problems }, 400);
    }
    if (error instanceof UnsupportedPlanYearError) {
      return json({ ok: false, error: "unsupported_plan_year", message: error.message }, 400);
    }
    if (error instanceof UnverifiedDataError) {
      // We have the engine but not trustworthy inputs for this region. That is
      // a 503, not a 500: the service is fine, the dataset is incomplete.
      return json({ ok: false, error: "data_unverified", message: error.message }, 503);
    }
    return json(
      {
        ok: false,
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
