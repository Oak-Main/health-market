"use client"

import Link from "next/link"
import { AlertTriangle, ArrowUpRight, ChevronRight, MapPin } from "lucide-react"
import type { EstimateResponse, EstimateResult, Unavailable, WorkingStep } from "@/lib/estimate"
import { CliffChart } from "@/components/cliff-chart"
import { Figure } from "@/components/ui/figure"
import { formatCents, formatCentsWhole } from "@/lib/format"

interface PlanResultsProps {
  response: EstimateResponse
  /** The income the user submitted, in dollars, for the chart marker. */
  income: number
  onSelectCounty?: (fips: string) => void
}

export function PlanResults({ response, income, onSelectCounty }: PlanResultsProps) {
  if (!response.ok || !response.result) {
    return (
      <UnavailableView
        unavailable={response.unavailable}
        onSelectCounty={onSelectCounty}
      />
    )
  }
  return <SuccessView result={response.result} income={income} response={response} />
}

function SuccessView({
  result,
  income,
  response,
}: {
  result: EstimateResult
  income: number
  response: EstimateResponse
}) {
  const { cliff, ptc, csr, location } = result
  const ineligible = !ptc.eligible
  const isSynthetic = (response.provenance.benchmarkSource ?? "").includes("SYNTHETIC")

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" aria-hidden />
          ZIP {location.zip}
        </span>
        <span aria-hidden>·</span>
        <span>County {location.countyFips}</span>
        <span aria-hidden>·</span>
        <span>{location.ratingAreaId ? location.ratingAreaId : "Rating area"}</span>
        <span aria-hidden>·</span>
        <span>Plan year {response.planYear}</span>
      </header>

      {ineligible ? (
        <div className="rounded-lg border border-approaching/40 bg-approaching/5 p-5">
          <p className="flex items-center gap-2 font-medium text-approaching">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            No premium tax credit at this income
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {ptc.ineligibilityReason ?? "This household does not qualify for a credit."}
          </p>
        </div>
      ) : null}

      {/* Headline figures. */}
      <div className="grid gap-6 rounded-lg border border-border bg-card p-6 sm:grid-cols-3 md:p-8">
        <Figure
          label="Monthly subsidy today"
          value={ptc.eligible ? `${formatCents(ptc.monthlyPtc)}` : "$0"}
          tone={ptc.eligible ? "accent" : "default"}
          sub={ptc.eligible ? `${formatCentsWhole(ptc.annualPtc)} for the year` : "No credit applies"}
        />
        <Figure
          label="Your cliff sits at"
          value={cliff.cliffIncome != null ? formatCentsWhole(cliff.cliffIncome) : "—"}
          tone={cliff.cliffIsLive ? "over" : "default"}
          sub={
            cliff.cliffIsLive
              ? "400% of the federal poverty line"
              : "No live cliff at your income"
          }
        />
        <Figure
          label={cliff.cliffIsLive ? "Cost of crossing it" : "Headroom to the cliff"}
          value={
            cliff.cliffIsLive
              ? `${formatCentsWhole(cliff.cliffCost)}`
              : cliff.headroom != null
                ? formatCentsWhole(cliff.headroom)
                : "—"
          }
          tone={cliff.cliffIsLive ? "over" : "safe"}
          sub={cliff.cliffIsLive ? "Subsidy lost in one dollar" : "Before the credit phases out"}
        />
      </div>

      {/* Chart. */}
      {result.curve && result.curve.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 md:p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Your subsidy across income
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatCents(result.benchmark.monthlySlcsp)} benchmark / mo
            </span>
          </div>
          <CliffChart
            curve={result.curve}
            cliffIncome={cliff.cliffIncome}
            currentIncome={income}
            currentAnnualPtc={ptc.annualPtc}
            className="h-[320px] w-full md:h-[400px]"
          />
        </div>
      ) : null}

      {/* CSR callout for lower incomes. */}
      {csr.variant !== "standard-silver" && csr.variant !== "none" ? (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-5">
          <p className="font-medium text-foreground">
            You also qualify for cost-sharing reductions
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{csr.reason}</p>
        </div>
      ) : null}

      {/* Workings — the statute, shown. */}
      <Workings title="How the credit is computed" steps={ptc.workings} />
      <Workings title="How the cliff is found" steps={cliff.workings} />

      <Provenance response={response} isSynthetic={isSynthetic} />
    </div>
  )
}

