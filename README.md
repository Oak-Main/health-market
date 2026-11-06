# Subsidy Dropoff — ACA 400% FPL Cliff Planner

**subsidydropoff.com** · deploy runbook: [`DEPLOY.md`](DEPLOY.md)

A subsidy engine and data spine for the ACA individual marketplace, built around the
question no existing tool answers: **at exactly what income does your premium tax
credit disappear, and what does crossing that line cost you?**

Background and the GO/NO-GO analysis that produced this design:
[`research/aca-subsidy-estimator-go-no-go.md`](research/aca-subsidy-estimator-go-no-go.md).

---

## State of the law (as of 2026-11-04)

The ARPA/IRA **enhanced premium tax credits lapsed on 2025-12-31 and were not
extended.** Re-checked against Congress.gov on 2026-11-04: the House-passed
3-year extension (H.R. 1834) is still sitting on the Senate calendar and
H.R. 5145 is still "Introduced" — no extension has become law. The pre-ARPA
§36B schedule governs plan years 2026 and 2027, which means:

- A hard eligibility **cliff at 400% FPL** — one cent over and the credit is `$0`,
  not a reduced amount.
- **Excess-APTC repayment caps are repealed** (OBBBA), so underestimating income now
  means repaying 100% of the excess with no ceiling, starting with the 2026 return.

