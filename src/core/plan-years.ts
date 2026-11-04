/**
 * Plan-year parameters with full provenance.
 *
 * This file is the single place a legislative or regulatory change lands.
 * The engine in ptc.ts / cliff.ts contains no year-specific constants.
 *
 * STATE OF THE LAW AS OF 2026-11-04
 * ---------------------------------
 * The ARPA §9661/§9663 enhanced premium tax credits, extended by IRA §12001,
 * LAPSED on 2025-12-31. Congress did not extend them:
 *   - 2025-12-11  S.3385 and S.3386 both failed to reach 60 votes in the Senate.
 *   - 2026-01-08  House passed a 3-year extension 230-196; stalled in Senate.
 *   - early 2026  Bipartisan Senate compromise collapsed over the Hyde Amendment.
 *   - 2026-07-21  IRS issued Rev. Proc. 2026-26 publishing an INDEXED §36B
 *                 applicable percentage table for 2027 topping out at 400% FPL.
 *                 Treasury does not index a table that statute has displaced;
 *                 this is the dispositive administrative signal.
 *   - 2026-10-30  The Fourth Circuit heard argument in the government's appeal
 *                 of the OE-window vacatur (No. 26-1938); no decision as of the
 *                 date below.
 *
 * 2026-11-04 RE-CHECK — WHAT CHANGED AND WHAT DID NOT
 * ---------------------------------------------------
 * Re-read from primary sources on 2026-11-04:
 *   - IRS Rev. Proc. 2026-26 §§3.01-3.02 (primary PDF): the 2027 applicable
 *     percentage table is unchanged, 2.15%..10.22%, final bracket "at least
 *     300% but not more than 400%". Required contribution percentage 10.22%.
 *   - 91 FR 1797-1798 (FR Doc. 2026-00755): the 2026 HHS poverty guidelines
 *     are now read for ALL THREE regions. Alaska and Hawaii are no longer
 *     zeroed placeholders.
 *   - Congress.gov: H.R. 1834 (the House-passed 3-year extension) still sits
 *     on the Senate calendar with no floor action; H.R. 5145 is still
 *     "Introduced" with its only action being referral to Ways and Means.
 *     No extension has become law.
 *
 * So the underlying facts did NOT move: the enhanced credits are still lapsed
 * and the 400% cliff is still live for PY2026 and PY2027. What changed is the
 * confidence in the parameters behind that finding — the 2027 table and the
 * 2026 poverty guidelines are now primary-verified rather than derived or
 * secondary-sourced.
 *
 * Therefore `enhancedCreditsActive: false` and the 400% cliff is live for both
 * PY2026 and PY2027.
 */

import type {
  ApplicablePercentageTable,
  PlanYear,
  PlanYearParameters,
  PovertyGuidelines,
} from "./types";

/**
 * Verification stamps, one per source.
 *
 * A stamp moves only when the source was actually re-read from its primary
 * document on that date — never because the file was edited. The 2025
 * guidelines and the 2026 applicable percentage table were NOT re-read on
 * 2026-11-04 and keep their earlier stamp.
 */
const CHECKED_2026_07_27 = "2026-07-27";
const CHECKED_2026_11_04 = "2026-11-04";

// ---------------------------------------------------------------------------
// HHS poverty guidelines
// ---------------------------------------------------------------------------

/**
 * 2025 HHS poverty guidelines. Govern plan year 2026 per 26 CFR 1.36B-1(h)
 * (the guidelines in effect on the first day of the PY2026 open enrollment
 * period, 2025-11-01).
 */
const FPL_2025: PovertyGuidelines = {
  guidelineYear: 2025,
  base: {
    contiguous: 1_565_000, // $15,650
    alaska: 1_955_000, // $19,550
    hawaii: 1_799_000, // $17,990
  },
  increment: {
    contiguous: 550_000, // $5,500
    alaska: 687_000, // $6,870
    hawaii: 632_000, // $6,320
  },
  provenance: {
    source: "HHS Poverty Guidelines (2025)",
    url: "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines",
    published: "2025-01-17",
    checked: CHECKED_2026_07_27,
    status: "secondary-concordant",
    note:
      "Contiguous base $15,650 corroborated by the widely reported 400% PY2026 " +
      "cliff of $62,600 for a single filer (4 x 15,650). Alaska and Hawaii " +
      "figures are carried from prior-year reporting and are NOT independently " +
      "verified for 2025; see requireVerifiedRegion().",
  },
};