function Workings({ title, steps }: { title: string; steps: WorkingStep[] }) {
  if (!steps || steps.length === 0) return null
  return (
    <details className="group rounded-lg border border-border bg-card" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 font-medium">
        {title}
        <ChevronRight
          className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <ol className="border-t border-border">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-4 border-b border-border px-6 py-4 last:border-b-0">
            <span className="tabular mt-0.5 font-mono text-xs text-muted-foreground">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-foreground">{step.label}</span>
              <span className="text-sm leading-relaxed text-muted-foreground">{step.detail}</span>
              {step.citation ? (
                <span className="mt-1 font-mono text-xs text-muted-foreground/80">{step.citation}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </details>
  )
}

function Provenance({
  response,
  isSynthetic,
}: {
  response: EstimateResponse
  isSynthetic: boolean
}) {
  const p = response.provenance
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-5 text-xs leading-relaxed text-muted-foreground">
      <p className="font-mono uppercase tracking-widest text-muted-foreground">Provenance</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <ProvRow label="Applicable %" value={`${p.applicablePercentageTable.source} (${p.applicablePercentageTable.published})`} />
        <ProvRow label="Poverty guidelines" value={`${p.povertyGuidelines.source} (${p.povertyGuidelines.published})`} />
        <ProvRow label="Benchmark data" value={p.benchmarkSource ?? p.benchmarkProvider} />
        <ProvRow label="Enhanced credits" value={p.enhancedCreditsActive ? "active" : "expired"} />
      </dl>
      {isSynthetic ? (
        <p className="mt-4 rounded-md border border-approaching/30 bg-approaching/5 px-3 py-2 text-approaching">
          This estimate uses synthetic benchmark premiums for demonstration. The tax
          arithmetic is exact; the premium amounts are invented, not real CMS figures.
        </p>
      ) : null}
      <p className="mt-4">{response.disclaimer}</p>
    </div>
  )
}

function ProvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1">
      <dt>{label}</dt>
      <dd className="tabular text-right text-foreground">{value}</dd>
    </div>
  )
}

function UnavailableView({
  unavailable,
  onSelectCounty,
}: {
  unavailable?: Unavailable
  onSelectCounty?: (fips: string) => void
}) {
  if (!unavailable) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-muted-foreground">No estimate could be produced.</p>
      </div>
    )
  }

  if (unavailable.reason === "ambiguous-zip" && unavailable.candidateCounties) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 md:p-8">
        <p className="font-serif text-2xl">Which county?</p>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
          {unavailable.message}
        </p>
        <ul className="mt-6 flex flex-col gap-2">
          {unavailable.candidateCounties.map((c) => (
            <li key={c.fips}>
              <button
                type="button"
                onClick={() => onSelectCounty?.(c.fips)}
                className="flex w-full items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-left text-sm transition-colors hover:border-accent hover:bg-muted"
              >
                <span>
                  <span className="font-medium text-foreground">{c.name} County</span>
                  <span className="text-muted-foreground">, {c.state}</span>
                </span>
                <span className="tabular flex items-center gap-2 text-xs text-muted-foreground">
                  FIPS {c.fips}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (unavailable.reason === "state-based-exchange") {
    return (
      <div className="rounded-lg border border-safe/40 bg-safe/5 p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-widest text-safe">
          State-based Marketplace
        </p>
        <p className="mt-3 font-serif text-2xl leading-snug">
          Your state runs its own exchange.
        </p>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {unavailable.message}
        </p>
        {unavailable.exchangeUrl ? (
          <a
            href={unavailable.exchangeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
          >
            Continue to {unavailable.exchangeName}
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
      </div>
    )
  }

  // plan-year-not-published, unknown-zip, dataset-not-loaded
  return (
    <div className="rounded-lg border border-border bg-card p-6 md:p-8">
      <p className="flex items-center gap-2 font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-approaching" aria-hidden />
        We can&apos;t estimate this one
      </p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        {unavailable.message}
      </p>
      <Link
        href="/methodology#data"
        className="mt-4 inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        Why does this happen?
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  )
}
