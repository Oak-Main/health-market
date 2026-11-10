# Build handoff — subsidydropoff.com

**Written 2026-11-06.** Describes the build from its beginning through the current
production release, plus the goals the build is answerable to.

| | |
|---|---|
| Product | subsidydropoff.com — the ACA 400% FPL subsidy cliff planner |
| Repo | `Oak-Main/health-market` (local: `C:\Users\Dell\health-market`) |
| Hosting | Cloudflare Pages project `subsidy-dropoff` (custom domain attached in the dashboard) |
| Production branch | `main` — Pages serves `main`. Currently `bc08d4e` (PR #47) |
| Repo default branch | `claude/aca-marketplace-subsidy-estimator-xaujqu` — a push here builds a **preview**, not production |
| Live revision | `main` @ `bc08d4e`, confirmed against the served `app.js` content hash `2d45a1ad195f2b49` |
| Suite | 181 tests / 9 files. **180 pass on a Windows checkout; 1 fails on line endings** — see §5 |
| Open PRs / issues | none |

---

## 1. The goal this was built for

### 1.1 The problem

The ARPA/IRA enhanced premium tax credits lapsed **2025-12-31** and Congress never
extended them. That restored the pre-ARPA §36B schedule, which means plan years 2026
and 2027 have a **hard eligibility cliff at 400% of the federal poverty line** — one
dollar over and the premium tax credit is `$0`, not a reduced amount. IRS Rev. Proc.
2026-26 §3.01 publishes a 2027 applicable percentage table whose final bracket ends
at "at least 300% but not more than 400%", which is the administrative confirmation
that the enhanced schedule is gone for 2027.

The site answers one question precisely: **at exactly what income does my subsidy
disappear, and what does crossing that line cost me?**

### 1.2 The wedge

From `research/aca-subsidy-estimator-go-no-go.md` — a 15-competitor survey that ran
before any code was written. Every competitor shows a number; KFF shows a benchmark
and hides the plans; the lead-gen sites show a number and want your phone number;
HealthCare.gov buries the explanation four steps deep. The wedge is **radical
calculation transparency aimed at the cliff**: always show the whole derivation —
your FPL%, the exact applicable percentage and how it was interpolated, the specific
SLCSP and plan ID used, the source file and its publication date, and the income at
which the subsidy goes to zero.

The research deliberately **concedes the head terms**. KFF is uncatchable on "aca
subsidy calculator" and will never build a cliff planner; winning that category is
the plan, not the head term.

### 1.3 Business model

**Display advertising is the only clean path.** The research found affiliate/lead-gen
figures come from marketing pages that cannot be trusted, that it requires licensure
in practice, and that Google's SEO policy is the real blocker. Two independent
conclusions land in the same place: the research's "display only" and Oak-Main's
standing no-lead-gen rule.

### 1.4 Self-imposed compliance posture

Documented in the research, and it is a design constraint, not boilerplate:

- Not a web-broker (it computes and links out), so 45 CFR 155.220 does not bind —
  but the **CMS General non-FFM disclaimer is adopted voluntarily** anyway.
- No `.gov`-imitative domain, seal, logo or colour scheme.
- **Never state an eligibility determination.** "Estimated" / "may qualify", never
  "you qualify". Only the Exchange determines eligibility.
- **Collect no PII.** Compute client-side, store nothing.
- No compensation contingent on a sale while unlicensed.
- **Show your work** — and treat that as the differentiation, not just the defence.

### 1.5 The accuracy moat

The engine **fails loudly rather than returning a confidently wrong number**. A region
whose poverty table has not been read from its primary source is refused, not
estimated. Every rendered claim carries a value, a verification date and a primary
source, and a test pins the page, the machine-readable spine and the register
together so they cannot drift apart.

---

## 2. Build timeline — beginning state to now

### Phase 0 — the assessment (2026-07-27, `5e20b3f`)

**Tree size: 1 file.** A single commit adding `research/aca-subsidy-estimator-go-no-go.md`:
competitor survey, compliance analysis against 45 CFR 155.220, monetization reality
check, and a GO verdict on wedge (d). The kill criteria were assessed in writing:
benchmark data at ZIP granularity does *not* kill the concept (it is public-domain at
county granularity); licensure *does* kill the affiliate/lead-gen upside but not
display; KFF's head-term authority is conceded deliberately.

### Phase 1 — the engine (2026-07-27, `cb2ee7f`)

**Tree size: 33 files.** The whole calculation core landed in one commit:

- `src/core/` — `fpl`, `ptc`, `cliff`, `applicable-percentage`, `csr`, `rating`,
  `affordability`, `benchmark`, and `plan-years.ts`
- `src/api/handler.ts` — the estimate contract
- `src/data/` — shard model, exchange registry, file loader
- `src/etl/` — run / build / csv / slcsp / sources
- `functions/api/[[route]].ts` — the Cloudflare Pages Function
- `src/fixtures/synthetic-shard.ts` — synthetic data for tests only

The structural decision that still governs the codebase: **all legislative change is
isolated in `src/core/plan-years.ts`.** A law change is an edit to one file, never to
the engine.

Later the same day: the v0 frontend design brief, a new API endpoint and global design
tokens, the `CliffChart` component, ink colour variables and homepage metadata,
"available plan years → only 2026", and the Cloudflare Pages deploy pipeline with an
interim front end (`993ae46`).

### Phase 2 — brand and the v0 tree (2026-07-28 → 07-30)

Rebrand to **Subsidy Dropoff** across all files (`dceaec8`); PR #1 merged. Then the
Next.js tree — `app/`, `components/`, `design/` — landed as `031c7da` "init" and merged
as PR #2.

### Phase 3 — audit and resilience (2026-08-31 → 09-01)

A full-depth website audit (PR #3), including the audit correcting its own earlier
wrong claim ("Next.js tree auto-deploys via Vercel, not undeployed"). PR #4 then fixed
"Section A: deploy/data-pipeline resilience" — audit issues 2 through 6.

### Phase 4 — analytics and real data (2026-09-26 → 09-28)

- PR #9 — GA4 loaded in-page under the site's own CSP.
- PR #12 — the ETL re-pointed to the DKAN portal, unpacking ZIP/XLSX; PY2026 shards
  committed.
- PR #14 — the **OE 2027 accuracy kit**: key-dates panel, `public/oe-window.json`
  spine, the `ACCURACY.md` register, and spine tests.
- PR #16 — real `robots.txt` + `sitemap.xml`.

### Phase 5 — M5: primary-verified PY2027 parameters (2026-11-04 → 11-05, PR #40)

The most recent substantive work, and the one that closed the project's largest
remaining data gap. Parameters re-verified against their **primary documents**:

| Parameter | Before | After |
|---|---|---|
| 2027 applicable % table | 2.15 / 3.23 / 4.30 / 6.78 / 8.66 / 10.22 %, `secondary-concordant` | values unchanged, **`primary-verified`** (Rev. Proc. 2026-26 §3.01 read from the primary PDF) |
| 2026 poverty guidelines, contiguous | $15,960 base, +$5,680/person, increment **derived** | values unchanged, increment now **read** (91 FR 1797–1798) |
| 2026 poverty guidelines, Alaska | `0` — refused at runtime | **$19,950 base, +$7,100/person** — served |
| 2026 poverty guidelines, Hawaii | `0` — refused at runtime | **$18,360 base, +$6,530/person** — served |
| 400% cliff | live | unchanged, re-verified against IRC §36B(c)(1)(E) |
| 2027 open enrollment window | 2026-11-01 → 2027-01-15, Jan-1 deadline 2026-12-15 | values unchanged (healthcare.gov read directly + CMS fact sheet) |
| Rule-status line date | "as of September 2026" | "as of November 2026" |

The rule-status line's **underlying fact did not change** — the credits are still
lapsed and no extension has become law — so only its date moved and no copy marker
was raised for it. The OE litigation caveat *did* change (vacated rather than
enjoined; appeal argued 2026-10-30, undecided), so a marker was left for the owner
to word.

Nine new tests (`test/py2027-fpl-cases.test.ts`) pinned households at **150%, 399% and
401% of FPL** for plan year 2027 — the file has since grown to 12 tests. The branch
was retitled *"Correct 2027 HealthCare.gov enrollment guidance and regional subsidy
boundaries"* and merged on 2026-11-05, after being extended with production-build
gates, HTTP smoke tests, a renewable benchmark refresh lock and dataset verification.

Separately, PR #39 (2026-10-28) had already raised `next` to 16.4.3 with
`sharp >= 0.35.5` — the dependency floor that `scripts/check-security-floor.mjs`
later made permanent.

### Phase 6 — the verified 2027 release (2026-11-05 → 11-06)

| PR | Title | What it did |
|---|---|---|
| #41 | Publish verified 2027 enrollment guidance and regional subsidy checks | → `main` |
| #42 | Carry production review fixes into the default release workflow | default branch |
| #44 | Verify the published regional cutoffs and CMS coverage on each refresh | → `main` |
| #45 | Release verified 2027 ZIP-specific Marketplace silver benchmarks | → `main` |
| #46 | Display the verified monthly benchmark and credit to the cent | → `main` |
| #47 | Refresh the calculator script for returning visitors | → `main` |
| #48 | Vite 8.3.5 | default branch |

### Capability: beginning state → now

| Capability | 2026-07-27 | Now |
|---|---|---|
| Tracked files | 1 → 33 | **545** |
| Plan years | 2026 only | **2026 and 2027** |
| Regions | contiguous only | **contiguous, Alaska, Hawaii** |
| Benchmark data | synthetic fixture only | **real CMS PUFs**; 2026 committed (444 files, 5.2 MB), 2027 built in CI at deploy time |
| ZIP-level silver benchmarks | no | **yes** (2027) |
| Income-only check (no ZIP quote) | no | **yes**, with region picker |
| Tests | none | **181**, 9 files |
| CI gates | none | typecheck, engine typecheck, security floor, tests, production build + HTTP smoke, published-site verification |
| Data refresh | manual | **weekly cron**, Mondays 11:00 UTC, from `main` |
| Deploy failure visibility | silent | **opens a GitHub issue** automatically |
| Accuracy register | none | **`ACCURACY.md`**, one dated primary source per rendered claim |
| Live | not deployed | **subsidydropoff.com**, serving `main` @ `bc08d4e` |

---

## 3. How it works now

### 3.1 Shape

```
src/core/       pure calculation engine — the only place law lives is plan-years.ts
src/api/        handler.ts — /api/estimate, /api/income-check, /api/health
src/data/       shard model, exchange registry, file loader
src/etl/        CMS public-use-file ETL (run / build / csv / slcsp / sources / verify)
public/         the static SPA served on Pages: index.html, app.js, styles.css,
                oe-window.json, data/<year>/…, robots.txt, sitemap.xml
functions/api/  the Pages Function entry point
app/ components/ design/   the Next.js tree (a separate Vercel-side surface)
```

### 3.2 Release pipeline

`.github/workflows/deploy.yml`. Push triggers fire only on `main` and
`claude/aca-marketplace-subsidy-estimator-**`; a pull request runs **verification
only** and never deploys.

1. **verify** — `npm ci` → `typecheck` → `engine:typecheck` → `check:security-floor` →
   `test` → (PRs only) `check:production` = `next build` + HTTP smoke test.
2. **deploy** — `check:production` again with `PLAN_YEAR` set (6.5 GB heap), then
   `wrangler pages deploy public --project-name=subsidy-dropoff --branch=<main|preview>`.
3. **verify-published** — on `main` only, `scripts/verify-published.mjs` asserts the
   served `/oe-window.json` equals the committed one, the served homepage contains the
   rule-status string, and the served benchmark build matches the prepared manifest.
4. **On failure** — opens a GitHub issue. Nothing upstream pages anyone on its own.

`scripts/check-security-floor.mjs` reads the **installed** tree (not `package.json`)
and fails below `next` 16.4.1 / 15.5.28 or `sharp` 0.35.5 — the floors for
GHSA-2464-fhr4-w9xw (Image Optimization SVG RCE), GHSA-p3m5-59mp-jv5r (Server Actions
DoS) and GHSA-673q-mjm6-r5xr (`use cache` typed-array RCE).

### 3.3 Why the ETL runs in CI

GitHub runners have the outbound access to CMS that the authoring environment lacks.
The committed dataset is a historical snapshot; **production premiums are rebuilt from
the published files on every deploy**, so they cannot silently drift from source, and
the weekly schedule picks up CMS's in-year revisions without anyone remembering to.
A new plan year needs a reviewed, year-specific source registry before it can ship.

### 3.4 The accuracy discipline

- `ACCURACY.md` — every claim the site renders, with its value, verification date,
   primary source and next-review date. *"A claim without a row here (or past its next
   review with the page unchanged) is a bug."*
- `public/oe-window.json` — the machine-readable spine, including a `subsidyStatus`
   block holding the rule-status facts as data.
- `test/oe-window.test.ts` — pins page == spine == register.
- `[[COPY: <claim>]]` markers — when a fact changes but the wording needs the owner,
   the fact moves in the data and a marker is left instead of rewording.

---

## 4. What is still open

**From the launch checklist in `DEPLOY.md`:**

- [ ] Spot-check ten PUF-derived benchmarks against HealthCare.gov window shopping, ±$2/month
- [ ] Confirm the disclaimer renders above the fold on mobile
- [ ] Re-check the plan year 2027 open-enrollment end date — vacated 2026-06-12 in
      *City of Columbus v. Kennedy*; the government's appeal (4th Cir. No. 26-1938) was
      argued 2026-10-30 and is undecided. The published window is
      2026-11-01 → 2027-01-15, and `end` deliberately stays `null` while contested.

**Observed while writing this handoff (2026-11-06):**

- **`npm test` fails 1 of 181 on a Windows checkout of `main`** — and this is not a
  code defect. PR #47's cache-busting test hashes the **raw bytes** of `public/app.js`
  and expects `public/index.html` to carry the same digest. The repo has
  `core.autocrlf = true` and **no `.gitattributes`**, so a Windows checkout rewrites
  LF → CRLF and the digest changes. Measured on this machine:
  - working-tree bytes (CRLF) → `cc73c3722e13e4a6` ← what the test computes
  - LF-normalised bytes (what is committed) → `2d45a1ad195f2b49` ← what `index.html`
    references, and what CI sees on Linux

  Fixes, in order of preference: add a `.gitattributes` with `* text=auto eol=lf`
  (also stops the CRLF churn that `git archive` causes); or hash the LF-normalised
  bytes in the test; or exempt `public/app.js` from conversion. Until one lands, a
  Windows run of the full suite is always 180/181.
- `README.md:38` still says `npm test # 117 tests`. The suite is **181**.
- `README.md:14` still reads "State of the law (as of 2026-11-04)" — it should track
  the register's next-review date.
- `components/landing/stakes.tsx:43` says the enhanced credits "**are scheduled to
  expire**". They expired 2025-12-31, and the cap is not removed — the 400% cap
  *applies*. Stale in the Next.js tree; the static site and the accuracy register
  have this right.
- `main` and the default branch have diverged at `ee9ba32` in both directions:
  `main` holds #44–#47 (the product changes), the default branch holds #37/#42/#48.
  Production is `main`. A reconciliation is needed before either side can be treated
  as the single line of history.

---

## 5. If you pick this up next

**Commands**

```bash
npm ci
npm test                      # 181 tests — expect 180/181 on Windows, see §4
npm run typecheck
npm run engine:typecheck
npm run check:security-floor
npm run check:production      # build + HTTP smoke
npm run benchmarks:prepare    # rebuild the benchmark data locally
npm run etl:verify -- public/data 2026
```

**Traps**

- **The suite cannot go fully green on this machine.** `test/market-rates.test.ts`
  hashes raw file bytes and `core.autocrlf = true` with no `.gitattributes` rewrites
  the line endings. Proven, measured and explained in §4. Read the one failure as
  environmental until a `.gitattributes` lands.
- **The deployed tree did not match any single branch until 2026-11-05.** PR #14
  (accuracy kit) landed on `main` and PR #16 (SEO) on the default branch; production
  was serving a combination built from a working tree that had both. Fetch the live
  URL and compare it before assuming which branch is deployed. Cheap way to pin the
  live revision: the homepage carries a content-addressed
  `<script src="/app.js?v=<sha256[:16]>">`; read that digest out of the served HTML
  and match it against `git show <ref>:public/index.html` for each candidate branch.
  (Normalise line endings before comparing — see the trap above.)
- **`main` is production, not the default branch.** The default branch produces
  previews only.
- **The committed dataset is 2026 only.** The 2027 shards exist only in CI output;
  `public/data/2027/` will be absent locally by design.
- **`npm run engine:typecheck` failed on `src/etl/sources.ts` until the Nov 2026
  release work.** It is green on `main` now; it was not on 2026-11-04.
- **A verification stamp moves only when the source was actually re-read.** A source
  not re-read keeps its earlier date — that is deliberate, not staleness.

**Standing operating rules for this repo**

- Branch and open a **draft PR**. Do not merge, deploy, or touch Cloudflare settings
  or secrets without an explicit instruction.
- Update the **data**, not the prose. When a fact changes, move the value in the
  spine / register / parameters and leave a `[[COPY: <claim>]]` marker with the source
  URL for the owner to word.
- Every changed data value carries its source URL and UTC retrieval timestamp.
- Push to the `Oak-Main` org, never to a personal account.
