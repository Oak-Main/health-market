/**
 * The 400% FPL subsidy cliff — the product's reason to exist.
 *
 * With the enhanced premium tax credits lapsed, eligibility ends abruptly at
 * 400% of the federal poverty line. One cent over and the credit goes to zero
 * — not to a reduced amount, to zero. For an older couple that can be a
 * five-figure swing on a single dollar of income.
 *
 * TWO DIFFERENT WAYS THE CREDIT ENDS
 * ----------------------------------
 * Most tools model only the cliff. There are actually two exits, and which one
 * a household hits changes the advice completely:
 *
 *   1. NATURAL PHASE-OUT. The required contribution (income x applicable
 *      percentage) grows with income until it exceeds the benchmark premium.
 *      For a young single filer in a cheap rating area this happens well below
 *      400% FPL. Such a household has no cliff to fall off — managing income
 *      down to 399% FPL buys them nothing.
 *
 *   2. THE CLIFF. For older households, larger families, and expensive rating
 *      areas, the benchmark premium is high enough that a substantial credit
 *      survives right up to 400% FPL. These are the households for whom one
 *      dollar of extra income is catastrophic.
 *
 * Telling those two cases apart is the entire value of this tool, and it
 * cannot be done without the household's actual local benchmark premium.
 */

import { cliffIncomeFor, computeFpl, incomeAtFplPercent } from "./fpl";
import { centsToUsd, requiredContributionAt } from "./ptc";
import type {
  Cents,
  CliffAnalysis,
  Household,
  PlanYearParameters,
  WorkingStep,
} from "./types";

/**
 * Premium tax credit at a hypothetical income, holding the benchmark premium
 * constant. The benchmark depends on age, location and household composition —
 * never on income — so this substitution is exact, not an approximation.
 */
export function ptcAtIncome(
  params: PlanYearParameters,
  annualIncome: Cents,
  size: number,
  region: Household["region"],
  annualBenchmarkPremium: Cents,
): Cents {
  const contribution = requiredContributionAt(params, annualIncome, size, region);
  if (contribution === null) return 0;
  return Math.max(0, annualBenchmarkPremium - contribution.annual);
}

/**
 * Smallest income at which the credit reaches zero through the ordinary
 * sliding scale, searched within [100% FPL, cliff]. Returns null when the
 * credit survives all the way to the cliff.
 *
 * The required contribution is monotonically non-decreasing in income (income
 * rises and the applicable percentage never falls), so binary search is valid.
 */
