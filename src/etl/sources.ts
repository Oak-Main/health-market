/**
 * CMS data sources.
 *
 * LICENSING
 * ---------
 * All sources below are US Government works in the public domain (17 U.S.C.
 * §105) and are published as federal open data. They may be redistributed and
 * transformed without attribution, though we attribute anyway because the
 * provenance is the product.
 *
 * The one source with real conditions is the CMS Marketplace API, which
 * requires a rotating key and which CMS states is "not designed to be scraped
 * or for the whole data set to be extracted". We therefore use the PUFs for
 * bulk derivation and reserve the API for spot verification only.
 *
 * @see https://www.cms.gov/marketplace/resources/data/public-use-files
 * @see https://developer.cms.gov/marketplace-api
 */

export interface DatasetSource {
  readonly id: string;
  readonly description: string;
  /** Landing page a human should read before trusting the file. */
  readonly landingPage: string;
  /** Direct download. DKAN datafile URLs and CMS PUF zips; see fetchText
   *  for ZIP/XLSX unpacking. */
  readonly downloadUrl: string;
  readonly licence: "public-domain";
  /**
   * Whether this URL has been confirmed to resolve from a networked
   * environment. Everything is false here because the build environment that
   * authored this file had all outbound HTTPS blocked by egress policy.
   */
  readonly urlVerified: boolean;
}

// CMS dates the 2026 Rate and Plan Attributes PUF revisions August 4, 2026:
// https://www.cms.gov/marketplace/resources/data/public-use-files (PY2026, checked November 5).
// A clean build on that date of verification produced 1,918 counties. Require review
// before replacing the release with fewer than 1,700 or with more than 10% skipped.
export const BENCHMARK_SOURCE_RELEASE = { planYear: 2026, ratePublished: "2026-08-04", minimumCounties: 1700 } as const;

/**
 * Datasets required to derive the benchmark for federally-facilitated states.
 *
 * The production benchmark pipeline below uses 2026 files. CMS has published
 * 2027 files, but that year needs its own validated sources and ZIP coverage.
 *
 * 2026-09-28 re-point: CMS retired the Socrata /resource/ API surface on
 * healthdata.gov and data.healthcare.gov (the portals moved to DKAN). Both
 * former Socrata datasets live on the new datafile paths below; the landscape
 * file is now an XLSX inside a ZIP, which fetchText unpacks.
 */
export const DATASETS = {
  qhpLandscapeIndividualMedical: {
    id: "qhp-landscape-individual-medical",
    description:
      "Certified individual-market medical QHPs by county, with premiums at " +
      "standard age points. Fastest path to a county-level sanity check.",
    landingPage: "https://data.healthcare.gov/dataset/qhp-landscape-py2026-individual-medical",
    downloadUrl: "https://data.healthcare.gov/datafile/py2026/individual_market_medical.zip",
    licence: "public-domain",
    urlVerified: true,
  },
  ratePuf: {
    id: "rate-puf",
    description:
      "Plan-level rates by age, tobacco status and rating area. The only " +
      "source with a rate for every single age, which is what an exact " +
      "household benchmark requires.",
    landingPage: "https://www.cms.gov/marketplace/resources/data/public-use-files",
    downloadUrl: "https://download.cms.gov/marketplace-puf/2026/rate-puf.zip",
    licence: "public-domain",
    urlVerified: false,
  },
  planAttributesPuf: {
    id: "plan-attributes-puf",
    description:
      "Metal level, market coverage, CSR variation type and service area for " +
      "each plan. Needed to filter to on-exchange individual silver plans.",
    landingPage: "https://www.cms.gov/marketplace/resources/data/public-use-files",
    downloadUrl: "https://download.cms.gov/marketplace-puf/2026/plan-attributes-puf.zip",
    licence: "public-domain",
    urlVerified: false,
  },
  serviceAreaPuf: {
    id: "service-area-puf",
    description: "Which counties and ZIPs each plan's service area covers.",
    landingPage: "https://www.cms.gov/marketplace/resources/data/public-use-files",
    downloadUrl: "https://download.cms.gov/marketplace-puf/2026/service-area-puf.zip",
    licence: "public-domain",
    urlVerified: false,
  },
  slcspCountyZip: {
    id: "slcsp-county-zip",
    description:
      "Official ZIP-to-county reference used by the HealthCare.gov tax tool. " +
      "Authoritative for resolving ZIPs that span multiple counties.",
    landingPage: "https://data.healthcare.gov/dataset/yaaf-rjhy",
    downloadUrl: "https://data.healthcare.gov/datafile/slcsp-county-zip-reference-data.yaaf-rjhy.csv",
    licence: "public-domain",
    urlVerified: true,
  },
} as const satisfies Record<string, DatasetSource>;

export type DatasetKey = keyof typeof DATASETS;

