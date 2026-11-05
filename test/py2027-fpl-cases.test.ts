/**
 * Plan year 2027 — household cases at 150%, 399% and 401% of the federal
 * poverty line.
 *
 * These three points are the whole product in miniature:
 *
 *   150%  a working household paying 4.30% of income, inside the sliding
 *         scale, far from any edge.
 *   399%  the last household before the cliff — still eligible, still paying
 *         the full 10.22% required contribution.
 *   401%  the first household over the cliff — the credit is $0, not a
 *         reduced amount.
 *
 * Each case is pinned to the parameter it depends on, so a change in the
 * applicable percentage table or the poverty guidelines fails here rather
 * than silently moving the cliff.
 *
 * Sources, all read from their primary document on 2026-11-04:
 *   - 2026 HHS poverty guidelines, 91 FR 1797-1798 (FR Doc. 2026-00755):
 *     contiguous base $15,960, +$5,680 per person over 4. A 2027 taxable year
 *     uses the 2026 guidelines (26 CFR 1.36B-1(h)).
 *   - IRS Rev. Proc. 2026-26 §3.01: the 2027 applicable percentage table.
 *     At 150% the table gives 4.30%; at 399% and 401% it gives 10.22%.
 */

import { describe, expect, it } from "vitest";

import { fplAmount } from "../src/core/fpl.js";
import { getPlanYear } from "../src/core/plan-years.js";
import { computePtc } from "../src/core/ptc.js";
import type { Household, HouseholdMember } from "../src/core/types.js";

const PY27 = getPlanYear(2027);

const USD = (dollars: number): number => Math.round(dollars * 100);
const adult = (age: number): HouseholdMember => ({ age, seeksCoverage: true });

function household(overrides: Partial<Household> = {}): Household {
  return {
    size: 1,
    members: [adult(45)],
    annualIncome: USD(40_000),
    region: "contiguous",
    ...overrides,
  };
}

/** A benchmark premium high enough that the credit is never clipped to zero. */
const BENCHMARK = USD(20_000);

describe("plan year 2027 — 150% of FPL", () => {
  // Family of four: $33,000 FPL on the 2026 guidelines, so 150% is $49,500.
  const FPL = USD(33_000);
  const INCOME = USD(49_500);

  it("reads the household's FPL from the 2026 guidelines", () => {
    expect(fplAmount(PY27, 4, "contiguous")).toBe(FPL);
  });

  it("places the household at exactly 150% of FPL", () => {
    const result = computePtc(PY27, household({
      size: 4,
      members: [adult(45), adult(43), adult(17), adult(12)],
      annualIncome: INCOME,
    }), BENCHMARK);

    expect(result.fpl.fplAmount).toBe(FPL);
    expect(result.fpl.exactRatio * 100).toBeCloseTo(150, 10);
    expect(result.fpl.form8962Percent).toBe(150);
    expect(result.fpl.exceedsFourTimesFpl).toBe(false);
    expect(result.fpl.guidelineYear).toBe(2026);
  });

  it("applies the 4.30% applicable percentage from Rev. Proc. 2026-26", () => {
    const result = computePtc(PY27, household({
      size: 4,
      members: [adult(45), adult(43), adult(17), adult(12)],
      annualIncome: INCOME,
    }), BENCHMARK);

    expect(result.eligible).toBe(true);
    expect(result.applicablePercentage).toBe(430);
    // $49,500 x 4.30% = $2,128.50 a year.
    expect(result.annualRequiredContribution).toBe(USD(2_128.5));
    expect(result.monthlyRequiredContribution).toBe(USD(177.38));
    expect(result.annualPtc).toBe(USD(20_000) - USD(2_128.5));
  });
});

describe("plan year 2027 — 399% of FPL", () => {
  // Couple of two: $21,640 FPL, so 400% is $86,560 and 399% is $86,343.60.
  const FPL = USD(21_640);
  const INCOME = USD(86_343.6);

  it("is still eligible and still pays the full 10.22% contribution", () => {
    const result = computePtc(PY27, household({
      size: 2,
      members: [adult(60), adult(58)],
      annualIncome: INCOME,
    }), BENCHMARK);

    expect(result.fpl.fplAmount).toBe(FPL);
    expect(result.fpl.exactRatio * 100).toBeCloseTo(399, 10);
    expect(result.fpl.form8962Percent).toBe(399);
    expect(result.fpl.exceedsFourTimesFpl).toBe(false);
    expect(result.eligible).toBe(true);
    expect(result.ineligibilityReason).toBeNull();
    expect(result.applicablePercentage).toBe(1022);
    // $86,343.60 x 10.22% = $8,824.32 a year.
    expect(result.annualRequiredContribution).toBe(USD(8_824.32));
    expect(result.monthlyRequiredContribution).toBe(USD(735.36));
    expect(result.annualPtc).toBe(USD(20_000) - USD(8_824.32));
  });

  it("retains the credit up to the two-person cliff and loses it one cent above", () => {
    const atIncome = (dollars: number) => computePtc(PY27, household({
      size: 2, members: [adult(60), adult(58)], annualIncome: USD(dollars),
    }), BENCHMARK);
    expect(atIncome(86_559).eligible).toBe(true);
    expect(atIncome(86_560).annualPtc).toBeGreaterThan(USD(11_000));
    expect(atIncome(86_560.01).annualPtc).toBe(0);
  });
});