/**
 * 2026 HHS poverty guidelines. Govern plan year 2027 (OE opens 2026-11-01).
 *
 * Read from the Federal Register notice itself on 2026-11-04:
 *   91 FR 1797-1798 (2026-01-15), FR Doc. 2026-00755,
 *   "Annual Update of the HHS Poverty Guidelines".
 *
 * All three regional tables are transcribed from that notice:
 *
 *   Household size   Contiguous    Alaska     Hawaii
 *   1                   $15,960   $19,950   $18,360
 *   2                   $21,640   $27,050   $24,890
 *   3                   $27,320   $34,150   $31,420
 *   4                   $33,000   $41,250   $37,950
 *   5                   $38,680   $48,350   $44,480
 *   6                   $44,360   $55,450   $51,010
 *   7                   $50,040   $62,550   $57,540
 *   8                   $55,720   $69,650   $64,070
 *   each person over 8  +$5,680   +$7,100   +$6,530
 *
 * Alaska and Hawaii are the statutory regional variants of the contiguous
 * table. This file stores each region's base (household of 1) plus a single
 * increment, which is the shape HHS publishes them in. Alaska and Hawaii are
 * no longer gated at runtime.
 */
const FPL_2026: PovertyGuidelines = {
  guidelineYear: 2026,
  base: {
    contiguous: 1_596_000, // $15,960 — 91 FR 1797
    alaska: 1_995_000, // $19,950 — 91 FR 1797
    hawaii: 1_836_000, // $18,360 — 91 FR 1797
  },
  increment: {
    contiguous: 568_000, // $5,680 per person over 4 — 91 FR 1798
    alaska: 710_000, // $7,100 per person over 4 — 91 FR 1798
    hawaii: 653_000, // $6,530 per person over 4 — 91 FR 1798
  },
  provenance: {
    source: "HHS Poverty Guidelines (2026), 91 FR 1797-1798",
    url: "https://www.federalregister.gov/documents/2026/01/15/2026-00755/annual-update-of-the-hhs-poverty-guidelines",
    published: "2026-01-15",
    checked: CHECKED_2026_11_04,
    status: "primary-verified",
    note:
      "Published 2026-01-15, effective 2026-01-13. Transcribed from the " +
      "Federal Register notice on 2026-11-04: the contiguous base and the " +
      "+$5,680 increment are now read directly rather than derived, and the " +
      "Alaska and Hawaii tables are no longer placeholders.",
  },
};

// ---------------------------------------------------------------------------
// Applicable percentage tables (§36B(b)(3)(A)(i))
// ---------------------------------------------------------------------------

/**
 * Plan year 2026 — Rev. Proc. 2025-25 (issued 2025-07-18).
 * Required contribution percentage: 9.96%.
 */
const APT_2026: ApplicablePercentageTable = {
  planYear: 2026,
  brackets: [
    { fromFplPercent: 0, toFplPercent: 133, initial: 210, final: 210 },
    { fromFplPercent: 133, toFplPercent: 150, initial: 314, final: 419 },
    { fromFplPercent: 150, toFplPercent: 200, initial: 419, final: 660 },
    { fromFplPercent: 200, toFplPercent: 250, initial: 660, final: 844 },
    { fromFplPercent: 250, toFplPercent: 300, initial: 844, final: 996 },
    { fromFplPercent: 300, toFplPercent: 401, initial: 996, final: 996 },
  ],
  provenance: {
    source: "IRS Rev. Proc. 2025-25",
    url: "https://www.irs.gov/pub/irs-drop/rp-25-25.pdf",
    published: "2025-07-18",
    checked: CHECKED_2026_07_27,
    status: "secondary-single",
    note:
      "Endpoints 2.10% and 9.96% are corroborated by multiple secondary " +
      "sources. The intermediate bracket values (3.14/4.19/6.60/8.44) are " +
      "NOT individually confirmed; they satisfy the chaining invariant " +
      "(each bracket's final equals the next bracket's initial), which is a " +
      "necessary but not sufficient check. Verify against the primary PDF.",
  },
};

