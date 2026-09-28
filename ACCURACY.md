# Accuracy register — subsidydropoff.com

Every factual claim this site renders to users is listed here with the value
shown, the date it was verified, the primary source, and when it must be
re-verified. A claim without a row here (or past its next review with the page
unchanged) is a bug. Values are never invented: if a source cannot be checked,
the page shows no date rather than a guess.

Machine-readable mirror of the Open Enrollment row: `public/oe-window.json`
(pinned together with this file and the rendered page by
`test/oe-window.test.ts`).

| # | Claim (as rendered) | Value | Verified on | Primary source | Next review | Owner |
|---|---|---|---|---|---|---|
| 1 | "The enhanced premium tax credits lapsed on 31 December 2025" (homepage lede + meta description) | Expiration of ARPA/IRA enhancements at 2025-12-31; no extension enacted as of verification date | 2026-09-28 | CBPP analysis of the lapse (Sept 2026), cross-checked against CBO projections for 2026 | 2026-12-15 (mid-OE recheck) | Owner (kevynsgrin-a11y) |
| 2 | "Earning one dollar over 400% of the federal poverty line … removes all of it" (the subsidy cliff) | 400% FPL cap on PTC eligibility restored for 2026+ plan years once enhancements lapsed | 2026-09-28 | Pre-ARPA statutory cap; Wakely 2026 post-subsidy-cliff scorecard; JCKC (June 2026) | 2026-12-15 | Owner |
| 3 | Open Enrollment panel: "November 1, 2026 – January 15, 2027 on HealthCare.gov. Enroll by December 15, 2026 for coverage starting January 1, 2027." | Window 2026-11-01 → 2027-01-15; Jan-1 coverage deadline 2026-12-15 | 2026-09-28 | https://www.healthcare.gov/quick-guide/dates-and-deadlines | 2026-10-15 (before OE opens) | Owner |
| 4 | Open Enrollment panel: "A federal court has paused the rule that would shorten this window to December 15; that ruling is on appeal" | 2027 Payment Notice final rule's shortened-OE provision enjoined by a federal district court; appeal live as of verification date | 2026-09-28 | Court-enjoinment reporting (Sen. Alsobrooks statement, Sept 2026) and CBPP Executive Action Watch | 2026-10-15 | Owner |
| 5 | "State-run Marketplaces set their own dates" | State-based marketplaces set their own OE windows | 2026-09-28 | https://www.healthcare.gov/quick-guide/dates-and-deadlines | 2026-10-15 | Owner |

## Verification trail (2026-09-28 pass)

- HealthCare.gov dates-and-deadlines page (via search-index excerpt of the live
  page; the site blocks direct automated fetch): "Open Enrollment runs
  November 1 – January 15. Coverage can start as soon as January 1."
- CBPP (September 2026): congressional failure to extend the enhanced credits;
  CBO ~2.2M newly uninsured projection for 2026.
- 2027 Payment Notice: final rule would shorten OE to Dec 15; enjoined by a
  federal district court with appeal live (September 2026 reporting).

## Recheck procedure

1. Re-open the primary source for each row and compare the rendered value.
2. Update the Value / Verified-on cells, `public/oe-window.json` (`asOf`,
   `nextReview`, values), and the rendered strings in `public/index.html`
   together — `npm test` fails if they drift apart.
3. If a source cannot be reached, remove the date from the page rather than
   leaving a stale one; note the incident here.
