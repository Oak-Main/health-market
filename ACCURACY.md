# Accuracy register — subsidydropoff.com

This register covers the public enrollment dates, litigation status and federal subsidy income rules. Every rendered claim in that scope needs a row with a verification date, primary source and next review. Publish values only after verifying them.

Machine-readable mirror of the Open Enrollment row: `public/oe-window.json`
(pinned together with this file and the rendered page by
`test/oe-window.test.ts`). The rule-status line has its own mirror block,
`subsidyStatus`, in the same file. In the estimate API, `provenance.openEnrollment.publishedEnd` reports the closing date currently published by HealthCare.gov. While an appeal is pending, `provenance.openEnrollment.end` stays null and `provenance.openEnrollment.endIsContested` is true.

| # | Claim (as rendered) | Value | Verified on | Primary source | Next review | Owner |
|---|---|---|---|---|---|---|
| 1 | "The enhanced premium tax credits lapsed on 31 December 2025" (homepage lede) | Expiration of ARPA/IRA enhancements at 2025-12-31; no extension enacted as of verification date | 2026-11-04 | Congress.gov bill status — H.R. 1834 (House-passed 3-year extension) and H.R. 5145 — plus IRS Rev. Proc. 2026-26 §3.01 | 2026-12-15 (mid-OE recheck) | Owner (kevynsgrin-a11y) |
| 2 | "Earning one dollar over 400% of the federal poverty line … removes all of it" (the subsidy cliff) | 400% FPL cap on PTC eligibility restored for 2026+ plan years once enhancements lapsed | 2026-11-04 | IRC §36B(c)(1)(E); IRS Rev. Proc. 2026-26 §3.01 — the 2027 table's final bracket is "at least 300% but not more than 400%", i.e. the pre-ARPA schedule | 2026-12-15 | Owner |
| 3 | Federal enrollment and coverage dates | For 2027 coverage on HealthCare.gov, open enrollment runs from November 1, 2026 through January 15, 2027. Choose a plan by December 15, 2026 for January 1 coverage. Later selections through January 15 start February 1. Pay your first premium on time for coverage to begin. | 2026-11-05 | https://www.healthcare.gov/quick-guide/dates-and-deadlines/ · https://www.cms.gov/newsroom/fact-sheets/plan-year-2027-marketplace-plans-prices-fact-sheet-0 | 2026-12-15 or earlier CMS guidance | Owner |
| 4 | Court ruling and appeal | On June 12, 2026, the U.S. District Court for Maryland vacated the provision that would have shortened open enrollment. The Fourth Circuit heard the government’s appeal on October 30, 2026. Its public opinions list showed no decision in the case when checked on November 5, 2026. A later ruling could change the dates. | 2026-11-05 | https://litigationtracker.law.georgetown.edu/wp-content/uploads/2025/07/City-of-Columbus_2026.06.12_ORDER.pdf · https://www.ca4.uscourts.gov/oral-argument/oral-argument-audio-files · https://www.ca4.uscourts.gov/opinions/recent-opinions | On a court order or CMS update, and by 2026-12-15 | Owner |
| 5 | State enrollment websites | If your state runs its own enrollment website, its deadlines may differ. Check your state Marketplace. | 2026-11-05 | https://www.healthcare.gov/marketplace-in-your-state/ | 2026-12-15 | Owner |
| 6 | Rule-status line: "Rule status as of November 2026: the enhanced credits lapsed 31 December 2025 and Congress has not enacted an extension, so the 400% FPL cap applies to the 2026 and 2027 estimates below." | Lapsed 2025-12-31; `extensionEnacted: false`; 400% cap applies to plan years 2026 and 2027 | 2026-11-04 | https://www.congress.gov/bill/119th-congress/house-bill/1834/all-actions · https://www.congress.gov/bill/119th-congress/house-bill/5145/all-actions · https://www.irs.gov/pub/irs-drop/rp-26-26.pdf | 2026-12-15 | Owner |
| 7 | Federal income test for 2027 coverage, including Alaska and Hawaii | General range of 100% through 400% of the 2026 HHS guideline for the tax household. One person: contiguous/DC $15,960–$63,840, Alaska $19,950–$79,800, Hawaii $18,360–$73,440. The upper endpoint is included. | 2026-11-05 | https://www.govinfo.gov/content/pkg/FR-2026-01-15/pdf/2026-00755.pdf · https://www.irs.gov/pub/irs-drop/rp-26-26.pdf · https://www.irs.gov/affordable-care-act/individuals-and-families/questions-and-answers-on-the-premium-tax-credit | 2026-12-15 | Owner |
| 8 | Search and social descriptions | HealthCare.gov lists November 1, 2026 through January 15, 2027 for 2027 enrollment. The pending appeal could change dates. State deadlines may differ. | 2026-11-05 | https://www.healthcare.gov/quick-guide/dates-and-deadlines/ · https://www.healthcare.gov/marketplace-in-your-state/ | On a court order or CMS update, and by 2026-12-15 | Owner |

