/**
 * Golden facts — the numeric contract of the engine.
 *
 * Each test names its source. If a source changes (a new Rev. Proc., a court
 * ruling, an Act of Congress), the test should fail loudly and be updated
 * deliberately rather than drifting.
 */

import { describe, expect, it } from "vitest";

import {
  applicablePercentage,
  applyRate,
  validateTableChaining,
} from "../src/core/applicable-percentage.js";
import { analyzeCliff, buildPtcCurve, ptcAtIncome } from "../src/core/cliff.js";
import { assessAffordability } from "../src/core/affordability.js";
import { determineCsr } from "../src/core/csr.js";
import { cliffIncomeFor, computeFpl, fplAmount } from "../src/core/fpl.js";
import {
  APT_2026,
  APT_2027,
  getPlanYear,
  UnverifiedDataError,
} from "../src/core/plan-years.js";
import { computePtc } from "../src/core/ptc.js";
import { ageFactor, MAX_AGE_RATIO, selectRatedMembers } from "../src/core/rating.js";
import type { Household, HouseholdMember } from "../src/core/types.js";

const PY27 = getPlanYear(2027);
const PY26 = getPlanYear(2026);

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

// ---------------------------------------------------------------------------
// Table integrity
// ---------------------------------------------------------------------------

describe("applicable percentage tables", () => {
  it("GF#4/#5: 2027 table runs 2.15% to 10.22% (Rev. Proc. 2026-26)", () => {
    expect(applicablePercentage(APT_2027, 100)).toBe(215);
    expect(applicablePercentage(APT_2027, 132)).toBe(215);
    expect(applicablePercentage(APT_2027, 300)).toBe(1022);
    expect(applicablePercentage(APT_2027, 400)).toBe(1022);
  });

  it("GF#6: 2027 required contribution percentage is 10.22%, 2026 is 9.96%", () => {
    expect(PY27.requiredContributionPercentage).toBe(1022);
    expect(PY26.requiredContributionPercentage).toBe(996);
  });

  it("both tables satisfy the chaining invariant", () => {
    // Each bracket's final must equal the next bracket's initial, so the
    // sliding scale is continuous — except the statutory step at 133% FPL.
    expect(validateTableChaining(APT_2027)).toEqual([]);
    expect(validateTableChaining(APT_2026)).toEqual([]);
  });

  it("detects a transcription error via the chaining invariant", () => {
    const corrupted = {
      ...APT_2027,
      brackets: APT_2027.brackets.map((b, i) =>
        i === 2 ? { ...b, final: 999 } : b,
      ),
    };
    expect(validateTableChaining(corrupted).length).toBeGreaterThan(0);
  });

  it("interpolates linearly and rounds to the nearest hundredth of a percent", () => {
    // 26 CFR 1.36B-3(g). Band [250,300): initial 8.66, final 10.22, width 50.
    // At 251%: 866 + 156*1/50 = 869.12 -> 869.
    expect(applicablePercentage(APT_2027, 251)).toBe(869);
    // At 275% (midpoint): 866 + 156*25/50 = 944.
    expect(applicablePercentage(APT_2027, 275)).toBe(944);
    // At 249% in band [200,250): 678 + 188*49/50 = 862.24 -> 862.
    expect(applicablePercentage(APT_2027, 249)).toBe(862);
  });

  it("is continuous across every bracket boundary except the 133% step", () => {
    for (let p = 100; p < 400; p += 1) {
      const here = applicablePercentage(APT_2027, p);
      const next = applicablePercentage(APT_2027, p + 1);
      const isStatutoryStep = p + 1 === 133;
      if (isStatutoryStep) {
        expect(next).toBeGreaterThan(here);
      } else {
        // Never decreases, and never jumps by more than a few hundredths.
        expect(next).toBeGreaterThanOrEqual(here);
        expect(next - here).toBeLessThanOrEqual(15);
      }
    }
  });

  it("rejects a non-integer FPL percent rather than silently accepting it", () => {
    expect(() => applicablePercentage(APT_2027, 250.6)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Federal poverty line
// ---------------------------------------------------------------------------

describe("federal poverty line", () => {
  it("GF#1/#2: 2026 guidelines are $15,960 (1 person) and $33,000 (4 person)", () => {
    expect(fplAmount(PY27, 1, "contiguous")).toBe(USD(15_960));
    expect(fplAmount(PY27, 4, "contiguous")).toBe(USD(33_000));
  });

  it("GF#3: the derived $5,680 increment reproduces the sourced 4-person figure", () => {
    // This is the check that the derivation in plan-years.ts is self-consistent:
    // base + 3 * increment must equal the independently sourced $33,000.
    expect(fplAmount(PY27, 2, "contiguous")).toBe(USD(21_640));
    expect(fplAmount(PY27, 3, "contiguous")).toBe(USD(27_320));
    expect(fplAmount(PY27, 4, "contiguous")).toBe(USD(33_000));
  });

  it("PY2026 uses the 2025 guidelines, giving the reported $62,600 cliff", () => {
    // 4 x $15,650. Corroborates the 2025 base independently.
    expect(cliffIncomeFor(PY26, 1, "contiguous")).toBe(USD(62_600));
    expect(cliffIncomeFor(PY26, 2, "contiguous")).toBe(USD(84_600));
    expect(cliffIncomeFor(PY26, 4, "contiguous")).toBe(USD(128_600));
  });

  it("serves Alaska and Hawaii from their own verified 2026 tables", () => {
    // 91 FR 1797-1798 (FR Doc. 2026-00755), read 2026-11-04. Alaska $19,950
    // base and +$7,100 per person; Hawaii $18,360 base and +$6,530 per person.
    // These regions were zeroed placeholders until that pass.
    expect(fplAmount(PY27, 1, "alaska")).toBe(USD(19_950));
    expect(fplAmount(PY27, 2, "alaska")).toBe(USD(27_050));
    expect(fplAmount(PY27, 4, "alaska")).toBe(USD(41_250));
    expect(fplAmount(PY27, 1, "hawaii")).toBe(USD(18_360));
    expect(fplAmount(PY27, 2, "hawaii")).toBe(USD(24_890));
    expect(fplAmount(PY27, 4, "hawaii")).toBe(USD(37_950));
  });

  it("still refuses a region whose table has not been verified", () => {
    // Every region currently verifies, so the runtime guard is exercised with
    // a deliberately unverified copy. Returning a confidently wrong number is
    // worse than returning an error.
    const unverified = {
      ...PY27,
      povertyGuidelines: {
        ...PY27.povertyGuidelines,
        base: { ...PY27.povertyGuidelines.base, alaska: 0 },
        increment: { ...PY27.povertyGuidelines.increment, alaska: 0 },
      },
    };
    expect(() => fplAmount(unverified, 1, "alaska")).toThrow(UnverifiedDataError);
  });

  it("rejects invalid household sizes", () => {
    expect(() => fplAmount(PY27, 0, "contiguous")).toThrow();
    expect(() => fplAmount(PY27, 1.5, "contiguous")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// The 400% test — no rounding escape hatch
// ---------------------------------------------------------------------------

describe("the >400% test runs before rounding (Form 8962 line 5)", () => {
  it("treats exactly 400% as eligible", () => {
    const fpl = computeFpl(PY27, USD(63_840), 1, "contiguous");
    expect(fpl.exceedsFourTimesFpl).toBe(false);
    expect(fpl.form8962Percent).toBe(400);
  });

  it("treats one cent over 400% as ineligible", () => {
    const fpl = computeFpl(PY27, USD(63_840) + 1, 1, "contiguous");
    expect(fpl.exceedsFourTimesFpl).toBe(true);
    expect(fpl.form8962Percent).toBe(401);
  });

  it("does NOT let 400.4% round down to 400 and sneak back into eligibility", () => {
    // This is the single most common defect in third-party ACA calculators.
    // 400.4% of $15,960 = $63,903.84 -> naive Math.round(400.4) = 400 -> credit.
    // Correct behaviour: income > 4 x FPL, so line 5 is 401 and the credit is $0.
    const income = USD(63_903.84);
    const fpl = computeFpl(PY27, income, 1, "contiguous");
    expect(fpl.exactRatio * 100).toBeGreaterThan(400);
    expect(fpl.exactRatio * 100).toBeLessThan(401);
    expect(fpl.exceedsFourTimesFpl).toBe(true);
    expect(fpl.form8962Percent).toBe(401);

    const result = computePtc(PY27, household({ annualIncome: income }), USD(9_000));
    expect(result.eligible).toBe(false);
    expect(result.ineligibilityReason).toBe("income-above-400-percent");
    expect(result.annualPtc).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Worked PTC examples
// ---------------------------------------------------------------------------

describe("worked premium tax credit examples (plan year 2027)", () => {
  it("GF#7: single filer at exactly the cliff pays $6,524.45/yr ($543.70/mo)", () => {
    const result = computePtc(
      PY27,
      household({ annualIncome: USD(63_840) }),
      USD(12_000),
    );
    expect(result.fpl.form8962Percent).toBe(400);
    expect(result.applicablePercentage).toBe(1022);
    expect(result.annualRequiredContribution).toBe(652_445);
    expect(result.monthlyRequiredContribution).toBe(54_370);
  });

  it("GF#8: family of four hits the cliff at $132,000", () => {
    const four = household({
      size: 4,
      members: [adult(45), adult(43), { age: 12, seeksCoverage: true }, { age: 9, seeksCoverage: true }],
      annualIncome: USD(132_000),
    });
    expect(cliffIncomeFor(PY27, 4, "contiguous")).toBe(USD(132_000));

    const atCliff = computePtc(PY27, four, USD(26_400));
    expect(atCliff.ineligibilityReason).toBeNull();

    const overCliff = computePtc(
      PY27,
      { ...four, annualIncome: USD(132_000) + 1 },
      USD(26_400),
    );
    expect(overCliff.annualPtc).toBe(0);
    expect(overCliff.ineligibilityReason).toBe("income-above-400-percent");
  });

  it("GF#9: single at $40,000 -> 250% on Form 8962 -> 8.66% -> $288.67/mo contribution", () => {
    const benchmarkMonthly = USD(700);
    const result = computePtc(
      PY27,
      household({ annualIncome: USD(40_000) }),
      benchmarkMonthly * 12,
    );
    expect(result.fpl.form8962Percent).toBe(250);
    expect(result.applicablePercentage).toBe(866);
    expect(result.annualRequiredContribution).toBe(USD(3_464));
    expect(result.monthlyRequiredContribution).toBe(28_867);
    expect(result.annualPtc).toBe(USD(4_936));
    expect(result.monthlyPtc).toBe(41_133);
  });

  it("GF#10: single at exactly 150% FPL enters the next band at 4.30%", () => {
    const result = computePtc(PY27, household({ annualIncome: USD(23_940) }), USD(9_000));
    expect(result.fpl.form8962Percent).toBe(150);
    expect(result.applicablePercentage).toBe(430);
    expect(result.annualRequiredContribution).toBe(102_942);
    expect(result.monthlyRequiredContribution).toBe(8_579);
  });

  it("GF#11: single at $20,000 -> 125% FPL -> 2.15% -> $35.83/mo", () => {
    const result = computePtc(PY27, household({ annualIncome: USD(20_000) }), USD(9_000));
    expect(result.fpl.form8962Percent).toBe(125);
    expect(result.applicablePercentage).toBe(215);
    expect(result.annualRequiredContribution).toBe(USD(430));
    expect(result.monthlyRequiredContribution).toBe(3_583);
  });

  it("caps the credit at zero rather than going negative", () => {
    // Wealthy-but-under-cliff household with a very cheap benchmark plan.
    const result = computePtc(PY27, household({ annualIncome: USD(63_000) }), USD(2_000));
    expect(result.annualPtc).toBe(0);
    expect(result.eligible).toBe(false);
  });

  it("reports below-100%-FPL households as ineligible with the coverage-gap reason", () => {
    const result = computePtc(PY27, household({ annualIncome: USD(10_000) }), USD(9_000));
    expect(result.ineligibilityReason).toBe("income-below-minimum");
  });

  it("emits a citation-bearing derivation for every eligible result", () => {
    const result = computePtc(PY27, household(), USD(9_000));
    expect(result.workings.length).toBeGreaterThanOrEqual(5);
    expect(result.workings.some((w) => w.citation?.includes("1.36B-3(g)"))).toBe(true);
    expect(result.workings.some((w) => w.citation?.includes("Form 8962"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cliff analysis
// ---------------------------------------------------------------------------

describe("cliff analysis", () => {
  const olderCouple = household({
    size: 2,
    members: [adult(60), adult(58)],
    annualIncome: USD(80_000),
  });

  it("identifies a LIVE cliff for an older couple with an expensive benchmark", () => {
    const benchmarkAnnual = USD(2_200) * 12; // $26,400/yr
    const analysis = analyzeCliff(PY27, olderCouple, benchmarkAnnual);

    expect(analysis.cliffIncome).toBe(USD(86_560)); // 4 x $21,640
    expect(analysis.naturalPhaseOutIncome).toBeNull();
    expect(analysis.cliffIsLive).toBe(true);
    expect(analysis.cliffCost).toBeGreaterThan(0);
    expect(analysis.subsidyExitIncome).toBe(analysis.cliffIncome);

    // The discontinuity is real: nonzero credit at the cliff, zero one cent above.
    const at = ptcAtIncome(PY27, USD(86_560), 2, "contiguous", benchmarkAnnual);
    const over = ptcAtIncome(PY27, USD(86_560) + 1, 2, "contiguous", benchmarkAnnual);
    expect(at).toBe(analysis.cliffCost);
    expect(at).toBeGreaterThan(0);
    expect(over).toBe(0);
  });

  it("identifies NO live cliff for a young single with a cheap benchmark", () => {
    const young = household({ members: [adult(25)], annualIncome: USD(45_000) });
    const benchmarkAnnual = USD(300) * 12; // $3,600/yr
    const analysis = analyzeCliff(PY27, young, benchmarkAnnual);

    expect(analysis.naturalPhaseOutIncome).not.toBeNull();
    expect(analysis.naturalPhaseOutIncome!).toBeLessThan(analysis.cliffIncome!);
    expect(analysis.cliffIsLive).toBe(false);
    expect(analysis.cliffCost).toBe(0);
    expect(analysis.subsidyExitIncome).toBe(analysis.naturalPhaseOutIncome);
  });

  it("the natural phase-out point is exact to the cent", () => {
    const young = household({ members: [adult(25)], annualIncome: USD(45_000) });
    const benchmarkAnnual = USD(300) * 12;
    const { naturalPhaseOutIncome } = analyzeCliff(PY27, young, benchmarkAnnual);
    expect(naturalPhaseOutIncome).not.toBeNull();

    const exit = naturalPhaseOutIncome!;
    // Zero at the phase-out point, strictly positive one cent below it.
    expect(ptcAtIncome(PY27, exit, 1, "contiguous", benchmarkAnnual)).toBe(0);
    expect(ptcAtIncome(PY27, exit - 1, 1, "contiguous", benchmarkAnnual)).toBeGreaterThan(0);
  });

  it("computes headroom, positive below the cliff and negative above it", () => {
    const below = analyzeCliff(PY27, olderCouple, USD(26_400));
    expect(below.headroom).toBe(USD(86_560) - USD(80_000));

    const above = analyzeCliff(
      PY27,
      { ...olderCouple, annualIncome: USD(90_000) },
      USD(26_400),
    );
    expect(above.headroom).toBeLessThan(0);
    expect(above.workings.some((w) => w.label.includes("above the cliff"))).toBe(true);
  });

  it("always warns that excess-APTC repayment caps are repealed", () => {
    const analysis = analyzeCliff(PY27, olderCouple, USD(26_400));
    expect(analysis.workings.some((w) => w.label.includes("Repayment caps"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Curve
// ---------------------------------------------------------------------------

describe("PTC curve", () => {
  it("brackets the cliff so a chart renders a true vertical drop", () => {
    const couple = household({
      size: 2,
      members: [adult(60), adult(58)],
      annualIncome: USD(80_000),
    });
    const curve = buildPtcCurve(PY27, couple, USD(26_400), { steps: 60 });

    const cliff = USD(86_560);
    const atIdx = curve.findIndex((p) => p.annualIncome === cliff);
    const overIdx = curve.findIndex((p) => p.annualIncome === cliff + 1);

    expect(atIdx).toBeGreaterThanOrEqual(0);
    expect(overIdx).toBe(atIdx + 1);
    expect(curve[atIdx]!.annualPtc).toBeGreaterThan(0);
    expect(curve[overIdx]!.annualPtc).toBe(0);
    expect(curve[atIdx]!.form8962Percent).toBe(400);
    expect(curve[overIdx]!.form8962Percent).toBe(401);
  });

  it("is monotonically non-increasing in the credit", () => {
    const couple = household({
      size: 2,
      members: [adult(60), adult(58)],
      annualIncome: USD(80_000),
    });
    const curve = buildPtcCurve(PY27, couple, USD(26_400), { steps: 200 });
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.annualPtc).toBeLessThanOrEqual(curve[i - 1]!.annualPtc);
    }
  });
});

// ---------------------------------------------------------------------------
// Rating rules
// ---------------------------------------------------------------------------

describe("family rating rules", () => {
  it("rates only the three oldest children under 21 (45 CFR 147.102(c)(1))", () => {
    const members: HouseholdMember[] = [
      adult(42),
      adult(40),
      { age: 19, seeksCoverage: true },
      { age: 16, seeksCoverage: true },
      { age: 12, seeksCoverage: true },
      { age: 8, seeksCoverage: true },
      { age: 3, seeksCoverage: true },
    ];
    const { rated, excludedChildren } = selectRatedMembers(members);

    expect(rated.filter((m) => m.age < 21)).toHaveLength(3);
    expect(rated.filter((m) => m.age < 21).map((m) => m.age)).toEqual([19, 16, 12]);
    expect(excludedChildren.map((m) => m.age)).toEqual([8, 3]);
    expect(rated).toHaveLength(5); // 2 adults + 3 rated children
  });

  it("rates all adults regardless of count", () => {
    const { rated } = selectRatedMembers([adult(64), adult(62), adult(30), adult(21)]);
    expect(rated).toHaveLength(4);
  });

  it("excludes members not seeking coverage", () => {
    const { rated } = selectRatedMembers([
      adult(45),
      { age: 43, seeksCoverage: false },
    ]);
    expect(rated).toHaveLength(1);
  });

  it("honours the 3:1 age band at the verified endpoints", () => {
    expect(ageFactor(21)).toBe(1.0);
    expect(ageFactor(64)).toBe(3.0);
    expect(ageFactor(64) / ageFactor(21)).toBe(MAX_AGE_RATIO);
    expect(ageFactor(10)).toBe(0.765);
    expect(ageFactor(70)).toBe(3.0);
  });

  it("throws rather than guessing an unverified age factor", () => {
    expect(() => ageFactor(33)).toThrow(/No verified federal age-curve factor/);
  });
});

// ---------------------------------------------------------------------------
// Affordability and CSR
// ---------------------------------------------------------------------------

describe("employer coverage affordability", () => {
  it("uses 10.22% for 2027", () => {
    const result = assessAffordability(PY27, {
      annualIncome: USD(60_000),
      employeeAnnualContribution: USD(6_132), // exactly 10.22%
      providesMinimumValue: true,
    });
    expect(result.affordabilityThreshold).toBe(USD(6_132));
    expect(result.isAffordable).toBe(true);
    expect(result.barsFromPtc).toBe(true);
  });

  it("one cent above the threshold is unaffordable, restoring PTC access", () => {
    const result = assessAffordability(PY27, {
      annualIncome: USD(60_000),
      employeeAnnualContribution: USD(6_132) + 1,
      providesMinimumValue: true,
    });
    expect(result.isAffordable).toBe(false);
    expect(result.barsFromPtc).toBe(false);
  });

  it("affordable coverage without minimum value does not bar the credit", () => {
    const result = assessAffordability(PY27, {
      annualIncome: USD(60_000),
      employeeAnnualContribution: USD(1_000),
      providesMinimumValue: false,
    });
    expect(result.isAffordable).toBe(true);
    expect(result.barsFromPtc).toBe(false);
  });
});

describe("cost-sharing reductions", () => {
  it("maps FPL bands to silver variants", () => {
    expect(determineCsr(140, true).variant).toBe("csr-94");
    expect(determineCsr(150, true).variant).toBe("csr-94");
    expect(determineCsr(151, true).variant).toBe("csr-87");
    expect(determineCsr(200, true).variant).toBe("csr-87");
    expect(determineCsr(201, true).variant).toBe("csr-73");
    expect(determineCsr(250, true).variant).toBe("csr-73");
    expect(determineCsr(251, true).variant).toBe("standard-silver");
  });

  it("attaches only to silver plans", () => {
    expect(determineCsr(140, false).variant).toBe("not-eligible");
    expect(determineCsr(140, false).reason).toMatch(/only on silver/);
  });

  it("GF#15: reports the statutory actuarial values", () => {
    expect(determineCsr(140, true).actuarialValue).toBe(0.94);
    expect(determineCsr(180, true).actuarialValue).toBe(0.87);
    expect(determineCsr(230, true).actuarialValue).toBe(0.73);
  });
});

// ---------------------------------------------------------------------------
// Plan-year parameters
// ---------------------------------------------------------------------------

describe("plan year parameters", () => {
  it("records that the enhanced credits are NOT active for 2026 or 2027", () => {
    expect(PY26.enhancedCreditsActive).toBe(false);
    expect(PY27.enhancedCreditsActive).toBe(false);
    expect(PY26.maxFplPercent).toBe(400);
    expect(PY27.maxFplPercent).toBe(400);
  });

  it("GF#12: 2027 out-of-pocket maximums are $12,000 / $24,000", () => {
    expect(PY27.oopMaxSelfOnly).toBe(USD(12_000));
    expect(PY27.oopMaxFamily).toBe(USD(24_000));
    expect(PY26.oopMaxSelfOnly).toBe(USD(10_600));
    expect(PY26.oopMaxFamily).toBe(USD(21_200));
  });

  it("records that excess-APTC repayment caps are repealed", () => {
    expect(PY26.excessAptcRepaymentCapped).toBe(false);
    expect(PY27.excessAptcRepaymentCapped).toBe(false);
  });

  it("flags the PY2027 open-enrollment end date as contested", () => {
    expect(PY27.openEnrollment.end).toBeNull();
    expect(PY27.openEnrollment.publishedEnd).toBe("2027-01-15");
    expect(PY27.openEnrollment.endIsContested).toBe(true);
    expect(PY27.openEnrollment.note).toMatch(/vacated/);
    expect(PY26.openEnrollment.endIsContested).toBe(false);
  });

  it("carries provenance on every dataset", () => {
    for (const py of [PY26, PY27]) {
      expect(py.povertyGuidelines.provenance.url).toMatch(/^https:\/\//);
      expect(py.applicablePercentageTable.provenance.url).toMatch(/^https:\/\//);
      expect(py.povertyGuidelines.provenance.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(py.applicablePercentageTable.provenance.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("stamps each source with the date it was actually last read", () => {
    // The November 5 pass checked both HHS notices and the 2027 IRS schedule.
    expect(PY27.povertyGuidelines.provenance.checked).toBe("2026-11-05");
    expect(PY27.applicablePercentageTable.provenance.checked).toBe("2026-11-05");
    expect(PY26.povertyGuidelines.provenance.checked).toBe("2026-11-05");
    expect(PY26.applicablePercentageTable.provenance.checked).toBe("2026-07-27");
    // The 2027 sources are now primary-verified rather than corroborated.
    expect(PY27.povertyGuidelines.provenance.status).toBe("primary-verified");
    expect(PY27.applicablePercentageTable.provenance.status).toBe("primary-verified");
  });
});

describe("arithmetic primitives", () => {
  it("applyRate rounds to the nearest cent", () => {
    expect(applyRate(USD(63_840), 1022)).toBe(652_445); // 652444.8 -> 652445
    expect(applyRate(USD(20_000), 215)).toBe(USD(430));
    expect(applyRate(0, 1022)).toBe(0);
  });

  it("keeps every intermediate value an exact integer", () => {
    const r = computePtc(PY27, household(), USD(9_000));
    for (const v of [
      r.annualRequiredContribution,
      r.monthlyRequiredContribution,
      r.annualPtc,
      r.monthlyPtc,
      r.annualBenchmarkPremium,
    ]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
