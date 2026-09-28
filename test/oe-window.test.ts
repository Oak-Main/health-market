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
  nextReview: string;
};

const rendered = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  const month = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"][Number(m) - 1];
  return `${month} ${Number(d)}, ${y}`;
};

describe("Open Enrollment panel (2026-09-28 kit)", () => {
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
    expect(accuracy).toContain("2026-09-28");
    expect(accuracy).toContain("https://www.healthcare.gov/quick-guide/dates-and-deadlines");
    expect(accuracy).toContain("2026-10-15");
  });

  it("mentions the machine-readable spine so the two stay linked", () => {
    expect(accuracy).toContain("oe-window.json");
  });
});
