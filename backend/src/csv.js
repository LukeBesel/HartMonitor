'use strict';

// ─── CSV cell escaping (shared by every export endpoint) ─────────────────────
//
// Two separate jobs, both required:
//
// 1. RFC-4180 quoting so commas / quotes / newlines don't break the row shape.
//
// 2. Formula neutralization. These files are explicitly produced for Excel
//    (we even prepend a UTF-8 BOM), and Excel/Sheets/LibreOffice treat a cell
//    beginning with `=`, `+`, `-`, `@`, TAB or CR as a FORMULA — quoting does
//    not stop that. Operator names, typed values, widget labels and NCR text
//    are all attacker-controllable, so an exported file could execute
//    `=HYPERLINK(...)`, `=cmd|...`, or exfiltrate cells via WEBSERVICE().
//    Prefixing with an apostrophe forces the cell to be read as text; the
//    apostrophe is not shown by the spreadsheet.
//
//    Plain numbers are exempt so `-12.5` stays numeric — `-1+1` (a formula)
//    does not match the numeric pattern and is still neutralized.

const FORMULA_LEAD = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  if (FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── CSV parsing (RFC-4180) ──────────────────────────────────────────────────
//
// The other half of the job. Every import path that used to hand-roll a
// `line.split(',')` got quoted commas wrong, and every file exported from Excel
// on Windows ends its lines with CRLF, so a naive split leaves a stray \r glued
// to the last cell of every row — which is why "Weld\r" would not match the app
// called "Weld".
//
// Handled here, once:
//   * quoted cells, with "" as an escaped quote
//   * commas and newlines INSIDE quoted cells
//   * CR, LF and CRLF line endings, mixed in one file
//   * a UTF-8 BOM at the start (Excel writes one; we write one too)
//   * a trailing newline, which is not an extra empty row
//
// Deliberately NOT handled: the leading apostrophe escapeCSV() adds to
// formula-shaped cells is left in place. It is part of the value the exporter
// chose to write, and silently stripping it here would let a round-trip change
// data.

/**
 * Parse delimited text into an array of rows, each an array of cell strings.
 * Blank lines are dropped. Returns [] for empty input.
 *
 * The delimiter is a parameter because a "CSV" out of a European Excel is
 * semicolon-separated and a paste out of a spreadsheet is tab-separated. The
 * quoting rules are identical in all three; only the separator moves.
 *
 * @param {string} text
 * @param {string} [delimiter=','] single separator character
 * @returns {string[][]}
 */
function parseCSV(text, delimiter = ',') {
  if (text === null || text === undefined) return [];
  const sep = (typeof delimiter === 'string' && delimiter.length === 1) ? delimiter : ',';
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let sawCell = false; // distinguishes a real empty cell from an empty line

  const endCell = () => { row.push(cell); cell = ''; sawCell = true; };
  const endRow = () => {
    endCell();
    // A line that held nothing at all is not a row of data.
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    sawCell = false;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue; }
    if (ch === sep) { endCell(); continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0 || sawCell) endRow();
  return rows;
}

/**
 * What separates this file's cells, and where its data starts.
 *
 * Two things real exports do that a plain comma-split gets wrong:
 *   * Excel writes a `sep=;` line above the header so IT knows the separator.
 *     Every other reader sees it as a one-cell first row and then reads the
 *     real header as data.
 *   * A European Excel and a spreadsheet paste use `;` and TAB. A comma-split
 *     turns the whole line into one cell whose name matches no column, and the
 *     importer then reports every field missing on every row — technically true
 *     and completely useless.
 *
 * So: honour an explicit `sep=`, else pick the separator that actually appears
 * in the header line, preferring the comma when it is there at all.
 *
 * @param {string} text
 * @returns {{ delimiter: string, body: string }} body has any `sep=` line removed
 */
function sniffDelimiter(text) {
  let s = String(text === null || text === undefined ? '' : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

  const firstBreak = s.search(/\r\n|\r|\n/);
  const firstLine = firstBreak === -1 ? s : s.slice(0, firstBreak);
  const rest = firstBreak === -1 ? '' : s.slice(firstBreak).replace(/^(?:\r\n|\r|\n)/, '');

  const declared = firstLine.match(/^sep=(.)\s*$/i);
  if (declared) return { delimiter: declared[1], body: rest };

  if (firstLine.includes(',')) return { delimiter: ',', body: s };
  if (firstLine.includes('\t')) return { delimiter: '\t', body: s };
  if (firstLine.includes(';')) return { delimiter: ';', body: s };
  return { delimiter: ',', body: s };
}

/** Join one row of values into a CSV line, each cell escaped. */
function toCSVRow(values) {
  return values.map(escapeCSV).join(',');
}

module.exports = { escapeCSV, parseCSV, toCSVRow, sniffDelimiter };
