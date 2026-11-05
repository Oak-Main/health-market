/**
 * The benchmark premium (second-lowest-cost silver plan) provider interface.
 *
 * The PTC engine is pure: it takes a benchmark premium as an input and never
 * performs I/O. This module defines how that number is supplied, and makes the
 * *absence* of real data an explicit, typed condition rather than a silent
 * fallback to something plausible.
 *
 * ZIP pricing is available only after this application verifies and loads a
 * year-specific CMS release. The federal income test does not require a quote.
 */

import type { Cents, FplRegion, HouseholdMember, PlanYear } from "./types";

export interface BenchmarkRequest {
  readonly planYear: PlanYear;
  readonly zip: string;
  /**
   * FIPS county code. Required when a ZIP spans multiple counties — rating
   * areas are county-based in most states, so a ZIP alone can be ambiguous.
   */
  readonly countyFips?: string;
  readonly members: readonly HouseholdMember[];
}

export interface BenchmarkQuote {
  readonly kind: "quote";
  readonly planYear: PlanYear;
  /** Monthly second-lowest-cost silver premium for the rated household. */
  readonly monthlySlcsp: Cents;
  /** Monthly lowest-cost bronze premium, used for affordability exemptions. */
  readonly monthlyLcbp: Cents | null;
  readonly ratingAreaId: string;
  readonly countyFips: string;
  readonly region: FplRegion;
  /** Identifier of the plan that is second-lowest-cost silver, for auditability. */
  readonly slcspPlanId: string | null;
  /** Provenance shown in the UI: which file, published when. */
  readonly sourceFile: string;
  readonly sourcePublished: string;
  /** Time the shard was built from upstream files. */
  readonly generated: string;
}

export type BenchmarkUnavailableReason =
  /** The plan year's data has not been published by CMS yet. */
  | "plan-year-not-published"
  /** The ZIP maps to multiple counties and no county was supplied. */
  | "ambiguous-zip"
  /** ZIP not found in the crosswalk. */
  | "unknown-zip"
  /** State runs its own exchange and its data is not in the federal files. */
  | "state-based-exchange"
  /** The dataset has not been loaded into this deployment. */
  | "dataset-not-loaded";

export interface BenchmarkUnavailable {
  readonly kind: "unavailable";
  readonly reason: BenchmarkUnavailableReason;
  readonly message: string;
  /** For "ambiguous-zip": the candidate counties the caller must choose from. */
  readonly candidateCounties?: readonly { fips: string; name: string; state: string }[];
  /** For "state-based-exchange": where to send the user instead. */
  readonly exchangeUrl?: string;
  readonly exchangeName?: string;
}

export type BenchmarkResult = BenchmarkQuote | BenchmarkUnavailable;

export interface BenchmarkFreshness {
  /** ISO timestamp the currently-loaded dataset for this plan year was built. */
  readonly generated: string;
}

export interface BenchmarkProvider {
  readonly name: string;
  getBenchmark(request: BenchmarkRequest): Promise<BenchmarkResult>;
  /**
   * When was the dataset for this plan year last (re)built? Optional because
   * not every provider has a meaningful answer (e.g. NullBenchmarkProvider).
   * Used to detect a weekly-refresh pipeline that has silently stopped
   * running, distinct from a dataset that was never loaded at all.
   */
  getFreshness?(planYear: PlanYear): Promise<BenchmarkFreshness | null>;
}

export function isQuote(result: BenchmarkResult): result is BenchmarkQuote {
  return result.kind === "quote";
}

/**
 * A provider that always reports data unavailable, with an accurate reason.
 *
 * This is the correct default for a fresh deployment: the engine is fully
 * functional, the dataset simply has not been loaded. It never invents a
 * premium.
 */
export class NullBenchmarkProvider implements BenchmarkProvider {
  readonly name = "null";

  async getBenchmark(request: BenchmarkRequest): Promise<BenchmarkResult> {
    return {
      kind: "unavailable",
      reason: "dataset-not-loaded",
      message:
        `No benchmark dataset is loaded for plan year ${request.planYear}. ` +
        `Run \`npm run etl -- --plan-year=${request.planYear}\` from an ` +
        `environment with outbound network access to CMS.`,
    };
  }
}