/**
 * Plan year 2027 — Rev. Proc. 2026-26 (issued 2026-07-21).
 * Required contribution percentage: 10.22%.
 *
 * This is the document that settles the central policy question: an indexed
 * table with no bracket above 400% FPL means the pre-ARPA schedule governs.
 */
const APT_2027: ApplicablePercentageTable = {
  planYear: 2027,
  brackets: [
    { fromFplPercent: 0, toFplPercent: 133, initial: 215, final: 215 },
    { fromFplPercent: 133, toFplPercent: 150, initial: 323, final: 430 },
    { fromFplPercent: 150, toFplPercent: 200, initial: 430, final: 678 },
    { fromFplPercent: 200, toFplPercent: 250, initial: 678, final: 866 },
    { fromFplPercent: 250, toFplPercent: 300, initial: 866, final: 1022 },
    { fromFplPercent: 300, toFplPercent: 401, initial: 1022, final: 1022 },
  ],
  provenance: {
    source: "IRS Rev. Proc. 2026-26",
    url: "https://www.irs.gov/pub/irs-drop/rp-26-26.pdf",
    published: "2026-07-21",
    checked: CHECKED_2026_11_04,
    status: "primary-verified",
    note:
      "Read from the primary PDF (Rev. Proc. 2026-26, 2026-07-21) on " +
      "2026-11-04. Section 3.01 publishes the 2027 applicable percentage " +
      "table: 2.15% (under 133%), 3.23%/4.30% (133-150%), 4.30%/6.78% " +
      "(150-200%), 6.78%/8.66% (200-250%), 8.66%/10.22% (250-300%), and " +
      "10.22%/10.22% for 'at least 300% but not more than 400%'. Section " +
      "3.02 sets the required contribution percentage at 10.22%. The table " +
      "has no bracket above 400% of FPL, which is the dispositive signal " +
      "that the pre-ARPA schedule — and the 400% cliff — governs 2027.",
  },
};

// ---------------------------------------------------------------------------
// Plan years
// ---------------------------------------------------------------------------

const PY2026: PlanYearParameters = {
  planYear: 2026,
  enhancedCreditsActive: false,
  maxFplPercent: 400,
  minFplPercent: 100,
  povertyGuidelines: FPL_2025,
  applicablePercentageTable: APT_2026,
  requiredContributionPercentage: 996, // 9.96%
  oopMaxSelfOnly: 1_060_000, // $10,600
  oopMaxFamily: 2_120_000, // $21,200
  excessAptcRepaymentCapped: false, // OBBBA repealed §36B(f)(2) caps for TY2026+
  openEnrollment: {
    start: "2025-11-01",
    januaryFirstDeadline: "2025-12-15",
    end: "2026-01-15",
    endIsContested: false,
    note: "Completed. 23.1M plan selections, -5% year over year.",
  },
  provenance: {
    source: "Composite — see individual sub-objects",
    url: "https://www.cms.gov/marketplace/resources/data/public-use-files",
    published: "2025-07-18",
    checked: CHECKED_2026_07_27,
    status: "secondary-concordant",
  },
};

