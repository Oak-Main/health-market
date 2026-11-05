/**
 * Domain types for the ACA premium tax credit engine.
 *
 * MONEY REPRESENTATION
 * --------------------
 * All monetary values are integer **cents**. Never floats. Premium tax credit
 * math involves repeated multiplication by percentages and comparison against
 * statutory thresholds where a sub-cent drift changes an eligibility outcome
 * (see the 400% FPL cliff). Integer cents make every intermediate value exact
 * and every comparison total.
 *
 * PERCENTAGE REPRESENTATION
 * -------------------------
 * Applicable percentages are stored as integer **hundredths of one percent**
 * ("centipercent"), because 26 CFR 1.36B-3(g) requires the applicable
 * percentage to be "rounded to the nearest one-hundredth of one percent".
 * 8.69% is stored as 869. This makes the statutory rounding exact rather than
 * a float artifact.
 */

/** Integer cents. */
export type Cents = number;

/** Integer hundredths of one percent. 869 === 8.69%. */
export type CentiPercent = number;

/** Plan year, e.g. 2027. */
export type PlanYear = number;

/**
 * Poverty-guideline region. HHS publishes three separate tables.
 * @see https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines
 */
export type FplRegion = "contiguous" | "alaska" | "hawaii";

/**
 * How much we trust a datum.
 *
 * This is surfaced through the API on every response. It is the product's
 * differentiation implemented as a type: we show our work, including the
 * parts we could not verify.
 */
export type VerificationStatus =
  /** Read from the primary government document. */
  | "primary-verified"
  /** Two or more independent secondary sources agree; primary not read. */
  | "secondary-concordant"
  /** Single secondary source; treat as provisional. */
  | "secondary-single"
  /** Computed from other values in this repo, not independently sourced. */
  | "derived"
  /** Placeholder that must be replaced before production use. */
  | "unverified-placeholder";

export interface Provenance {
  readonly source: string;
  readonly url: string;
  /** ISO-8601 date the source document was published or last updated. */
  readonly published: string;
  /** ISO-8601 date this repo last checked the source. */
  readonly checked: string;
  readonly status: VerificationStatus;
  readonly note?: string;
}

/** One bracket of the §36B(b)(3)(A)(i) applicable percentage table. */
export interface ApplicablePercentageBracket {
  /** Inclusive lower bound, whole percent of FPL. */
  readonly fromFplPercent: number;
  /**
   * Exclusive upper bound, whole percent of FPL. The final bracket is
   * inclusive of 400 — see `PlanYearParameters.maxFplPercent`.
   */
  readonly toFplPercent: number;
  readonly initial: CentiPercent;
  readonly final: CentiPercent;
}

export interface ApplicablePercentageTable {
  readonly planYear: PlanYear;
  readonly brackets: readonly ApplicablePercentageBracket[];
  readonly provenance: Provenance;
}

export interface PovertyGuidelines {
  /** Calendar year of the HHS guidelines (NOT the plan year they govern). */
  readonly guidelineYear: number;
  /** First-person amount by region. */
  readonly base: Readonly<Record<FplRegion, Cents>>;
  /** Per-additional-person increment by region. */
  readonly increment: Readonly<Record<FplRegion, Cents>>;
  readonly provenance: Provenance;
}

/** Everything that varies by plan year. Legislative change = edit this, not the engine. */
export interface PlanYearParameters {
  readonly planYear: PlanYear;
  /**
   * Whether the ARPA/IRA enhanced premium tax credits are in effect.
   *
   * When false (the law as of 2026-11-04 for plan years 2026 and 2027), the
   * pre-ARPA §36B schedule applies: the applicable percentage table below is
   * used verbatim and there is a hard eligibility cliff at 400% FPL.
   *
   * When true, the enhanced schedule applies and `maxFplPercent` is null.
   */
  readonly enhancedCreditsActive: boolean;
  /**
   * Upper eligibility bound as a percent of FPL, or null if there is no cap
   * (i.e. enhanced credits in effect). 400 means "not more than 400%".
   */
  readonly maxFplPercent: number | null;
  /** Lower eligibility bound as a percent of FPL. */
  readonly minFplPercent: number;
  /**
   * The HHS poverty guidelines that govern this plan year. Per
   * 26 CFR 1.36B-1(h) this is the table in effect on the first day of the
   * plan year's open enrollment period — so PY2027 uses the 2026 guidelines.
   */
  readonly povertyGuidelines: PovertyGuidelines;
  readonly applicablePercentageTable: ApplicablePercentageTable;
  /** §36B(c)(2)(C)(i)(II) employer-coverage affordability threshold. */
  readonly requiredContributionPercentage: CentiPercent;
  /** Maximum annual limitation on cost sharing, self-only. */
  readonly oopMaxSelfOnly: Cents;
  /** Maximum annual limitation on cost sharing, other than self-only. */
  readonly oopMaxFamily: Cents;
  /**
   * Whether excess-APTC repayment is capped under §36B(f)(2). OBBBA repealed
   * the caps for taxable years beginning after 2025-12-31.
   */
  readonly excessAptcRepaymentCapped: boolean;
  readonly openEnrollment: OpenEnrollmentWindow;
  readonly provenance: Provenance;
}

