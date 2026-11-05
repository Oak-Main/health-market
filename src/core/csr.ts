/**
 * Cost-sharing reductions — the silver variants.
 *
 * CSRs raise the actuarial value of a silver plan for lower-income enrollees.
 * They are available ONLY on silver plans, which is why "always buy bronze
 * when subsidised" is bad advice below 250% FPL: a CSR-94 silver plan is a
 * richer plan than any gold, often for less money.
 *
 * @see https://www.healthreformbeyondthebasics.org/cost-sharing-charges-in-marketplace-health-insurance-plans-part-2/
 */

import type { CsrResult } from "./types";

/**
 * Determine the CSR silver variant from the unrounded income-to-poverty percentage.
 *
 * @param fplPercent Household income as a percent of FPL.
 * @param enrollingInSilver CSRs attach only to silver-metal plans.
 */
export function determineCsr(fplPercent: number, enrollingInSilver: boolean): CsrResult {
  if (!enrollingInSilver) {
    return {
      variant: "not-eligible",
      actuarialValue: null,
      reason:
        "Cost-sharing reductions are available only on silver plans. At this " +
        "income a silver plan may carry a materially richer benefit than gold.",
    };
  }

  if (fplPercent < 100) {
    return {
      variant: "not-eligible",
      actuarialValue: null,
      reason: "Household income is below 100% of the federal poverty line.",
    };
  }

  if (fplPercent <= 150) {
    return {
      variant: "csr-94",
      actuarialValue: 0.94,
      reason: "Income is at or below 150% of the federal poverty line.",
    };
  }
  if (fplPercent <= 200) {
    return {
      variant: "csr-87",
      actuarialValue: 0.87,
      reason: "Income is above 150% and at or below 200% of the federal poverty line.",
    };
  }
  if (fplPercent <= 250) {
    return {
      variant: "csr-73",
      actuarialValue: 0.73,
      reason: "Income is above 200% and at or below 250% of the federal poverty line.",
    };
  }

  return {
    variant: "standard-silver",
    actuarialValue: 0.7,
    reason:
      "Income is above 250% of the federal poverty line; no cost-sharing " +
      "reduction applies and the silver plan carries its standard ~70% " +
      "actuarial value.",
  };
}
