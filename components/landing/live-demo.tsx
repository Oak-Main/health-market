import { UnverifiedDataError } from "@/src/core/plan-years"
import { runEstimate } from "@/lib/server-estimate"
import type { EstimateResult } from "@/lib/estimate"
import { CliffChart } from "@/components/cliff-chart"
import { Eyebrow, Figure } from "@/components/ui/figure"
import { formatCents, formatCentsWhole, formatDollars } from "@/lib/format"
import { buttonVariants } from "@/components/ui/button"
import Link from "next/link"

const DEMO = {
  planYear: 2026,
  zip: "77002",
  householdSize: 2,
  income: 80000,
  ages: [60, 58],
} as const

export async function LiveDemo() {
  const response = await runEstimate({ ...DEMO, includeCurve: true }).catch((error: unknown) => {
    if (error instanceof UnverifiedDataError) {
      console.warn("Worked-example benchmark unavailable:", error.message)
      return null
    }
    throw error
  })
  if (!response?.ok || !response.result) {
    return <p className="mx-auto max-w-6xl px-6 py-8">The calculator could not produce a verified estimate for this example.</p>
  }
  const result = response.result as EstimateResult
  const { cliff, ptc } = result
  const isSynthetic = (response.provenance.benchmarkSource ?? "").includes("SYNTHETIC")

  return (
    <section className="border-t border-border bg-card" aria-labelledby="demo-heading">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="flex flex-col gap-3">
          <Eyebrow>A worked example</Eyebrow>
          <h2
            id="demo-heading"
            className="max-w-2xl text-balance font-serif text-3xl leading-tight md:text-4xl"
          >
            A married couple, ages {DEMO.ages[0]} and {DEMO.ages[1]}, in Harris County, Texas.
          </h2>
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            They earn {formatDollars(DEMO.income)} a year. Here is where their premium tax
            credit falls to zero, and what the last dollar of income would cost them. Every
            figure below is computed by the same engine that powers the estimator.
          </p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <div className="order-2 lg:order-1">
            <div className="rounded-lg border border-border bg-background p-4 md:p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Subsidy vs. income
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDollars(ptc.annualBenchmarkPremium / 100)} benchmark
                </span>
              </div>
              <CliffChart
                curve={result.curve ?? []}
                cliffIncome={cliff.cliffIncome}
                currentIncome={DEMO.income}
                currentAnnualPtc={ptc.annualPtc}
                className="h-[300px] w-full md:h-[360px]"
              />
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
                <LegendSwatch className="bg-accent" label="Annual subsidy" />
                <LegendSwatch className="bg-over" label="What you pay" dashed />
                <span>
                  Shaded band marks the approach to the cliff at{" "}
                  <span className="tabular text-foreground">
                    {cliff.cliffIncome != null ? formatCentsWhole(cliff.cliffIncome) : "—"}
                  </span>
                  .
                </span>
              </div>
            </div>
          </div>

          <div className="order-1 flex flex-col gap-8 lg:order-2">
            <Figure
              label="Today's monthly subsidy"
              value={`${formatCents(ptc.monthlyPtc)}/mo`}
              tone="accent"
              sub={`${formatCentsWhole(ptc.annualPtc)} for the year, at ${(ptc.fpl.form8962Percent)}% of the poverty line.`}
            />
            <div className="h-px w-full bg-border" />
            <Figure
              label="The cliff sits at"
              value={cliff.cliffIncome != null ? formatCentsWhole(cliff.cliffIncome) : "—"}
              tone="over"
              sub={`${cliff.headroom != null ? formatCentsWhole(cliff.headroom) : "—"} of headroom above today's income.`}
            />
            <div className="h-px w-full bg-border" />
            <Figure
              label="Cost of crossing it"
              value={`${formatCentsWhole(cliff.cliffCost)}/yr`}
              tone="over"
              sub="The subsidy lost the instant income exceeds the line by one cent."
            />
            <Link
              href={`/plan?zip=${DEMO.zip}&household=${DEMO.householdSize}&income=${DEMO.income}&ages=${DEMO.ages.join(",")}`}
              className={buttonVariants({ variant: "primary", size: "lg" })}
            >
              Run this with your own numbers
            </Link>
          </div>
        </div>

        {isSynthetic ? (
          <p className="mt-10 rounded-md border border-approaching/30 bg-approaching/5 px-4 py-3 font-mono text-xs leading-relaxed text-approaching">
            Demonstration data. This deployment serves a synthetic benchmark fixture
            (provenance: {response.provenance.benchmarkSource}), so premiums are invented.
            The tax math is exact; the underlying premiums are not real CMS figures.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function LegendSwatch({
  className,
  label,
  dashed,
}: {
  className?: string
  label: string
  dashed?: boolean
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {dashed ? (
        <span className="inline-block h-0 w-4 border-t-2 border-dashed border-over" aria-hidden />
      ) : (
        <span className={`inline-block h-2 w-4 rounded-sm ${className}`} aria-hidden />
      )}
      {label}
    </span>
  )
}