describe("plan year 2027 — 401% of FPL", () => {
  // Couple of two: 401% of $21,640 is $86,776.40, which is $216.40 over 4x FPL.
  const FPL = USD(21_640);
  const INCOME = USD(86_776.4);

  it("fails the 400% cliff with no credit at all", () => {
    const result = computePtc(PY27, household({
      size: 2,
      members: [adult(60), adult(58)],
      annualIncome: INCOME,
    }), BENCHMARK);

    expect(result.fpl.fplAmount).toBe(FPL);
    expect(result.fpl.exceedsFourTimesFpl).toBe(true);
    // Form 8962 line 5 sentinel for "above 400% of the poverty line".
    expect(result.fpl.form8962Percent).toBe(401);
    expect(result.eligible).toBe(false);
    expect(result.ineligibilityReason).toBe("income-above-400-percent");
    expect(result.annualPtc).toBe(0);
    expect(result.monthlyPtc).toBe(0);
    expect(result.annualRequiredContribution).toBe(0);
  });

  it("states that the cliff is the lapsed enhanced credits, not a phase-out", () => {
    const result = computePtc(PY27, household({
      size: 2,
      members: [adult(60), adult(58)],
      annualIncome: INCOME,
    }), BENCHMARK);

    const cliffStep = result.workings.find((w) => w.label === "Not eligible");
    expect(cliffStep?.detail).toMatch(/lapsed on 2025-12-31/);
  });
});

describe("plan year 2027 — the cliff is live because the credits lapsed", () => {
  it("caps eligibility at 400% FPL with no enhanced schedule", () => {
    expect(PY27.enhancedCreditsActive).toBe(false);
    expect(PY27.maxFplPercent).toBe(400);
  });

  it("puts the cliff at 4x the 2026-guidelines FPL for these households", () => {
    // Household of four: 4 x $33,000 = $132,000.
    const atCliff = computePtc(PY27, household({
      size: 4,
      members: [adult(45), adult(43), adult(17), adult(12)],
      annualIncome: USD(132_000),
    }), BENCHMARK);
    expect(atCliff.eligible).toBe(true);
    expect(atCliff.fpl.exceedsFourTimesFpl).toBe(false);
    expect(atCliff.applicablePercentage).toBe(1022);

    // One cent more: gone.
    const overCliff = computePtc(PY27, household({
      size: 4,
      members: [adult(45), adult(43), adult(17), adult(12)],
      annualIncome: USD(132_000) + 1,
    }), BENCHMARK);
    expect(overCliff.eligible).toBe(false);
    expect(overCliff.annualPtc).toBe(0);
  });
});

describe("2027 regional income limits in dollars and cents", () => {
  // 91 FR 1798, including the increment for a ninth household member.
  const figures = [
    { region: "alaska", table: [19950, 27050, 34150, 41250, 48350, 55450, 62550, 69650, 76750] },
    { region: "hawaii", table: [18360, 24890, 31420, 37950, 44480, 51010, 57540, 64070, 70600] },
    { region: "contiguous", table: [15960, 21640, 27320, 33000, 38680, 44360, 50040, 55720, 61400] },
  ] as const;

  for (const { region, table } of figures) {
    it(`uses the published ${region} values for households of one through nine`, () => {
      table.forEach((amount, i) => expect(fplAmount(PY27, i + 1, region)).toBe(USD(amount)));
    });
    it(`checks the exact general 100% and 400% limits in ${region}`, () => {
      const floor = USD(table[0]);
      const upper = 4 * floor;
      for (const [annualIncome, line5, eligible] of [
        [floor - 1, 99, false], [floor, 100, true], [floor + 1, 100, true],
        [upper - 1, 399, true], [upper, 400, true], [upper + 1, 401, false],
      ] as const) {
        const result = computePtc(PY27, household({ region, annualIncome }), BENCHMARK);
        expect(result.eligible).toBe(eligible);
        expect(result.fpl.form8962Percent).toBe(line5);
        expect(result.annualPtc).toBe(eligible ? BENCHMARK - Math.round(annualIncome * (line5 === 100 ? 215 : 1022) / 10000) : 0);
      }
    });
    it(`uses the correct contribution rate on either side of each IRS bracket in ${region}`, () => {
      const floor = USD(table[0]);
      for (const [percent, rateBelow, rateAt] of [[133, 215, 323], [150, 424, 430], [200, 673, 678], [250, 862, 866], [300, 1019, 1022]] as const) {
        const boundary = floor * percent / 100;
        const at = (annualIncome: number) => computePtc(PY27, household({ region, annualIncome }), BENCHMARK);
        expect(at(boundary - 1).applicablePercentage).toBe(rateBelow);
        expect(at(boundary).applicablePercentage).toBe(rateAt);
      }
    });
  }
});
