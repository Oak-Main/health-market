import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import oe from "../public/oe-window.json";
import { getPlanYear } from "../src/core/plan-years.js";

// The Open Enrollment panel is dated consumer guidance during the ACA OE
// window, so the rendered strings, the machine-readable spine and the accuracy
// register must never drift apart. Pin all three together.
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// The page uses &nbsp; and wraps lines mid-phrase; compare on normalized text.
const flat = (s: string): string => s.replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const html = flat(read("public/index.html"));
const accuracyText = read("ACCURACY.md");
const accuracy = flat(accuracyText);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const rendered = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
};

/** "November 2026" — the form the rule-status line uses. */
const renderedMonth = (iso: string): string => {
  const [y, m] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

describe("2027 federal open enrollment", () => {
  it("renders the JSON window and January-coverage deadline in the page", () => {
    expect(html).toContain(rendered(oe.window.starts));
    expect(html).toContain(rendered(oe.window.ends));
    expect(html).toContain(rendered(oe.januaryCoverageDeadline));
    expect(html).toContain('id="oe"');
  });

  it("carries the primary source link and the asOf verification stamp", () => {
    expect(html).toContain(`href="${oe.primarySource}"`);
    expect(html).toContain(`datetime="${oe.asOf}"`);
  });

  it("publishes the same dated ruling, coverage, and state guidance in the page and register", () => {
    for (const value of [oe.datesSummary, oe.ruleStatus, oe.stateNote]) {
      expect(html).toContain(value);
      expect(accuracy).toContain(value);
    }
    expect(html).toContain(`href="${oe.stateSource}"`);
    expect(oe.datesSummary).toMatch(/pay your first premium/i);
  });

  it("uses the same public end date and appeal caveat in the estimate API", () => {
    const info = getPlanYear(2027).openEnrollment;
    expect(info.start).toBe(oe.window.starts);
    expect(info.end).toBeNull();
    expect(info.publishedEnd).toBe(oe.window.ends);
    expect(info.januaryFirstDeadline).toBe(oe.januaryCoverageDeadline);
    expect(info.endIsContested).toBe(true);
    expect(info.note).toContain(oe.ruleStatus);
  });

  it("matches the search and social metadata to the dated federal record", () => {
    for (const attr of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
      expect(html).toContain(`<meta ${attr} content="${oe.description}">`);
    }
    expect(oe.description).toContain("HealthCare.gov");
    expect(oe.description).toContain(rendered(oe.window.ends));
    expect(oe.description).toContain("State deadlines may differ");
    expect(oe.description).toMatch(/appeal could change/i);
    const nextPage = read("app/page.tsx");
    for (const key of ["datesSummary", "ruleStatus", "stateNote", "stateSource"]) {
      expect(nextPage).toContain(`enrollment.${key}`);
    }
  });

  it("keeps the spine self-consistent and scheduled for re-review", () => {
    expect(oe.planYear).toBe(2027);
    expect(oe.window.starts).toBe("2026-11-01");
    expect(oe.window.ends).toBe("2027-01-15");
    expect(oe.januaryCoverageDeadline).toBe("2026-12-15");
    expect(oe.ruleStatus.length).toBeGreaterThan(0);
    expect(oe.stateNote.length).toBeGreaterThan(0);
    expect(oe.nextReview > oe.asOf).toBe(true);
  });

  it("records the vacatur and the argued-but-undecided appeal in the spine", () => {
    expect(oe.ruleStatus).toContain("vacated");
    expect(oe.case.districtDocket).toBe("1:25-cv-02114");
    expect(oe.case.appealDocket).toBe("26-1938");
    for (const date of [oe.case.districtRulingDate, oe.case.argumentDate, oe.asOf]) {
      expect(oe.ruleStatus).toContain(rendered(date));
    }
    for (const url of Object.values(oe.sources)) expect(accuracy).toContain(url);
  });
});

describe("Rule-status line (subsidy status)", () => {
  it("renders the status line dated to the spine's asOf stamp", () => {
    expect(html).toContain(`Rule status as of ${renderedMonth(oe.subsidyStatus.asOf)}`);
    expect(accuracy).toContain(`Rule status as of ${renderedMonth(oe.subsidyStatus.asOf)}`);
  });

  it("records the lapsed enhanced credits and the 400% cap as the fact", () => {
    expect(oe.subsidyStatus.enhancedCreditsLapsedOn).toBe("2025-12-31");
    expect(oe.subsidyStatus.extensionEnacted).toBe(false);
    expect(oe.subsidyStatus.maxFplPercent).toBe(400);
    expect(oe.subsidyStatus.appliesToPlanYears).toEqual([2026, 2027]);
  });

  it("cites Congress.gov and the IRS revenue procedure as the primary sources", () => {
    for (const url of oe.subsidyStatus.primarySources) {
      expect(url).toMatch(/^https:\/\//);
      expect(accuracy).toContain(url);
    }
    expect(oe.subsidyStatus.primarySources.join(" ")).toMatch(/congress\.gov/);
    expect(oe.subsidyStatus.primarySources.join(" ")).toMatch(/irs\.gov/);
  });

  it("keeps the page's claim and the spine's fact in step", () => {
    expect(html).toMatch(/enhanced credits lapsed 31 December 2025/);
    expect(html).toMatch(/Congress has not enacted an extension/);
    expect(html).toMatch(/400% FPL cap applies to the 2026 and 2027 estimates/);
  });
});

describe("Accuracy register covers the rendered claims", () => {
  it("has a row per claim with a verification date and a primary source", () => {
    const rows = accuracyText.split("\n").filter(line => /^\| \d+ \|/.test(line));
    const records = [
      ["enhanced premium tax credits lapsed on 31 December 2025", oe.subsidyStatus.asOf, "Congress.gov"],
      ["400% of the federal poverty line", oe.subsidyStatus.asOf, "Rev. Proc. 2026-26"],
      [oe.datesSummary, oe.asOf, oe.primarySource],
      [oe.ruleStatus, oe.asOf, oe.sources.courtOrder],
      [oe.stateNote, oe.asOf, oe.stateSource],
      ["extensionEnacted", oe.subsidyStatus.asOf, oe.subsidyStatus.primarySources[0]],
      ["General range of 100% through 400%", oe.asOf, "https://www.govinfo.gov/"],
      [oe.description, oe.asOf, oe.primarySource],
    ];
    for (const [claim, date, source] of records) {
      const matches = rows.filter(row => row.includes(claim));
      expect(matches).toHaveLength(1);
      const columns = matches[0]!.split("|").map(cell => cell.trim());
      expect(columns[4]).toBe(date);
      expect(columns[5]).toContain(source);
      expect(columns[6]).toContain(oe.nextReview);
    }
  });

  it("mentions the machine-readable spine so the two stay linked", () => {
    expect(accuracy).toContain("oe-window.json");
  });

  it("contains the resolved court wording across the public surfaces", () => {
    expect(accuracy).not.toContain("[[COPY: oe-window-litigation]]");
    const courtRow = accuracyText.split("\n").find(line => line.startsWith("| 4 |"));
    expect(courtRow).toContain(oe.ruleStatus);
    expect(`${html} ${oe.ruleStatus} ${courtRow}`).not.toMatch(/\b(?:paus(?:e|es|ed|ing)|stay(?:s|ed|ing)?|enjoin(?:s|ed|ing)?|injunction)\b/i);
    expect(accuracy).toContain(oe.asOf);
    expect(accuracy).toContain(oe.case.appealDocket);
  });
});
