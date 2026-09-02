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
 * Parse CSV text into an array of rows, each an array of cell strings.
 * Blank lines are dropped. Returns [] for empty input.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSV(text) {
  if (text === null || text === undefined) return [];
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
    if (ch === ',') { endCell(); continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0 || sawCell) endRow();
  return rows;
}

/** Join one row of values into a CSV line, each cell escaped. */
function toCSVRow(values) {
  return values.map(escapeCSV).join(',');
}

module.exports = { escapeCSV, parseCSV, toCSVRow };
