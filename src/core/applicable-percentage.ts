/**
 * The §36B(b)(3)(A)(i) applicable percentage: the share of household income a
 * family is expected to contribute toward the benchmark plan.
 *
 * STATUTORY ROUNDING
 * ------------------
 * 26 CFR 1.36B-3(g): "An applicable percentage within an income category
 * increases on a sliding scale in a linear manner and is rounded to the
 * nearest one-hundredth of one percent."
 *
 * Because we store percentages in integer hundredths-of-one-percent
 * ("centipercent"), that rounding is exactly `Math.round()` on the
 * interpolated value — no float epsilon games.
 *
 * @see https://www.law.cornell.edu/cfr/text/26/1.36B-3
 */

import type {
  ApplicablePercentageBracket,
  ApplicablePercentageTable,
  CentiPercent,
} from "./types";

export class BracketNotFoundError extends Error {
  constructor(readonly fplPercent: number, readonly planYear: number) {
    super(
      `No applicable percentage bracket covers ${fplPercent}% of FPL for plan ` +
        `year ${planYear}. Income above the statutory maximum must be handled ` +
        `as an eligibility failure before reaching this function.`,
    );
    this.name = "BracketNotFoundError";
  }
}

export function findBracket(
  table: ApplicablePercentageTable,
  fplPercent: number,
): ApplicablePercentageBracket | undefined {
  return table.brackets.find(
    (b) => fplPercent >= b.fromFplPercent && fplPercent < b.toFplPercent,
  );
}

/**
 * Look up the applicable percentage for a whole-number percent of FPL.
 *
 * `fplPercent` must be the Form 8962 line 5 value (a whole number), not the
 * unrounded ratio. Passing an unrounded value produces results that will not
 * reconcile against Form 8962 at filing time — which, now that OBBBA has
 * repealed the excess-APTC repayment caps, is an unbounded liability for the
 * user rather than a rounding curiosity.
 */
export function applicablePercentage(
  table: ApplicablePercentageTable,
  fplPercent: number,
): CentiPercent {
  if (!Number.isInteger(fplPercent)) {
    throw new TypeError(
      `applicablePercentage() requires the whole-number Form 8962 line 5 value; ` +
        `received ${fplPercent}. Use the Form 8962 line 5 value.`,
    );
  }

  const bracket = findBracket(table, fplPercent);
  if (!bracket) throw new BracketNotFoundError(fplPercent, table.planYear);

  if (bracket.initial === bracket.final) return bracket.initial;

  const width = bracket.toFplPercent - bracket.fromFplPercent;
  const position = fplPercent - bracket.fromFplPercent;
  const span = bracket.final - bracket.initial;

  // Interpolate, then round to the nearest hundredth of one percent.
  return Math.round(bracket.initial + (span * position) / width);
}

/**
 * Structural invariant: each bracket's final percentage must equal the next
 * bracket's initial percentage, so the sliding scale is continuous across
 * bracket boundaries (except the deliberate statutory step at 133% FPL).
 *
 * This is a genuine validation signal for table data transcribed from a PDF:
 * a single mistyped digit almost always breaks the chain.
 */
export function validateTableChaining(table: ApplicablePercentageTable): string[] {
  const problems: string[] = [];
  const brackets = table.brackets;

  for (let i = 0; i < brackets.length; i += 1) {
    const b = brackets[i];
    if (!b) continue;

    if (b.toFplPercent <= b.fromFplPercent) {
      problems.push(
        `Bracket ${i} has non-increasing bounds: [${b.fromFplPercent}, ${b.toFplPercent}).`,
      );
    }
    if (b.final < b.initial) {
      problems.push(
        `Bracket ${i} decreases: initial ${b.initial} > final ${b.final}.`,
      );
    }

    const next = brackets[i + 1];
    if (!next) continue;

    if (next.fromFplPercent !== b.toFplPercent) {
      problems.push(
        `Gap or overlap between bracket ${i} (ends ${b.toFplPercent}) and ` +
          `bracket ${i + 1} (starts ${next.fromFplPercent}).`,
      );
    }

    // The 133% boundary is a deliberate statutory discontinuity; every other
    // boundary must be continuous.
    const isStatutoryStep = b.toFplPercent === 133;
    if (!isStatutoryStep && next.initial !== b.final) {
      problems.push(
        `Discontinuity at ${b.toFplPercent}%: bracket ${i} ends at ${b.final} ` +
          `but bracket ${i + 1} starts at ${next.initial}.`,
      );
    }
  }

  return problems;
}

/** Apply a centipercent rate to a cents amount, rounding to the nearest cent. */
export function applyRate(amountCents: number, rate: CentiPercent): number {
  return Math.round((amountCents * rate) / 10_000);
}
