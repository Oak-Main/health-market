/**
 * Federal poverty line computation, matching IRS Form 8962 line 5 semantics.
 *
 * THE CRITICAL DETAIL
 * -------------------
 * The >400% eligibility test is performed on the RAW comparison
 * `household income > 4 x FPL`, BEFORE any rounding. For incomes at or below the cap,
 * Worksheet 2 drops all digits after the decimal point.
 *
 * This ordering matters enormously and is the single most common bug in
 * third-party subsidy calculators. A household at 400.4% of FPL rounds to
 * "400" under naive implementations and is wrongly granted a credit. The
 * Form 8962 instructions are explicit: "If the amount on line 3 is more than
 * 4 times the amount on line 4 ... enter 401 on line 5."
 *
 * @see https://www.irs.gov/instructions/i8962
 * @see https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/section-1.36B-1 (paragraph (h))
 */

import { requireVerifiedRegion } from "./plan-years";
import type { Cents, FplRegion, FplResult, PlanYearParameters } from "./types";

/** Sentinel used by Form 8962 line 5 for "above 400% of the poverty line". */
export const ABOVE_400_SENTINEL = 401;

export class InvalidHouseholdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidHouseholdError";
  }
}

/**
 * The 100%-of-FPL amount for a household of `size` in `region`.
 *
 * HHS publishes a base (1-person) amount plus a per-additional-person
 * increment, for each of three regions.
 */
export function fplAmount(
  params: PlanYearParameters,
  size: number,
  region: FplRegion,
): Cents {
  if (!Number.isInteger(size) || size < 1) {
    throw new InvalidHouseholdError(
      `Household size must be a positive integer; received ${size}.`,
    );
  }
  requireVerifiedRegion(params, region);
  const { base, increment } = params.povertyGuidelines;
  return base[region] + increment[region] * (size - 1);
}

/**
 * Compute household income as a percent of the federal poverty line,
 * following Form 8962 line 5 exactly.
 */
export function computeFpl(
  params: PlanYearParameters,
  annualIncome: Cents,
  size: number,
  region: FplRegion,
): FplResult {
  if (!Number.isInteger(annualIncome)) {
    throw new InvalidHouseholdError(
      `Income must be an integer number of cents; received ${annualIncome}.`,
    );
  }
  if (annualIncome < 0) {
    throw new InvalidHouseholdError(`Income cannot be negative; received ${annualIncome}.`);
  }

  const amount = fplAmount(params, size, region);

  // The raw test, performed before any rounding. Integer arithmetic only.
  const exceedsFourTimesFpl = annualIncome > 4 * amount;

  const exactRatio = annualIncome / amount;
  const form8962Percent = exceedsFourTimesFpl
    ? ABOVE_400_SENTINEL
    : Math.floor((annualIncome * 100) / amount);

  return {
    fplAmount: amount,
    exactRatio,
    form8962Percent,
    exceedsFourTimesFpl,
    guidelineYear: params.povertyGuidelines.guidelineYear,
  };
}

/**
 * The exact income at which the 400% FPL cliff sits: 4 x FPL. At this income
 * the household is still eligible ("not more than 400 percent"); one cent
 * more and the credit is zero.
 */
export function cliffIncomeFor(
  params: PlanYearParameters,
  size: number,
  region: FplRegion,
): Cents | null {
  if (params.maxFplPercent === null) return null;
  const amount = fplAmount(params, size, region);
  // maxFplPercent is a whole percent; use integer math to stay exact.
  return Math.floor((amount * params.maxFplPercent) / 100);
}

/** The income corresponding to a given percent of FPL. */
export function incomeAtFplPercent(
  params: PlanYearParameters,
  fplPercent: number,
  size: number,
  region: FplRegion,
): Cents {
  const amount = fplAmount(params, size, region);
  return Math.round((amount * fplPercent) / 100);
}
