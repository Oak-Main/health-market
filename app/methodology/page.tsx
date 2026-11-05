import type { Metadata } from "next"
import Link from "next/link"
import Image from "next/image"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { Eyebrow } from "@/components/ui/figure"
import { buttonVariants } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Methodology & sources",
  description:
    "How Subsidy Dropoff computes the ACA premium tax credit and the 400% subsidy cliff: the statute, the applicable-percentage table, the poverty guidelines, and every source with its publication date.",
}

const SECTIONS = [
  { id: "law", label: "The state of the law" },
  { id: "credit", label: "How the credit is computed" },
  { id: "cliff", label: "Where the cliff comes from" },
  { id: "data", label: "Data and its limits" },
  { id: "sources", label: "Sources" },
]

export default function MethodologyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
          <div className="mb-12 flex flex-col gap-3">
            <Eyebrow>Methodology</Eyebrow>
            <h1 className="max-w-3xl text-balance font-serif text-4xl leading-tight md:text-5xl">
              Every number on this site is a line in the tax code. Here is which one.
            </h1>
            <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground">
              The premium tax credit is federal law, not a rule of thumb. This page shows the
              statute, the tables, and the data behind each figure — and is honest about where the
              underlying data is verified and where it is not.
            </p>
          </div>

          <figure className="mb-12 md:mb-16">
            <div className="relative aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-muted">
              <Image
                src="/photos/methodology-terrain.png"
                alt="Aerial view of eroded ridgelines cut into warm rock, resembling the parallel lines of a topographic contour map."
                fill
                sizes="(max-width: 1152px) 100vw, 1104px"
                className="object-cover object-center"
              />
            </div>
            <figcaption className="mt-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              Every contour here has a source. So does every figure on this site.
            </figcaption>
          </figure>

          <div className="grid gap-12 lg:grid-cols-[220px_1fr] lg:gap-16">
            <nav aria-label="On this page" className="hidden lg:block">
              <ul className="sticky top-6 flex flex-col gap-2 border-l border-border pl-4 text-sm">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <article className="prose-cliff flex max-w-2xl flex-col gap-16">
              <Section id="law" title="The state of the law">
                <p>
                  From 2021 through 2025, the American Rescue Plan Act and then the Inflation
                  Reduction Act enhanced the premium tax credit. They removed the hard income
                  ceiling and capped what anyone paid for a benchmark plan at 8.5% of income, no
                  matter how high that income rose.
                </p>
                <p>
                  Those enhancements <strong>lapsed on December 31, 2025</strong>. Congress did not
                  extend them. With the enhancements gone, the pre-2021 structure returns: eligibility
                  ends above 400% of the federal poverty line, and the gentle 8.5% cap at the top of the
                  income range is replaced by a hard edge.
                </p>
                <Callout>
                  The dispositive administrative signal came on July 21, 2026, when the IRS issued
                  Rev. Proc. 2026-26 with an indexed applicable-percentage table for 2027 that tops
                  out at 400% FPL. Treasury does not index a table the statute has displaced. The
                  cliff is live for plan years 2026 and 2027.
                </Callout>
              </Section>

              <Section id="credit" title="How the credit is computed">
                <p>
                  The credit is the gap between the cost of a benchmark plan and what the law says
                  you should be able to afford. Four steps, each traceable:
                </p>
                <ol>
                  <li>
                    <strong>Your income as a percent of poverty.</strong> Annual MAGI divided by the
                    federal poverty line for your household size and region. For plan year 2026 this
                    uses the 2025 HHS guidelines, which govern PY2026 under 26 CFR 1.36B-1(h).
                  </li>
                  <li>
                    <strong>Your applicable percentage.</strong> A figure between 0% and 9.96% for
                    2026, read from the §36B table (Rev. Proc. 2025-25) and interpolated within your
                    bracket. This is the share of income the law expects you to contribute.
                  </li>
                  <li>
                    <strong>Your required contribution.</strong> Income times the applicable
                    percentage. This is your share of the benchmark premium.
                  </li>
                  <li>
                    <strong>The credit.</strong> The benchmark premium — the second-lowest-cost
                    silver plan for your household in your rating area — minus your required
                    contribution. Never below zero.
                  </li>
                </ol>
                <p>
                  The calculation checks the exact 400% ceiling first. For incomes at or below it,
                  Form 8962 drops the fractional part of the poverty percentage. The applicable-percentage table is stored to the hundredth of a percent.
                </p>
              </Section>

              <Section id="cliff" title="Where the cliff comes from">
                <p>
                  Below 400% of the poverty line, the required contribution rises smoothly with
                  income — earn more, pay a slightly larger share, keep a smaller credit. That is a
                  normal phase-out.
                </p>
                <p>
                  The income test includes exactly 400%. The statute reads &ldquo;not more than 400
                  percent&rdquo; — so at exactly 400% you remain eligible, and one cent more takes the
                  credit to zero. That discontinuity is the cliff. Its height is simply the credit
                  you were receiving at the edge: the whole thing, gone at once.
                </p>
                <p>
                  Subsidy Dropoff finds that income precisely for your household, reports the credit lost at
                  the edge, and measures your headroom — how much more income you can take on before
                  you reach it. Capital gains, Roth conversions, and year-end bonuses all count
                  against that headroom.
                </p>
              </Section>

              <Section id="data" title="Data and its limits">
                <p>
                  Benchmark premiums come from the CMS public use files for federally-facilitated
                  Marketplace states. Where a state runs its own exchange — California, New York,
                  and others — those premiums are not in the federal files, and those states often
                  add their own assistance on top of the federal credit. Rather than guess, Subsidy
                  Dropoff tells you so and sends you to your state Marketplace.
                </p>
                <p>
                  When a ZIP spans more than one county, rating areas can differ, so Subsidy Dropoff asks which
                  county rather than picking one. When verified local data is unavailable,
                  or a region&apos;s poverty guidelines are not independently verified, the engine
                  returns an error instead of a confident but wrong number.
                </p>
                <Callout tone="approaching">
                  The income check uses the published poverty guidelines even when a ZIP benchmark is
                  unavailable. Enter your Marketplace’s monthly benchmark for a conditional credit
                  estimate, or leave it blank to check your household’s income limits.
                </Callout>
              </Section>

              <Section id="sources" title="Sources">
                <SourceList />
              </Section>

              <div className="border-t border-border pt-8">
                <p className="text-sm text-muted-foreground">
                  This website is not the Health Insurance Marketplace and is not affiliated with the
                  U.S. government. It provides estimates only. Only the Marketplace can determine your
                  eligibility. To enroll, go to HealthCare.gov or your state&apos;s Marketplace.
                </p>
                <Link href="/plan" className={`${buttonVariants({ variant: "primary", size: "lg" })} mt-6`}>
                  Run your own estimate
                </Link>
              </div>
            </article>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-4 font-serif text-2xl md:text-3xl">{title}</h2>
      <div className="flex flex-col gap-4 leading-relaxed text-muted-foreground [&_li]:leading-relaxed [&_ol]:ml-5 [&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-3 [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  )
}