## Enrollment and calculator verification, November 5, 2026

The signed order in City of Columbus v. Kennedy, D. Md. No. 1:25-cv-02114, ECF 74 ¶3(e), vacated the shortened enrollment provision. The Fourth Circuit records argument in No. 26-1938 on October 30. Its public recent-opinions list was checked November 5. The latest entries displayed were dated November 4. CMS's October 30 PY2027 fact sheet and HealthCare.gov publish the federal dates. State exchanges that operate their own websites publish their respective deadlines. Oregon moved to its own platform for 2027. Arkansas and Oklahoma use the federal enrollment platform. Source: https://www.cms.gov/marketplace/in-person-assisters/training-webinars/training/marketplaces-map.

The federal income test is one part of eligibility. IRS Form 8962 Worksheet 2 compares income with four times the guideline before discarding fractional percentage points. An income check can show the household's range and contribution without a local premium. A dollar estimate based on a user-entered Marketplace benchmark is labeled separately. The selected plan's qualifying premium and other eligibility rules can limit the actual credit. The automatic ZIP-based calculator requires a verified local benchmark for the requested year. Sources: https://www.irs.gov/instructions/i8962 and https://www.cms.gov/marketplace/resources/data/public-use-files.

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
  +$5,680 per additional person, Alaska $19,950 / +$7,100, Hawaii $18,360 /
  +$6,530.
- **Congress.gov**: H.R. 1834 passed the House 230-196 on 2026-01-08 and sits
  on the Senate calendar with no floor action since 2026-02-10; H.R. 5145
  remains "Introduced", its only action being referral to the House Committee
  on Ways and Means. No extension has become law.
- **Litigation**: the District of Maryland vacated the shortened-window changes to 45 CFR 155.410(e) and (f) on
  2026-06-12 (City of Columbus v. Kennedy, No. 1:25-cv-02114); the
  government's appeal was argued 2026-10-30 (4th Cir. No. 26-1938). The
  follow-up check on 2026-11-05 found no decision on the court’s public opinions list.

### What did not change on this pass

The enhanced credits remain lapsed and Congress has enacted no extension, so
the rule-status line's underlying fact did not move — only its date did. The
2027 applicable percentage table is unchanged. The open enrollment window
dates are unchanged. What changed is the *confidence* in the parameters
behind those claims: the 2027 table and the 2026 poverty guidelines are now
primary-verified instead of secondary-corroborated and derived, and Alaska and
Hawaii are no longer refused at runtime.

## Recheck procedure

1. Re-open the primary source for each row and compare the rendered value.
2. Update the Value / Verified-on cells, `public/oe-window.json` (`asOf`,
   `nextReview`, values, `subsidyStatus`), and the rendered strings in
   `public/index.html` together — `npm test` fails if they drift apart.
3. If a source cannot be reached, remove the date from the page rather than
   leaving a stale one; note the incident here.
4. Recheck the Fourth Circuit and CMS immediately if an opinion, stay, or new Marketplace guidance appears. Record the date, affected provision, and published enrollment window together.