/** Spot-verification endpoint. Requires a key that rotates every 60 days. */
export const MARKETPLACE_API = {
  base: "https://marketplace.api.healthcare.gov/api/v1",
  keyRequest: "https://developer.cms.gov/marketplace-api/key-request.html",
  spec: "https://developer.cms.gov/marketplace-api/api-spec",
  note:
    "Rate limited; keys expire every 60 days and are re-issued by email. CMS " +
    "states the API is not designed for bulk extraction — use it to verify a " +
    "sample of PUF-derived benchmarks, never to populate the dataset.",
} as const;

export class NetworkBlockedError extends Error {
  constructor(readonly sourceUrl: string, readonly underlying: unknown) {
    super(
      `Could not reach ${sourceUrl}.\n\n` +
        `If this is a sandboxed or policy-restricted environment, outbound HTTPS ` +
        `to CMS may be blocked. Verify with:\n` +
        `  curl -sS "$HTTPS_PROXY/__agentproxy/status"\n\n` +
        `Run the ETL from an environment with network access to *.cms.gov, ` +
        `*.healthcare.gov and healthdata.gov, then commit the generated shards.\n\n` +
        `Underlying error: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
    );
    this.name = "NetworkBlockedError";
  }
}

export interface FetchOptions {
  readonly retries?: number;
  readonly timeoutMs?: number;
}

/** Fetch with bounded exponential backoff and an explicit, actionable failure. */
export async function fetchText(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  const retries = options.retries ?? 4;
  const timeoutMs = options.timeoutMs ?? 120_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "text/csv,application/json;q=0.9,*/*;q=0.8" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      // CMS publishes several PUFs as ZIP archives holding one CSV (and the
      // PY2026 landscape as a ZIP holding one XLSX). The retired Socrata
      // paths served plain CSV; unpack archives before parsing.
      if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
        return unzipFirstTable(buffer, url);
      }
      return new TextDecoder("utf-8").decode(buffer);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2 ** (attempt + 1) * 1000));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new NetworkBlockedError(url, lastError);
}

/**
 * Extract table text from a ZIP whose payload is one CSV or — as CMS ships
 * the PY2026 landscape files — one XLSX. Picks the largest data member;
 * instruction sidecars are never .csv/.xlsx. XLSX workbooks are ZIPs of XML,
 * unpacked with the same fflate dependency (shared strings + first sheet,
 * which is all these single-sheet exports contain).
 */
async function unzipFirstTable(buffer: Uint8Array, sourceUrl: string): Promise<string> {
  const { unzip } = await import("fflate");
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(buffer, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const csv = largestMember(files, /\.csv$/i);
  if (csv) return new TextDecoder("utf-8").decode(csv);

  const workbook = largestMember(files, /\.xlsx$/i);
  if (workbook) {
    const inner = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
      unzip(workbook, (err, data) => (err ? reject(err) : resolve(data)));
    });
    return xlsxToCsv(inner, sourceUrl);
  }
  throw new Error(`ZIP from ${sourceUrl} contains no CSV/XLSX member (found: ${Object.keys(files).join(", ")})`);
}

function largestMember(parts: Record<string, Uint8Array>, namePattern: RegExp): Uint8Array | undefined {
  let largest: Uint8Array | undefined;
  for (const [name, bytes] of Object.entries(parts)) {
    if (namePattern.test(name) && (!largest || bytes.length > largest.length)) largest = bytes;
  }
  return largest;
}

/** Column letters ("A", "AA") -> 0-based index. */
function colIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function csvQuote(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** One-sheet XLSX parts -> CSV text with a header row, as the Socrata feed served. */
function xlsxToCsv(parts: Record<string, Uint8Array>, sourceUrl: string): string {
  // Workbooks can carry a small notes sheet ahead of the data sheet (the
  // PY2026 landscape does); the data sheet is always the largest worksheet.
  const worksheet = largestMember(parts, /^xl\/worksheets\/[^/]+\.xml$/i);
  if (!worksheet) {
    throw new Error(`XLSX from ${sourceUrl} has no worksheet part (found: ${Object.keys(parts).join(", ")})`);
  }
  // Each indexed capture below is mandatory in its matching expression. Empty tags capture "".
  const shared: string[] = [];
  const sharedXml = parts["xl/sharedStrings.xml"];
  if (sharedXml) {
    const xml = new TextDecoder("utf-8").decode(sharedXml);
    for (const si of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
      shared.push(
        Array.from(si[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) => decodeXml(t[1]!)).join(""),
      );
    }
  }
  const sheet = new TextDecoder("utf-8").decode(worksheet);
  const rows: string[] = [];
  // exec-loop rather than matchAll: the data sheet can be hundreds of MB and
  // matchAll would materialise every row substring at once.
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheet)) !== null) {
    const cells: string[] = [];
    const cellRe = /<c(\s[^>]*)?>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]!)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const body = cellMatch[2]!;
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
      const idx = refMatch ? colIndex(refMatch[1]!) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "s") {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? (shared[Number(v[1])] ?? "") : "";
      } else if (type === "inlineStr") {
        value = Array.from(body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (t) => decodeXml(t[1]!)).join("");
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? decodeXml(v[1]!) : "";
      }
      while (cells.length < idx) cells.push("");
      cells[idx] = value ?? "";
    }
    rows.push(cells.map(csvQuote).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}