const PY2027: PlanYearParameters = {
  planYear: 2027,
  enhancedCreditsActive: false,
  maxFplPercent: 400,
  minFplPercent: 100,
  povertyGuidelines: FPL_2026,
  applicablePercentageTable: APT_2027,
  requiredContributionPercentage: 1022, // 10.22%
  oopMaxSelfOnly: 1_200_000, // $12,000
  oopMaxFamily: 2_400_000, // $24,000
  excessAptcRepaymentCapped: false,
  openEnrollment: {
    start: "2026-11-01",
    januaryFirstDeadline: "2026-12-15",
    end: null,
    endIsContested: true,
    note:
      "CONTESTED, and the published window itself is verified. HealthCare.gov " +
      "publishes the 2027 federal open enrollment period as 2026-11-01 through " +
      "2027-01-15, with 2026-12-15 the deadline for coverage starting " +
      "2027-01-01; CMS confirmed the same window on 2026-07-27. The 2025 " +
      "Marketplace Integrity and Affordability final rule (90 FR 27074) added " +
      "45 CFR 155.410(e)(5), which would have required the window to end no " +
      "later than 2026-12-15. The District of Maryland vacated that provision " +
      "on 2026-06-12 in City of Columbus v. Kennedy, No. 1:25-cv-2114 (D. Md.). " +
      "The government's appeal, 4th Cir. No. 26-1938, was argued 2026-10-30 and " +
      "is undecided as of 2026-11-04, so the closing date is not settled. Do " +
      "not hardcode an end date in UI copy.",
  },
  provenance: {
    source:
      "Composite — IRS Rev. Proc. 2026-26; 91 FR 1797-1798; HealthCare.gov; Congress.gov",
    url: "https://www.healthcare.gov/quick-guide/dates-and-deadlines",
    published: "2026-11-01",
    checked: CHECKED_2026_11_04,
    status: "primary-verified",
    note:
      "Primary sources read on 2026-11-04: Rev. Proc. 2026-26 (2027 applicable " +
      "percentage table), 91 FR 1797-1798 (2026 poverty guidelines), the " +
      "HealthCare.gov 2027 dates and deadlines page, and the Congress.gov bill " +
      "record for H.R. 1834 and H.R. 5145 (no enacted extension of the " +
      "enhanced credits).",
  },
};

const PLAN_YEARS: ReadonlyMap<PlanYear, PlanYearParameters> = new Map([
  [2026, PY2026],
  [2027, PY2027],
]);

/** Plan year currently open for enrollment planning as of the build date. */
export const CURRENT_PLAN_YEAR: PlanYear = 2026;

/** Plan year whose open enrollment is next to begin. */
export const UPCOMING_PLAN_YEAR: PlanYear = 2027;

export const SUPPORTED_PLAN_YEARS: readonly PlanYear[] = [2026, 2027];

export class UnsupportedPlanYearError extends Error {
  constructor(readonly planYear: PlanYear) {
    super(
      `Plan year ${planYear} is not configured. Supported: ${SUPPORTED_PLAN_YEARS.join(", ")}.`,
    );
    this.name = "UnsupportedPlanYearError";
  }
}

export class UnverifiedDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnverifiedDataError";
  }
}

export function getPlanYear(planYear: PlanYear): PlanYearParameters {
  const params = PLAN_YEARS.get(planYear);
  if (!params) throw new UnsupportedPlanYearError(planYear);
  return params;
}

/**
 * Reject regions whose poverty guidelines are unverified placeholders.
 *
 * Returning a confidently wrong subsidy for an Alaskan household is strictly
 * worse than returning an error. This is deliberate: the engine fails loudly
 * rather than fabricating.
 */
export function requireVerifiedRegion(
  params: PlanYearParameters,
  region: "contiguous" | "alaska" | "hawaii",
): void {
  const base = params.povertyGuidelines.base[region];
  const increment = params.povertyGuidelines.increment[region];
  if (base <= 0 || increment <= 0) {
    throw new UnverifiedDataError(
      `Poverty guidelines for region "${region}" are not populated for plan year ` +
        `${params.planYear} (guideline year ${params.povertyGuidelines.guidelineYear}). ` +
        `Load the verified HHS table before computing for this region. ` +
        `Source: ${params.povertyGuidelines.provenance.url}`,
    );
  }
}

export { PY2026, PY2027, FPL_2025, FPL_2026, APT_2026, APT_2027 };