function Callout({
  children,
  tone = "accent",
}: {
  children: React.ReactNode
  tone?: "accent" | "approaching"
}) {
  const cls =
    tone === "approaching"
      ? "border-approaching/30 bg-approaching/5"
      : "border-accent/30 bg-accent/5"
  return (
    <div className={`rounded-lg border ${cls} p-5 text-sm leading-relaxed text-foreground`}>
      {children}
    </div>
  )
}

const SOURCES = [
  {
    title: "Internal Revenue Code §36B",
    detail: "The premium tax credit itself, including the 400% eligibility ceiling at §36B(c)(1)(A).",
  },
  {
    title: "26 CFR 1.36B-1(h)",
    detail: "Which year's poverty guidelines govern a plan year.",
  },
  {
    title: "IRS Rev. Proc. 2025-25",
    detail: "Plan year 2026 applicable-percentage table; 9.96% top contribution. Published July 18, 2025.",
  },
  {
    title: "IRS Rev. Proc. 2026-26",
    detail: "Plan year 2027 applicable-percentage table; 10.22% top contribution. Published July 21, 2026.",
  },
  {
    title: "HHS Poverty Guidelines (2025)",
    detail: "Govern plan year 2026. Contiguous single-person base $15,650. Published January 17, 2025.",
  },
  {
    title: "HHS Poverty Guidelines (2026), 91 FR 1797–1798",
    detail: "The regional tables govern 2027 coverage. One-person guidelines are $15,960 in the contiguous states and DC, $19,950 in Alaska, and $18,360 in Hawaii.",
  },
  {
    title: "CMS Marketplace Public Use Files",
    detail: "Benchmark and plan premiums for federally-facilitated Marketplace states.",
  },
]

function SourceList() {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {SOURCES.map((s) => (
        <li key={s.title} className="flex flex-col gap-1 p-4">
          <span className="font-mono text-sm text-foreground">{s.title}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">{s.detail}</span>
        </li>
      ))}
    </ul>
  )
}
