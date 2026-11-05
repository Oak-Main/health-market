import enrollment from "../public/oe-window.json"
import Link from "next/link"
import Image from "next/image"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { Hero } from "@/components/landing/hero"
import { Stakes } from "@/components/landing/stakes"
import { LiveDemo } from "@/components/landing/live-demo"
import { Trust } from "@/components/landing/trust"
import { CliffDivider } from "@/components/cliff-mark"
import { buttonVariants } from "@/components/ui/button"

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <section id="oe" className="mx-auto max-w-6xl space-y-3 px-6 py-8 text-sm">
          <h2 className="font-serif text-2xl">2027 Marketplace enrollment</h2>
          <p>{enrollment.datesSummary}</p>
          <p>{enrollment.ruleStatus}</p>
          <p>{enrollment.stateNote} <a className="underline" href={enrollment.stateSource}>Find your Marketplace</a>.</p>
          <p><a className="underline" href="/index.html#income-check">Check your household’s federal income limits</a></p>
          <p><a className="underline" href={enrollment.primarySource}>HealthCare.gov deadlines</a>
            {" · "}<a className="underline" href={enrollment.sources.courtOrder}>Court order</a>
            {" · "}<a className="underline" href={enrollment.sources.oralArgument}>Fourth Circuit argument</a></p>
        </section>
        <Stakes />
        <div id="demo" className="scroll-mt-16">
          <LiveDemo />
        </div>
        <Trust />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden border-t border-border bg-ink text-ink-foreground">
      <Image
        src="/photos/cta-cliff.png"
        alt=""
        fill
        sizes="100vw"
        aria-hidden
        className="object-cover object-center opacity-40"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/40" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
        <CliffDivider className="mb-12 h-6 w-full text-ink-foreground/25" />
        <div className="flex flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-2xl text-balance font-serif text-3xl leading-tight md:text-5xl">
            Find the edge before you walk over it.
          </h2>
          <Link href="/plan" className={buttonVariants({ variant: "onDark", size: "lg" })}>
            Find my cliff
          </Link>
        </div>
      </div>
    </section>
  )
}
