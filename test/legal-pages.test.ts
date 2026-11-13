import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// /privacy and /terms are plain static pages in public/. Cloudflare Pages serves
// public/privacy.html at /privacy and public/terms.html at /terms. Because
// public/404.html exists, Pages does not fall back to the calculator shell for
// unknown paths, so these files must exist for the routes to be real pages.
const read = (p: string): string => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
const pages = {
  privacy: { file: "privacy.html", h1: "Privacy Policy" },
  terms: { file: "terms.html", h1: "Terms of Use" },
} as const;

describe("legal pages are real static pages", () => {
  it("keeps the top-level 404.html that disables the Pages SPA fallback", () => {
    expect(existsSync(new URL("../public/404.html", import.meta.url))).toBe(true);
  });

  for (const [route, { file, h1 }] of Object.entries(pages)) {
    describe(`/${route}`, () => {
      const html = read(file);

      it("is its own document, not the calculator shell", () => {
        expect(html).toContain(`<h1>${h1}</h1>`);
        expect(html).toContain(`<link rel="canonical" href="https://subsidydropoff.com/${route}">`);
        expect(html).not.toContain('id="f"');
        expect(html).not.toMatch(/\/app\.js/);
      });

      it("uses the site stylesheet and the CSP-safe GA4 wiring, with no inline script", () => {
        expect(html).toContain('<link rel="stylesheet" href="/styles.css">');
        expect(html).toContain('<script async src="https://www.googletagmanager.com/gtag/js?id=G-J0DNS1H8NK"></script>');
        expect(html).toContain('<script src="/ga4.js"></script>');
        const scripts = html.match(/<script\b[^>]*>/g) ?? [];
        expect(scripts.every((s) => / src="/.test(s))).toBe(true);
      });

      it("names the operator, effective date and contact, and links both legal pages", () => {
        expect(html).toContain("Effective November 12, 2026.");
        expect(html).toContain("operated by Oak and Main Developers LLC");
        expect(html).toContain(
          "Oak and Main Developers LLC, 1223 Cleveland Ave, Suite 200, San Diego, CA 92103. Email: <a href=\"mailto:admin@oakandmain.dev\">admin@oakandmain.dev</a>.",
        );
        expect(html).toContain('<a href="/privacy">Privacy Policy</a>');
        expect(html).toContain('<a href="/terms">Terms of Use</a>');
      });
    });
  }

  it("privacy lists GA4, carries the approved Analytics and no-affiliate text, and never claims no cookies", () => {
    const html = read("privacy.html");
    expect(html).toContain("<li>Google Analytics 4 (Google LLC)</li>");
    expect(html).toContain(
      "We use Google Analytics 4, loaded through Google's gtag.js script, to count visits and see which pages are read. It sets first-party cookies (_ga and _ga_&lt;ID&gt;) that hold a random identifier",
    );
    expect(html).toContain(
      "This site does not use affiliate links and is not paid for any product or service it mentions. If that changes, this page will say so first and those links will be labelled.",
    );
    expect(html).not.toMatch(/without cookies|no cookies|no analytics|no tracking/i);
  });

  it("terms carry the approved information-only and links text", () => {
    const html = read("terms.html");
    expect(html).toContain(
      "Everything on this site is general information, not professional, legal, financial, medical or safety advice. Check anything important with the original source or a qualified professional before you rely on it.",
    );
    expect(html).toContain(
      "We link to other sites for reference. We do not control them and are not responsible for their content or practices.",
    );
    expect(html).not.toMatch(/affiliate link/i);
  });

  it("lists both pages in the sitemap", () => {
    const sitemap = read("sitemap.xml");
    expect(sitemap).toContain("<loc>https://subsidydropoff.com/privacy</loc>");
    expect(sitemap).toContain("<loc>https://subsidydropoff.com/terms</loc>");
  });
});