function findNaturalPhaseOut(
  params: PlanYearParameters,
  size: number,
  region: Household["region"],
  annualBenchmarkPremium: Cents,
  ceiling: Cents,
): Cents | null {
  let lo = incomeAtFplPercent(params, params.minFplPercent, size, region);
  let hi = ceiling;

  if (lo > hi) return null;

  const contributionAt = (income: Cents): Cents => {
    const r = requiredContributionAt(params, income, size, region);
    // Inside [100% FPL, cliff] this is always defined; treat any gap as
    // "not yet phased out" rather than throwing mid-search.
    return r === null ? 0 : r.annual;
  };

  // If the credit still survives at the ceiling, there is no natural phase-out.
  if (contributionAt(hi) < annualBenchmarkPremium) return null;

  // Lower-bound binary search for the first income where contribution >= benchmark.
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (contributionAt(mid) >= annualBenchmarkPremium) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

export function analyzeCliff(
  params: PlanYearParameters,
  household: Household,
  annualBenchmarkPremium: Cents,
): CliffAnalysis {
  const workings: WorkingStep[] = [];
  const { size, region, annualIncome } = household;

  const cliffIncome = cliffIncomeFor(params, size, region);

  if (cliffIncome === null) {
    workings.push({
      label: "No subsidy cliff",
      detail:
        `Plan year ${params.planYear} has no upper income limit on the premium ` +
        `tax credit, so there is no cliff to plan around.`,
    });
    return {
      planYear: params.planYear,
      cliffIncome: null,
      naturalPhaseOutIncome: null,
      subsidyExitIncome: null,
      cliffIsLive: false,
      cliffCost: 0,
      headroom: null,
      workings,
    };
  }

  workings.push({
    label: "Where your cliff sits",
    detail:
      `400% of the federal poverty line for a household of ${size} is ` +
      `${centsToUsd(cliffIncome)}. At exactly this income you remain eligible ` +
      `("not more than 400 percent"). One cent more and the credit is $0.`,
    citation: "IRC §36B(c)(1)(A); IRS Form 8962, line 5",
  });

  const naturalPhaseOutIncome = findNaturalPhaseOut(
    params,
    size,
    region,
    annualBenchmarkPremium,
    cliffIncome,
  );

  const cliffCost = ptcAtIncome(
    params,
    cliffIncome,
    size,
    region,
    annualBenchmarkPremium,
  );
  const cliffIsLive = cliffCost > 0;

  if (naturalPhaseOutIncome !== null) {
    workings.push({
      label: "Your credit ends before the cliff",
      detail:
        `Your required contribution passes your benchmark premium of ` +
        `${centsToUsd(annualBenchmarkPremium)} at ${centsToUsd(naturalPhaseOutIncome)} — ` +
        `below the ${centsToUsd(cliffIncome)} cliff. Your credit tapers to zero ` +
        `on its own, so there is no cliff for you to fall off and no benefit to ` +
        `holding income under 400% of the poverty line.`,
      citation: "IRC §36B(b)(2)",
    });
  } else {
    workings.push({
      label: "Your cliff is live",
      detail:
        `Your credit survives all the way to 400% of the poverty line. Crossing ` +
        `${centsToUsd(cliffIncome)} by one cent costs you ${centsToUsd(cliffCost)} ` +
        `per year — an effectively infinite marginal rate on that dollar.`,
      citation: "IRC §36B(c)(1)(A)",
    });
  }

  const subsidyExitIncome = naturalPhaseOutIncome ?? (cliffIsLive ? cliffIncome : null);
  const headroom = cliffIncome - annualIncome;

  if (headroom < 0 && cliffIsLive) {
    workings.push({
      label: "You are currently above the cliff",
      detail:
        `Reducing modified adjusted gross income by ${centsToUsd(-headroom)} would ` +
        `bring you to ${centsToUsd(cliffIncome)} and restore ` +
        `${centsToUsd(cliffCost)} per year of credit. Deductible HSA, traditional ` +
        `IRA, SEP-IRA and solo 401(k) contributions all reduce MAGI for this test.`,
    });
  } else if (headroom >= 0 && cliffIsLive) {
    workings.push({
      label: "Your headroom",
      detail:
        `You can take on ${centsToUsd(headroom)} more of modified adjusted gross ` +
        `income before the cliff. Capital gains, Roth conversions and year-end ` +
        `bonuses all count toward it.`,
    });
  }

  if (!params.excessAptcRepaymentCapped) {
    workings.push({
      label: "Repayment caps no longer apply",
      detail:
        `For tax years beginning after 2025-12-31 the excess advance-credit ` +
        `repayment caps are repealed. If you underestimate income and take too ` +
        `much credit in advance, you repay 100% of the excess with no ceiling.`,
      citation: "IRC §36B(f)(2), as amended",
    });
  }

  return {
    planYear: params.planYear,
    cliffIncome,
    naturalPhaseOutIncome,
    subsidyExitIncome,
    cliffIsLive,
    cliffCost,
    headroom,
    workings,
  };
}

export interface CurvePoint {
  readonly annualIncome: Cents;
  /** Whole percentage for the chart axis, including values above 400. */
  readonly fplPercent: number;
  /** IRS worksheet value, with 401 marking income above four times the guideline. */
  readonly form8962Percent: number;
  readonly annualPtc: Cents;
  readonly annualRequiredContribution: Cents;
  /** Net annual premium for the benchmark plan after the credit. */
  readonly annualNetPremium: Cents;
}

/**
 * Sample the credit across an income range, for charting.
 *
 * The returned series deliberately includes the two points that bracket the
 * cliff (exactly 4x FPL, and one cent above) so a chart drawn from it renders
 * the discontinuity as a true vertical drop rather than a smoothed ramp.
 */
export function buildPtcCurve(
  params: PlanYearParameters,
  household: Household,
  annualBenchmarkPremium: Cents,
  options: { steps?: number; fromFplPercent?: number; toFplPercent?: number } = {},
): CurvePoint[] {
  const steps = options.steps ?? 120;
  const fromPct = options.fromFplPercent ?? params.minFplPercent;
  const toPct = options.toFplPercent ?? 500;

  const { size, region } = household;
  const lo = incomeAtFplPercent(params, fromPct, size, region);
  const hi = incomeAtFplPercent(params, toPct, size, region);
  const cliffIncome = cliffIncomeFor(params, size, region);

  const incomes = new Set<Cents>();
  for (let i = 0; i <= steps; i += 1) {
    incomes.add(Math.round(lo + ((hi - lo) * i) / steps));
  }
  // Force exact cliff bracketing.
  if (cliffIncome !== null && cliffIncome >= lo && cliffIncome <= hi) {
    incomes.add(cliffIncome);
    incomes.add(cliffIncome + 1);
  }
  incomes.add(household.annualIncome);

  return [...incomes]
    .filter((income) => income >= 0)
    .sort((a, b) => a - b)
    .map((annualIncome) => {
      const contribution = requiredContributionAt(params, annualIncome, size, region);
      const annualPtc = Math.max(
        0,
        annualBenchmarkPremium - (contribution?.annual ?? annualBenchmarkPremium),
      );
      const fpl = computeFpl(params, annualIncome, size, region);
      return {
        annualIncome,
        fplPercent: Math.floor((annualIncome * 100) / fpl.fplAmount),
        form8962Percent: fpl.form8962Percent,
        annualPtc,
        annualRequiredContribution: contribution?.annual ?? 0,
        annualNetPremium: annualBenchmarkPremium - annualPtc,
      };
    });
}
