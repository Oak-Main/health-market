import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const script = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const homepage = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const attributes = readFileSync(new URL("../.gitattributes", import.meta.url));
const revision = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const reference = (bytes: Buffer) => `<script src="/app.js?v=${revision(bytes)}" type="module">`;

it.each([
  { name: "LF", autocrlf: "false", eol: "lf", newline: "\n" },
  { name: "CRLF", autocrlf: "true", eol: "crlf", newline: "\r\n" },
])("preserves the byte-integrity check in a $name checkout", ({ autocrlf, eol, newline }) => {
  const root = mkdtempSync(join(tmpdir(), "subsidy-asset-eol-"));
  const assetPath = join(root, "public", "app.js");
  const pagePath = join(root, "public", "index.html");
  // Only fixture inputs change line endings. Hashing and verification stay byte-exact.
  const checkoutText = (text: string) => text.replace(/\r?\n/g, newline);
  const git = (...args: string[]) => execFileSync("git", [
    "-c", `core.autocrlf=${autocrlf}`, "-c", `core.eol=${eol}`,
    "-c", "core.safecrlf=false", "-c", `core.attributesFile=${join(root, "no-global-attributes")}`,
    ...args,
  ], {
    cwd: root,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "no-global-config") },
    stdio: "pipe",
  });
  try {
    git("init", "--template=");
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, ".gitattributes"), attributes);
    writeFileSync(assetPath, checkoutText(script));
    writeFileSync(pagePath, checkoutText(homepage));
    git("add", "--", ".gitattributes", "public/app.js", "public/index.html");
    rmSync(assetPath);
    rmSync(pagePath);
    git("checkout-index", "--all", "--force");

    const bytes = readFileSync(assetPath);
    const html = readFileSync(pagePath, "utf8");
    expect(bytes.includes(Buffer.from("\r\n"))).toBe(false);
    expect(html.includes("\r\n")).toBe(eol === "crlf");
    expect(html).toContain(reference(bytes));

    // A real edit must still require a new version, under either Git configuration.
    writeFileSync(assetPath, Buffer.concat([bytes, Buffer.from('\ndocument.title = "Changed calculator";\n')]));
    const changed = readFileSync(assetPath);
    expect(revision(changed)).not.toBe(revision(bytes));
    expect(html).not.toContain(reference(changed));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
