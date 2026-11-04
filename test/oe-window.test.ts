import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The Open Enrollment panel is dated consumer guidance during the ACA OE
// window, so the rendered strings, the machine-readable spine and the accuracy
// register must never drift apart. Pin all three together.
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// The page uses &nbsp; and wraps lines mid-phrase; compare on normalized text.
const flat = (s: string): string => s.replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const html = flat(read("public/index.html"));
const accuracy = flat(read("ACCURACY.md"));
const oe = JSON.parse(read("public/oe-window.json")) as {
  planYear: number;
  window: { starts: string; ends: string };
  januaryCoverageDeadline: string;
  asOf: string;
  primarySource: string;
  ruleStatus: string;
  stateNote: string;
  subsidyStatus: {
    asOf: string;
    enhancedCreditsLapsedOn: string;
    extensionEnacted: boolean;
    maxFplPercent: number;
    appliesToPlanYears: number[];
    primarySources: string[];
    basis: string;
    congressRecord: string;
  };
  nextReview: string;
};

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

describe("Open Enrollment panel (2026-11-04 pass)", () => {
  it("renders the JSON window and January-coverage deadline in the page", () => {
    expect(html).toContain(rendered(oe.window.starts));
    expect(html).toContain(rendered(oe.window.ends));
    expect(html).toContain(rendered(oe.januaryCoverageDeadline));
    expect(html).toContain('id="oe"');
  });

  it("carries the primary source link and the asOf verification stamp", () => {
    expect(html).toContain(`href="${oe.primarySource}"`);
    expect(html).toContain(`Verified against HealthCare.gov on ${oe.asOf}`);
  });

  it("states the enjoined-rule caveat and the state-marketplace caveat", () => {
    expect(html).toMatch(/court has paused the rule that would shorten this window/);
    expect(html).toMatch(/appeal/);
    expect(html).toMatch(/State-run Marketplaces set their own dates/);
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
    // The rendered caveat still says "paused"; the data behind it must carry
    // the precise posture. See [[COPY: oe-window-litigation]] in ACCURACY.md.
    expect(oe.ruleStatus).toMatch(/vacated/);
    expect(oe.ruleStatus).toMatch(/1:25-cv-2114/);
    expect(oe.ruleStatus).toMatch(/26-1938/);
    expect(oe.ruleStatus).toMatch(/2026-10-30/);
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
    for (const claim of [
      "enhanced premium tax credits lapsed on 31 December 2025",
      "400% of the federal poverty line",
      "November 1, 2026 – January 15, 2027",
      "December 15, 2026",
      "paused the rule that would shorten",
      "State-run Marketplaces set their own dates",
    ]) {
      expect(accuracy).toContain(claim);
    }
    expect(accuracy).toContain("2026-11-04");
    expect(accuracy).toContain("https://www.healthcare.gov/quick-guide/dates-and-deadlines");
    expect(accuracy).toContain("2026-12-15");
  });

  it("mentions the machine-readable spine so the two stay linked", () => {
    expect(accuracy).toContain("oe-window.json");
  });

  it("leaves a copy marker for the wording that moved", () => {
    expect(accuracy).toContain("[[COPY: oe-window-litigation]]");
    // The subsidy-status wording did not move, so it carries no marker.
    expect(accuracy).toContain("[[COPY: subsidy-status]]");
    expect(accuracy).toMatch(/\[\[COPY: subsidy-status\]\][^\n]*not needed/i);
  });
});
