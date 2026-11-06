/**
 * RFC 4180 CSV parsing.
 *
 * CMS public use files contain quoted fields with embedded commas, newlines
 * and doubled quotes (plan marketing names are the usual culprits). A
 * `split(",")` implementation silently shifts columns and produces plausible
 * but wrong premiums, which is the worst possible failure mode here — so this
 * parser handles quoting properly and validates the header.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Parse a CSV document into rows of raw string cells. */
function* csvRows(input: string): Generator<string[]> {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Strip a UTF-8 BOM, which CMS files frequently carry.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      yield row;
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) throw new CsvError("Unterminated quoted field at end of input.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

export function parseCsv(input: string): string[][] {
  return [...csvRows(input)];
}

/** Project the large Rate PUF one row at a time; preserve the same CSV quoting and BOM rules. */
export function* readRateRows(input: string, columns: readonly string[]): Generator<Record<string, string>> {
  let indices: number[] | undefined;
  for (const row of csvRows(input)) {
    if (!indices) {
      const header = row.map(cell => cell.trim());
      const positions = columns.map(name => header.indexOf(name));
      if (!positions.includes(-1)) indices = positions;
      continue;
    }
    const record: Record<string, string> = {};
    for (const [i, name] of columns.entries()) record[name] = (row[indices[i]!] ?? "").trim();
    yield record;
  }
  if (!indices) throw new CsvError("Rate PUF is missing its required header: " + columns.join(", "));
}

export interface CsvTable {
  readonly header: readonly string[];
  readonly rows: readonly Readonly<Record<string, string>>[];
}

/**
 * Parse into records keyed by column name, asserting that every required
 * column is present. A missing column means CMS changed the schema — better to
 * stop than to emit rows with silently-undefined premiums.
 */
export function parseCsvTable(input: string, requiredColumns: readonly string[] = []): CsvTable {
  const raw = parseCsv(input);

  // DKAN-era CMS exports can carry a preamble block ("N displayed records",
  // column index notes) ahead of the real header. When required columns are
  // known, scan the first rows for the one that has them all; a preamble
  // row never will.
  let headerRowIndex = 0;
  if (requiredColumns.length > 0) {
    const hasAll = (cells: readonly string[]) =>
      requiredColumns.every((c) => cells.some((h) => h.trim() === c));
    headerRowIndex = Math.max(0, raw.findIndex(hasAll));
  }
  const headerRow = raw[headerRowIndex];
  if (!headerRow) throw new CsvError("CSV input is empty.");

  const header = headerRow.map((h) => h.trim());
  const missing = requiredColumns.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new CsvError(
      `CSV is missing required column(s): ${missing.join(", ")}. ` +
        `Found: ${header.join(", ")}. The upstream schema may have changed — ` +
        `re-read the data dictionary before adjusting this parser.`,
    );
  }

  const rows = raw.slice(headerRowIndex + 1)
    .filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
    .map((r) => {
      const record: Record<string, string> = {};
      header.forEach((name, idx) => {
        record[name] = (r[idx] ?? "").trim();
      });
      return record;
    });

  return { header, rows };
}

/**
 * Parse a CMS money string ("$1,234.56", "1234.56", "") into integer cents.
 * Returns null for blank or unparseable values rather than coercing to 0 —
 * a zero premium and a missing premium are very different things.
 */
export function parseMoneyToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Parse a Rate PUF age label into a numeric key.
 * "0-14" -> 14, "21" -> 21, "64 and over" -> 64, "Family Option" -> null.
 */
export function parseRatePufAge(label: string): number | null {
  const trimmed = label.trim();
  if (/^0-14$/i.test(trimmed)) return 14;
  if (/^64 and over$/i.test(trimmed)) return 64;
  if (/^family option$/i.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 && n <= 120 ? n : null;
}
