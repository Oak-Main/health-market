/**
 * Client-side types and fetch wrapper for the estimate API.
 *
 * These mirror the engine's response shape (see src/api/handler.ts and
 * src/core/types.ts). Money is integer cents; applicablePercentage is integer
 * hundredths of a percent.
 */

export interface WorkingStep {
  label: string
  detail: string
  citation?: string
}

export interface CurvePoint {
  annualIncome: number
  fplPercent: number
  annualPtc: number
  annualRequiredContribution: number
  annualNetPremium: number
}

export interface EstimateResult {
  location: {
    zip: string
    countyFips: string
    ratingAreaId: string
    region: "contiguous" | "alaska" | "hawaii"
  }
  benchmark: {
    monthlySlcsp: number
    annualSlcsp: number
    monthlyLcbp: number | null
    slcspPlanId: string | null
  }
  ptc: {
    planYear: number
    eligible: boolean
    ineligibilityReason: string | null
    fpl: {
      fplAmount: number
      exactRatio: number
      form8962Percent: number
      exceedsFourTimesFpl: boolean
      guidelineYear: number
    }
    applicablePercentage: number
    annualRequiredContribution: number
    monthlyRequiredContribution: number
    annualBenchmarkPremium: number
    monthlyBenchmarkPremium: number
    annualPtc: number
    monthlyPtc: number
    workings: WorkingStep[]
  }
  cliff: {
    planYear: number
    cliffIncome: number | null
    naturalPhaseOutIncome: number | null
    subsidyExitIncome: number | null
    cliffIsLive: boolean
    cliffCost: number
    headroom: number | null
    workings: WorkingStep[]
  }
  csr: {
    variant: string
    actuarialValue: number | null
    reason: string
  }
  affordability: unknown
  curve?: CurvePoint[]
}

export interface Provenance {
  applicablePercentageTable: {
    source: string
    url: string
    published: string
    status: string
    note?: string
  }
  povertyGuidelines: {
    source: string
    url: string
    published: string
    status: string
    note?: string
  }
  enhancedCreditsActive: boolean
  openEnrollment: {
    start: string
    januaryFirstDeadline: string
    end: string | null
    publishedEnd?: string
    endIsContested: boolean
    note?: string
  }
  benchmarkProvider: string
  benchmarkSource?: string
  benchmarkPublished?: string
}

export interface Unavailable {
  kind: "unavailable"
  reason:
    | "plan-year-not-published"
    | "ambiguous-zip"
    | "unknown-zip"
    | "state-based-exchange"
    | "dataset-not-loaded"
  message: string
  candidateCounties?: { fips: string; name: string; state: string }[]
  exchangeUrl?: string
  exchangeName?: string
}

export interface EstimateResponse {
  ok: boolean
  planYear: number
  asOf: string
  result?: EstimateResult
  unavailable?: Unavailable
  provenance: Provenance
  disclaimer: string
}

export interface ValidationProblem {
  field: string
  message: string
}

export interface ProblemResponse {
  ok: false
  error: string
  problems?: ValidationProblem[]
  message?: string
}

export interface EstimateInput {
  planYear: number
  zip: string
  countyFips?: string
  householdSize: number
  income: number
  ages: number[]
  includeCurve?: boolean
}

export type FetchOutcome =
  | { status: 200; body: EstimateResponse }
  | { status: 422; body: EstimateResponse }
  | { status: 400 | 503 | 500; body: ProblemResponse }

/** Query the estimate API. Returns the parsed body plus HTTP status. */
export async function fetchEstimate(
  input: EstimateInput,
  signal?: AbortSignal,
): Promise<FetchOutcome> {
  const res = await fetch("/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
  const body = await res.json()
  return { status: res.status as never, body }
}
