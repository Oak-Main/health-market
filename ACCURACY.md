# Accuracy register — subsidydropoff.com

Every factual claim this site renders to users is listed here with the value
shown, the date it was verified, the primary source, and when it must be
re-verified. A claim without a row here (or past its next review with the page
unchanged) is a bug. Values are never invented: if a source cannot be checked,
the page shows no date rather than a guess.

Machine-readable mirror of the Open Enrollment row: `public/oe-window.json`
(pinned together with this file and the rendered page by
`test/oe-window.test.ts`). The rule-status line has its own mirror block,
`subsidyStatus`, in the same file.

| # | Claim (as rendered) | Value | Verified on | Primary source | Next review | Owner |
|---|---|---|---|---|---|---|
| 1 | "The enhanced premium tax credits lapsed on 31 December 2025" (homepage lede + meta description) | Expiration of ARPA/IRA enhancements at 2025-12-31; no extension enacted as of verification date | 2026-11-04 | Congress.gov bill status — H.R. 1834 (House-passed 3-year extension) and H.R. 5145 — plus IRS Rev. Proc. 2026-26 §3.01 | 2026-12-15 (mid-OE recheck) | Owner (kevynsgrin-a11y) |
| 2 | "Earning one dollar over 400% of the federal poverty line … removes all of it" (the subsidy cliff) | 400% FPL cap on PTC eligibility restored for 2026+ plan years once enhancements lapsed | 2026-11-04 | IRC §36B(c)(1)(E); IRS Rev. Proc. 2026-26 §3.01 — the 2027 table's final bracket is "at least 300% but not more than 400%", i.e. the pre-ARPA schedule | 2026-12-15 | Owner |
| 3 | Open Enrollment panel: "November 1, 2026 – January 15, 2027 on HealthCare.gov. Enroll by December 15, 2026 for coverage starting January 1, 2027." | Window 2026-11-01 → 2027-01-15; Jan-1 coverage deadline 2026-12-15 | 2026-11-04 | https://www.healthcare.gov/quick-guide/dates-and-deadlines (page read directly) and the CMS Plan Year 2027 Marketplace Plans and Prices Fact Sheet (2026-10-30) | 2026-12-15 | Owner |
| 4 | Open Enrollment panel: "A federal court has paused the rule that would shorten this window to December 15; that ruling is on appeal" | 45 CFR 155.410(e)(5) — added by the 2025 Marketplace Integrity and Affordability final rule (90 FR 27074) — was vacated by the District of Maryland on 2026-06-12; the government's appeal (4th Cir. No. 26-1938) was argued 2026-10-30 and is undecided | 2026-11-04 | City of Columbus v. Kennedy, No. 1:25-cv-2114 (D. Md. 2026-06-12); Fourth Circuit No. 26-1938 (argued 2026-10-30) | 2026-12-15 | Owner |
| 5 | "State-run Marketplaces set their own dates" | State-based marketplaces set their own OE windows | 2026-11-04 | https://www.healthcare.gov/quick-guide/dates-and-deadlines | 2026-12-15 | Owner |
| 6 | Rule-status line: "Rule status as of November 2026: the enhanced credits lapsed 31 December 2025 and Congress has not enacted an extension, so the 400% FPL cap applies to the 2026 and 2027 estimates below." | Lapsed 2025-12-31; `extensionEnacted: false`; 400% cap applies to plan years 2026 and 2027 | 2026-11-04 | https://www.congress.gov/bill/119th-congress/house-bill/1834/all-actions · https://www.congress.gov/bill/119th-congress/house-bill/5145/all-actions · https://www.irs.gov/pub/irs-drop/rp-26-26.pdf | 2026-12-15 | Owner |

## Verification trail (2026-11-04 pass)

- **HealthCare.gov dates-and-deadlines** — read directly on 2026-11-04 (the page
  no longer blocks automated fetch): "November 1: Open Enrollment starts";
  "December 15: Last day to enroll in or change plans for coverage to start
  January 1"; "January 15: Open Enrollment ends". Page banner: "Enroll for
  2027 now … Enroll by December 15 for coverage that starts January 1."
