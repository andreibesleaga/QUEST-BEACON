// BEACON — deterministic CSV export primitive (MW-D/D5.3; establishes the export precedent finding F-35
// recorded as MISSING: "there is no CSV/export precedent anywhere" in the codebase). Pure application layer:
// no adapters, no fs, no clock (F9/ADR-001).
//
// WHY A SHARED PRIMITIVE RATHER THAN A `rows.map(r => r.join(','))` INSIDE THE SHELTER MODULE.
// The next export (spec-delta §5's `GET /incidents/{id}/summary` CSV/JSON, FR-D6-4) will need exactly this,
// and two hand-rolled CSV writers in one system is the same duplication class as two denylists (F-141). One
// tested writer, imported.
//
// THE RULES, ALL THREE OF WHICH MATTER:
//   1. RFC 4180 QUOTING — a field is quoted when it contains a comma, a double quote, CR or LF; an embedded
//      double quote is doubled. Records are CRLF-terminated (the RFC's line break), including the last one.
//   2. FORMULA-INJECTION NEUTRALISATION (OWASP "CSV injection") — a spreadsheet interprets a cell beginning
//      `=`, `+`, `-`, `@`, TAB or CR as a FORMULA, which is how an exported field becomes code execution on
//      a responder's laptop. Such a cell is prefixed with a single quote. Numbers are emitted from the
//      NUMBER type, never re-parsed from text, so a negative number is never mistaken for a formula.
//   3. DETERMINISM — column order is the caller's declared order; no locale-dependent formatting, no clock,
//      no `toLocaleString`. Same rows in ⇒ byte-identical CSV out (asserted).
//
// ⚠ This module WRITES a document; it does not decide WHAT may be exported. The aggregate-only /
// no-person-identifying-field gate belongs at the export boundary of the calling module
// (`guardAggregateOnly`, ADR-035 §4 Layer D) — see `shelter-status.ts`.

/** One declared column: a stable header plus a total, pure accessor. */
export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number;
}

/** The RFC 4180 record separator. Exported so tests assert against the constant, never a retyped `'\r\n'`. */
export const CSV_RECORD_SEPARATOR = '\r\n';

/** Leading characters a spreadsheet may treat as the start of a formula (OWASP CSV injection). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Render one cell: neutralise formulas (strings only), then apply RFC 4180 quoting. */
export function csvCell(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : value;
  const neutralised = typeof value === 'number' || !FORMULA_LEAD.test(raw) ? raw : `'${raw}`;
  return /[",\r\n]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

/**
 * Render `rows` as an RFC 4180 CSV document with a header record. Total and deterministic; an empty `rows`
 * yields the header record alone (a header-only CSV is an honest "no rows", never an empty file that reads
 * as a failed export).
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(','));
  return [header, ...body].map((record) => `${record}${CSV_RECORD_SEPARATOR}`).join('');
}
