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

module.exports = { escapeCSV };
