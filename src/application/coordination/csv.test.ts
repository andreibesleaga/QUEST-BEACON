// BEACON — CSV export primitive tests (MW-D/D5.3; the export precedent F-35 recorded as missing).
import { describe, it, expect } from 'vitest';
import { CSV_RECORD_SEPARATOR, csvCell, toCsv, type CsvColumn } from './csv.js';

interface Row {
  readonly label: string;
  readonly count: number;
}

const COLUMNS: readonly CsvColumn<Row>[] = [
  { header: 'label', value: (r) => r.label },
  { header: 'count', value: (r) => r.count },
];

describe('csvCell — RFC 4180 quoting', () => {
  it('leaves a plain field unquoted', () => {
    expect(csvCell('shelter-1')).toBe('shelter-1');
    expect(csvCell('')).toBe('');
  });

  it('quotes a field containing a comma, a quote, CR or LF, doubling embedded quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\rline2')).toBe('"line1\rline2"');
  });

  it('renders numbers from the NUMBER type — a negative number is never treated as a formula', () => {
    expect(csvCell(0)).toBe('0');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0.75)).toBe('0.75');
  });
});

describe('csvCell — formula-injection neutralisation (OWASP CSV injection)', () => {
  it('prefixes a string cell that a spreadsheet would execute', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tsneaky')).toBe("'\tsneaky");
  });

  it('neutralises AND quotes when the payload also contains a comma', () => {
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe(
      '"\'=HYPERLINK(""http://x"",""click"")"',
    );
  });
});

describe('toCsv', () => {
  it('writes a header record plus one CRLF-terminated record per row, in declared column order', () => {
    const csv = toCsv(
      [
        { label: 'a', count: 1 },
        { label: 'b', count: 2 },
      ],
      COLUMNS,
    );
    expect(csv).toBe(
      `label,count${CSV_RECORD_SEPARATOR}a,1${CSV_RECORD_SEPARATOR}b,2${CSV_RECORD_SEPARATOR}`,
    );
    expect(CSV_RECORD_SEPARATOR).toBe('\r\n');
  });

  it('emits the header alone for an empty row set — an honest "no rows", never an empty file', () => {
    expect(toCsv([], COLUMNS)).toBe(`label,count${CSV_RECORD_SEPARATOR}`);
  });

  it('is byte-identical across runs (deterministic, no locale, no clock)', () => {
    const rows: readonly Row[] = [
      { label: 'β', count: 3 },
      { label: 'a,b', count: 4 },
    ];
    expect(toCsv(rows, COLUMNS)).toBe(toCsv(rows, COLUMNS));
    expect(toCsv(rows, COLUMNS)).toContain('"a,b",4');
  });

  it('escapes a header that needs it, exactly like a cell', () => {
    expect(toCsv([], [{ header: 'a,b', value: () => '' }])).toBe(`"a,b"${CSV_RECORD_SEPARATOR}`);
  });
});