export interface OpenEnrollmentWindow {
  /** ISO date, federal platform. */
  readonly start: string;
  /** ISO date: last day to enroll for coverage effective Jan 1. */
  readonly januaryFirstDeadline: string;
  /** Settled closing date. Null while contested; publishedEnd carries the current federal date. */
  readonly end: string | null;
  /** Currently published closing date, read together with endIsContested and note. */
  readonly publishedEnd: string;
  readonly endIsContested: boolean;
  readonly note?: string;
}

/** A person in the coverage household. */
export interface HouseholdMember {
  /** Age as of the date coverage begins. */
  readonly age: number;
  /** Whether this member is applying for coverage (vs. counted for household size only). */
  readonly seeksCoverage: boolean;
  readonly usesTobacco?: boolean;
}

export interface Household {
  /**
   * Tax-household size for FPL purposes. May exceed the number of members
   * seeking coverage (e.g. a dependent covered by another plan).
   */
  readonly size: number;
  readonly members: readonly HouseholdMember[];
  /** Modified adjusted gross income for the coverage year. */
  readonly annualIncome: Cents;
  readonly region: FplRegion;
}

export interface FplResult {
  /** The 100%-of-FPL amount for this household size and region. */
  readonly fplAmount: Cents;
  /** Unrounded ratio, income / FPL. For display and diagnostics only. */
  readonly exactRatio: number;
  /**
   * Household income as a percent of FPL per Form 8962 line 5: discard the
   * fractional part, or 401 when income exceeds 4x FPL.
   */
  readonly form8962Percent: number;
  /** True when income > 4 x FPL (the raw test, performed before rounding). */
  readonly exceedsFourTimesFpl: boolean;
  readonly guidelineYear: number;
}

export type IneligibilityReason =
  | "income-above-400-percent"
  | "income-below-minimum"
  | "no-members-seeking-coverage"
  | "benchmark-unavailable";

export interface PtcResult {
  readonly planYear: PlanYear;
  readonly eligible: boolean;
  readonly ineligibilityReason: IneligibilityReason | null;
  readonly fpl: FplResult;
  /** The applicable percentage after statutory rounding. */
  readonly applicablePercentage: CentiPercent;
  /** Annual required contribution: income x applicable percentage. */
  readonly annualRequiredContribution: Cents;
  readonly monthlyRequiredContribution: Cents;
  /** Second-lowest-cost silver plan premium for this household, annual. */
  readonly annualBenchmarkPremium: Cents;
  readonly monthlyBenchmarkPremium: Cents;
  /** The credit itself: max(0, benchmark - required contribution). */
  readonly annualPtc: Cents;
  readonly monthlyPtc: Cents;
  /** Step-by-step derivation for the "show your work" UI. */
  readonly workings: readonly WorkingStep[];
}

export interface WorkingStep {
  readonly label: string;
  readonly detail: string;
  readonly citation?: string;
}

export interface CliffAnalysis {
  readonly planYear: PlanYear;
  /**
   * The income at which the 400% FPL cliff sits: exactly 4 x FPL. One cent
   * above this, the credit is zero. Null when no cliff exists (enhanced
   * credits in effect).
   */
  readonly cliffIncome: Cents | null;
  /**
   * The income at which the credit first reaches zero through the ordinary
   * sliding scale, if that happens *below* the cliff. For households whose
   * benchmark premium is small relative to income, the credit phases out
   * naturally before 400% FPL and the cliff is irrelevant.
   */
  readonly naturalPhaseOutIncome: Cents | null;
  /**
   * The income at which this household actually stops receiving any credit:
   * min(cliffIncome, naturalPhaseOutIncome).
   */
  readonly subsidyExitIncome: Cents | null;
  /** True when crossing 400% FPL destroys a nonzero credit. */
  readonly cliffIsLive: boolean;
  /** The annual credit lost by crossing the cliff by one cent. */
  readonly cliffCost: Cents;
  /** Current income's distance below the cliff. Negative when already above. */
  readonly headroom: Cents | null;
  readonly workings: readonly WorkingStep[];
}

export interface AffordabilityResult {
  readonly planYear: PlanYear;
  readonly thresholdPercentage: CentiPercent;
  /** Maximum annual employee contribution that is still "affordable". */
  readonly affordabilityThreshold: Cents;
  readonly employeeAnnualContribution: Cents;
  readonly isAffordable: boolean;
  /**
   * When employer coverage is affordable AND provides minimum value, the
   * household is barred from the premium tax credit entirely.
   */
  readonly barsFromPtc: boolean;
}

/** Cost-sharing reduction silver variant. */
export type CsrVariant = "csr-94" | "csr-87" | "csr-73" | "standard-silver" | "not-eligible";

export interface CsrResult {
  readonly variant: CsrVariant;
  readonly actuarialValue: number | null;
  readonly reason: string;
}