The controlling document is **[IRS Rev. Proc. 2026-26](https://www.irs.gov/pub/irs-drop/rp-26-26.pdf)**
(issued 2026-07-21), which publishes an *indexed* applicable percentage table for 2027
running 2.15% → 10.22% with no bracket above 400% FPL. Treasury does not index a table
that statute has displaced.

---

## Quick start

```bash
npm install
npm test          # 117 tests
npm run typecheck
npm run dev -- --synthetic   # serves public/ + the API on :8788
```

```bash
curl "http://localhost:8788/api/estimate?planYear=2026&zip=77002&householdSize=2&income=80000&ages=60,58"
```

A 60/58 couple at $80,000 in Houston: **$4,600 of headroom, and crossing it costs
$17,501.88 a year.** That single sentence is the product.

---

## Architecture

```
src/core/       Pure, isomorphic subsidy engine. No I/O, no dependencies.
  plan-years.ts   ALL year-specific constants live here, with provenance.
  fpl.ts          Form 8962 line 5 semantics.
  applicable-percentage.ts  §36B table + statutory rounding.
  ptc.ts          The credit itself, with a step-by-step derivation.
  cliff.ts        Cliff vs. natural phase-out. The differentiating logic.
  rating.ts       Family rating rules; federal age curve.
src/data/       Benchmark shards, state-exchange routing, loaders.
src/etl/        CMS public use file ingestion. Pure transforms in build.ts.
src/api/        Transport-agnostic handler + WHATWG adapter.
functions/      Cloudflare Pages Function entry point.
```

`src/core` runs unchanged in a Worker, in Node, and in the browser. Running it in the
browser is the point: **no income figure ever has to leave the user's device.**

### Two ways the credit ends — and why it matters

Most calculators model only the cliff. There are two exits:

1. **Natural phase-out** — the required contribution grows with income until it exceeds
   the benchmark premium. A young single filer in a cheap rating area hits this well
   below 400% FPL and has *no cliff to fall off*. Managing income down buys them nothing.
2. **The cliff** — for older households and expensive areas, a large credit survives
   right up to 400% FPL. For these people one dollar is catastrophic.

Telling those two cases apart requires the household's actual local benchmark premium,
which is exactly what a language model cannot fabricate. `analyzeCliff()` returns both,
and `buildPtcCurve()` deliberately emits the points at `cliff` and `cliff + 1 cent` so a
chart renders a true vertical drop rather than a smoothed ramp.

### The invariant that makes the dataset small

Every plan in a state is rated off the same age curve (45 CFR 147.102), so the *identity*
of the second-lowest-cost silver plan does not depend on household composition. That lets
us precompute one benchmark plan per county with its full age-rate table, and price any
household exactly.

The ETL **asserts** this rather than assuming it: `checkCompositionInvariance()` re-derives
the benchmark at several household shapes and **skips the county with a warning** if the
ranking ever differs.

---

## Design rules

**Integer cents everywhere.** Never floats. A sub-cent drift changes an eligibility
outcome at the cliff. Percentages are integer hundredths-of-one-percent so the
`1.36B-3(g)` rounding is exact.

**Fail loudly, never fabricate.** Where data is missing or unverified the engine returns
a typed reason, not an estimate:

| Situation | Behaviour |
|---|---|
| Local ZIP benchmark unavailable | `dataset-not-loaded`. Use the income check or enter your Marketplace benchmark |
| ZIP spans several counties | `ambiguous-zip` + the candidate list — never a guess |
| State runs its own exchange | `state-based-exchange` + a link to the right one |
| Alaska / Hawaii poverty guidelines | Verified regional income ranges and contribution calculations |
| No silver plan in a county | `null` benchmark — never a substituted metal |

A confidently wrong subsidy is far worse than an honest gap, and with repayment caps
repealed the cost of a wrong number falls entirely on the user.

**Provenance is a first-class type.** Every dataset carries a `VerificationStatus`
(`primary-verified` … `unverified-placeholder`) that flows through the API into the UI.
Showing the work is both the differentiation and the compliance posture.

---

## Data

All CMS sources are US Government works in the public domain (17 U.S.C. §105).

| Source | Use | Licence |
|---|---|---|
| [Exchange PUFs](https://www.cms.gov/marketplace/resources/data/public-use-files) (Rate, Plan Attributes, Service Area) | Per-age rates → exact benchmarks | Public domain |
| [QHP Landscape files](https://data.healthcare.gov/qhp-landscape-files) | County→plan mapping | Public domain |
| [SLCSP County-ZIP reference](https://data.healthcare.gov/dataset/yaaf-rjhy) | ZIP→county crosswalk | Public domain |
| [CMS Marketplace API](https://developer.cms.gov/marketplace-api) | **Spot verification only** | Key required, rotates every 60 days, rate limited; CMS states it is *"not designed to be scraped"* — do not use it to populate the dataset |

```bash
npm run etl -- --plan-year=2026 --out=public/data
npm run etl -- --plan-year=2026 --from-dir=./downloads   # offline
```

Requires outbound HTTPS to `healthdata.gov`, `data.healthcare.gov`, `download.cms.gov`.

The repository includes a historical 2026 snapshot. The release workflow downloads and verifies current CMS files and serves the resulting shards as static assets. The synthetic fixture in `src/fixtures/` is used only for tests and explicitly requested synthetic development runs. For 2027, the release combines the CMS medical and dental files with the Marketplace ZIP/county and rating-area tables. It compares household premiums with the official SLCSP endpoint before deployment. See DEPLOY.md for reproduction and coverage. Use `npm run benchmarks:prepare` before `npm run dev` for fresh local prices.

---

## Compliance

The engine is **not** a web-broker under [45 CFR 155.220](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-B/part-155/subpart-C/section-155.220)
— it computes an estimate and links out. But §155.220(c)(3)'s bar on conduct that "could
mislead a consumer into believing they are visiting HealthCare.gov" reaches anyone, so
the CMS disclaimer is adopted voluntarily and served on every response (`DISCLAIMER` in
`src/api/handler.ts`).

Non-negotiable build rules:

1. No `.gov`-imitative domain, seal, logo, or colour scheme.
2. Never state an eligibility determination — "estimated" and "may qualify", never
   "you qualify". Only the Exchange determines eligibility.
3. **Collect no PII.** Nothing is logged, stored, or set as a cookie. This keeps
   45 CFR 155.260 from ever attaching.
4. No compensation contingent on a sale while unlicensed.
5. Show the derivation and date-stamp the data on every result.

---

## Verification status

| Item | Status |
|---|---|
| Rev. Proc. 2026-26 brackets | Primary-verified, IRS Rev. Proc. 2026-26 §§3.01–3.02 |
| 2026 poverty guidelines | Primary-verified for all three regions, 91 FR 1797–1798 |
| Rev. Proc. 2025-25 brackets | `secondary-single` — endpoints corroborated, intermediates are not |
| Alaska / Hawaii guidelines | Primary-verified. One-person 2027 income ceilings are $79,800 / $73,440 |
| PY2027 open enrollment end date | January 15, 2027 on HealthCare.gov. The Fourth Circuit heard the appeal October 30. A later ruling could change the published date. See ACCURACY.md for the dated court check. |
| CMS PUF download URLs | `urlVerified: false` — not reachable from the authoring environment |

See ACCURACY.md for the primary sources, dates checked, and review triggers. The
chaining invariant (`validateTableChaining`) and the 51-jurisdiction count assertion are
in place precisely because transcription from secondary sources is error-prone — the
latter has already caught one real omission (Oklahoma).