- **CMS, Plan Year 2027 Marketplace Plans and Prices Fact Sheet** (published
  2026-10-30): "The Open Enrollment Period to choose HealthCare.gov coverage
  for 2027 begins on November 1, 2026, and runs through January 15, 2027."
- **IRS Rev. Proc. 2026-26** (2026-07-21), §§3.01–3.02, read from the primary
  PDF: the 2027 applicable percentage table runs 2.15% → 10.22% with the final
  bracket "at least 300% but not more than 400%"; required contribution
  percentage 10.22%. A published table with no bracket above 400% is the
  administrative signal that the enhanced schedule is gone for 2027.
- **91 FR 1797–1798** (FR Doc. 2026-00755, 2026-01-15): the 2026 HHS poverty
  guidelines, transcribed for all three regions — contiguous $15,960 base and
  +$5,680 per person over 4, Alaska $19,950 / +$7,100, Hawaii $18,360 /
  +$6,530.
- **Congress.gov**: H.R. 1834 passed the House 230-196 on 2026-01-08 and sits
  on the Senate calendar with no floor action since 2026-02-10; H.R. 5145
  remains "Introduced", its only action being referral to the House Committee
  on Ways and Means. No extension has become law.
- **Litigation**: the District of Maryland vacated 45 CFR 155.410(e)(5) on
  2026-06-12 (City of Columbus v. Kennedy, No. 1:25-cv-2114); the
  government's appeal was argued 2026-10-30 (4th Cir. No. 26-1938) and is
  undecided as of 2026-11-04.

### What did not change on this pass

The enhanced credits remain lapsed and Congress has enacted no extension, so
the rule-status line's underlying fact did not move — only its date did. The
2027 applicable percentage table is unchanged. The open enrollment window
dates are unchanged. What changed is the *confidence* in the parameters
behind those claims: the 2027 table and the 2026 poverty guidelines are now
primary-verified instead of secondary-corroborated and derived, and Alaska and
Hawaii are no longer refused at runtime.

## Copy requests

Facts that moved are recorded here rather than rewritten, so the wording stays
with the owner.

- **[[COPY: oe-window-litigation]]** — the rendered Open Enrollment caveat
  still reads "A federal court has paused the rule that would shorten this
  window to December 15; that ruling is on appeal". The record now says the
  provision was **vacated** (not merely stayed or enjoined) on 2026-06-12, and
  that the appeal was **argued 2026-10-30** and remains undecided. The
  substance is unchanged — the rule is not in effect and the dates can change —
  so the page was left as written and only the verification date moved. Reword
  at will; the underlying values are in `public/oe-window.json` → `ruleStatus`.
  Sources: https://www.cms.gov/newsroom/fact-sheets/plan-year-2027-marketplace-plans-prices-fact-sheet-0 ·
  City of Columbus v. Kennedy, No. 1:25-cv-2114 (D. Md. 2026-06-12) ·
  Fourth Circuit No. 26-1938 (argued 2026-10-30)
- **[[COPY: subsidy-status]]** — *not needed on this pass.* The rule-status
  line's underlying fact did not move, so no marker was left. It stays on this
  list as the standing place to record a wording request if a future pass finds
  the enhanced-credit status has changed.

## Recheck procedure

1. Re-open the primary source for each row and compare the rendered value.
2. Update the Value / Verified-on cells, `public/oe-window.json` (`asOf`,
   `nextReview`, values, `subsidyStatus`), and the rendered strings in
   `public/index.html` together — `npm test` fails if they drift apart.
3. If a source cannot be reached, remove the date from the page rather than
   leaving a stale one; note the incident here.
4. When a row's fact changes but the wording needs the owner, leave a
   `[[COPY: <claim>]]` marker above with the source URL instead of rewording.
