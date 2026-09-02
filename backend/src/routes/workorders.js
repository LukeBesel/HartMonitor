const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { parseCSV, toCSVRow, sniffDelimiter } = require('../csv');
const { logActivity } = require('../activity');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');

const router = express.Router();

const STATUS_LABELS = {
  pending: 'Pending', in_progress: 'In Progress', completed: 'Completed',
  overdue: 'Overdue', cancelled: 'Cancelled',
};
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };

function departmentName(id) {
  if (!id) return 'None';
  return db.prepare('SELECT name FROM departments WHERE id = ?').get(id)?.name || 'Unknown';
}

function fmtDate(iso) {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─── Schedule status helper ───────────────────────────────────────────────────

function calcScheduleStatus(wo) {
  if (wo.status === 'completed') return 'completed';
  const now   = new Date();
  const start = new Date(wo.scheduled_start);
  const end   = new Date(wo.scheduled_end);
  if (now < start) return 'not_started';
  if (now > end && wo.quantity_completed < wo.quantity) return 'overdue';
  const totalMs    = end - start;
  const elapsedMs  = Math.min(now - start, totalMs);
  const pctTime    = elapsedMs / totalMs;
  const expectedQty = Math.ceil(pctTime * wo.quantity);
  if (wo.quantity_completed >= expectedQty * 0.95) return 'on_track';
  if (wo.quantity_completed >= expectedQty * 0.75) return 'at_risk';
  return 'behind';
}

function enrichWorkOrder(wo) {
  return {
    ...wo,
    schedule_status: calcScheduleStatus(wo),
    completion_pct: wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0,
  };
}

// ─── Generate next work order number (per-company sequence) ───────────────────

/**
 * The next `count` numbers this company's sequence will hand out, in order.
 *
 * An import has to know these BEFORE it writes anything: the preview promises a
 * verdict per row, and a row that supplies "WO-2026-004" by hand must be told it
 * collides with the number a numberless sibling is about to be given — not
 * discover it as a unique-index failure that takes the whole batch down.
 *
 * One MAX() read for the whole batch, then counted forward in memory.
 */
function allocateWorkOrderNumbers(companyId, count) {
  const year   = new Date().getFullYear();
  const prefix = `WO-${year}-`;
  // Take the numeric max of the trailing sequence, not a lexical ORDER BY —
  // otherwise WO-2026-1000 sorts before WO-2026-999 and the id collides.
  const row = db.prepare(
    `SELECT MAX(CAST(substr(work_order_number, ?) AS INTEGER)) AS max_seq FROM work_orders WHERE company_id = ? AND work_order_number LIKE ?`
  ).get(prefix.length + 1, companyId, prefix + '%');
  let seq = row && row.max_seq ? row.max_seq : 0;
  const out = [];
  for (let i = 0; i < count; i++) out.push(`${prefix}${String(++seq).padStart(3, '0')}`);
  return out;
}

function nextWorkOrderNumber(companyId) {
  return allocateWorkOrderNumbers(companyId, 1)[0];
}

// Returns the id if the row exists in this company, else null. Keeps foreign
// references (department/app/site) from pointing at another tenant's records,
// which would leak their names through the enriched JOINs.
function ownedOrNull(table, id, companyId) {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? AND company_id = ?`).get(id, companyId);
  return row ? id : null;
}

// A product type must belong to this company AND to the work order's app —
// otherwise BOM resolution at run start could join across apps (or tenants).
function ownedProductTypeOrNull(productTypeId, appId, companyId) {
  if (!productTypeId) return null;
  const pt = db.prepare('SELECT id, app_id FROM product_types WHERE id = ? AND company_id = ?')
    .get(productTypeId, companyId);
  if (!pt) return null;
  if (!appId || pt.app_id !== appId) return null;
  return productTypeId;
}

// ─── ERP / spreadsheet import ────────────────────────────────────────────────
//
// One validator behind two doors. A planner pasting this week's job list into
// the Schedule and an ERP POSTing the same rows to /api/v1/work-orders run
// through exactly the same code, so the preview a human reads is the truth the
// machine gets — there is no second, more forgiving parser hiding behind the
// API key.
//
// The three rules that make a re-import safe:
//
//   1. external_id is the match key. A row carrying one updates the work order
//      that already holds it (per company); a row without one is always a
//      create. Sending yesterday's file again therefore reports "updated", not
//      200 fresh duplicates.
//   2. Nothing is coerced. A quantity of "ten", an app name nobody recognises
//      and a due date of "next Tuesday" are REJECTED with the reason printed
//      next to the row — never rounded to 0, never quietly set to NULL.
//   3. A rejected row blocks only itself. The other 199 rows still land, in one
//      transaction, so the planner fixes two lines rather than re-running the
//      whole file.

const MAX_IMPORT_ROWS = 2000;

/** The canonical import columns, in the order the CSV template prints them. */
const IMPORT_COLUMNS = Object.freeze([
  'work_order_number', 'external_id', 'part_number', 'part_name', 'quantity',
  'due_date', 'customer_ref', 'app_name', 'department_name', 'routing_name',
  'priority', 'scheduled_start', 'scheduled_end', 'notes',
]);

// Header aliases. A header is normalised to lowercase letters-and-digits before
// lookup, so "WO Number", "wo_number", "WO #" and "wonumber" are one key. Real
// files come out of a dozen ERPs and nobody is going to rename their columns to
// match ours.
const HEADER_ALIASES = Object.freeze({
  work_order_number: ['workordernumber', 'workorderno', 'workorder', 'wonumber', 'wonum', 'wono', 'wo', 'ordernumber', 'orderno', 'jobnumber', 'jobno', 'job'],
  external_id:       ['externalid', 'external', 'externalref', 'externalreference', 'erpid', 'erpref', 'erpreference', 'sourceid', 'extid'],
  part_number:       ['partnumber', 'partno', 'partnum', 'part', 'pn', 'itemnumber', 'itemno', 'sku'],
  part_name:         ['partname', 'name', 'description', 'partdescription', 'itemname', 'itemdescription', 'desc'],
  quantity:          ['quantity', 'qty', 'qtyordered', 'orderqty', 'orderquantity', 'quantityordered', 'quantityrequired'],
  due_date:          ['duedate', 'due', 'dueon', 'datedue', 'needby', 'needbydate', 'requireddate', 'requiredby', 'promisedate'],
  customer_ref:      ['customerref', 'customerreference', 'customer', 'customerpo', 'customerorder', 'po', 'ponumber', 'salesorder', 'salesorderno'],
  app_name:          ['appname', 'app', 'process', 'application'],
  department_name:   ['departmentname', 'department', 'deptname', 'dept', 'area', 'workcenter', 'workcentre'],
  routing_name:      ['routingname', 'routing', 'routename', 'route'],
  priority:          ['priority', 'prio', 'urgency'],
  scheduled_start:   ['scheduledstart', 'scheduledstartdate', 'plannedstart', 'startdate', 'startat', 'start'],
  scheduled_end:     ['scheduledend', 'scheduledenddate', 'plannedend', 'enddate', 'endat', 'end', 'finish', 'finishdate'],
  notes:             ['notes', 'note', 'comments', 'comment', 'remarks', 'memo'],
});

// Flattened alias → canonical. Built once, and it throws on a duplicate alias
// rather than letting one column silently shadow another.
const ALIAS_TO_FIELD = (() => {
  const map = new Map();
  for (const field of IMPORT_COLUMNS) {
    for (const alias of [normalizeHeader(field), ...(HEADER_ALIASES[field] || [])]) {
      if (map.has(alias) && map.get(alias) !== field) {
        throw new Error(`[workorders] duplicate import header alias "${alias}" (${map.get(alias)} vs ${field})`);
      }
      map.set(alias, field);
    }
  }
  return map;
})();

function normalizeHeader(h) {
  return String(h === null || h === undefined ? '' : h).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The CSV header row a planner downloads, canonical names in template order. */
function importTemplateCSV() {
  return toCSVRow(IMPORT_COLUMNS) + '\r\n';
}

/**
 * CSV text → row objects keyed by their own header names. Header mapping and
 * validation happen later, in the one validator, so a pasted file and a JSON
 * body take the same path. The separator is sniffed (comma, tab, semicolon, or
 * whatever an Excel `sep=` line declares) because half the files a shop has are
 * not comma-separated.
 * @returns {{ rows: object[], headers: string[], delimiter: string }}
 */
function rowsFromCSV(text) {
  const { delimiter, body } = sniffDelimiter(text);
  const table = parseCSV(body, delimiter);
  if (table.length === 0) return { rows: [], headers: [], delimiter };
  const headers = table[0].map(h => String(h || '').trim());
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    // A line of nothing but separators is spreadsheet padding, not a job.
    if (cells.every(c => String(c || '').trim() === '')) continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = cells[c] === undefined ? '' : cells[c];
    }
    rows.push(obj);
  }
  return { rows, headers, delimiter };
}

/**
 * Refuse a file whose columns are ambiguous or unreadable, before any row is
 * judged. Two failures worth one clear message instead of N confusing ones:
 *
 *   * TWO COLUMNS, ONE FIELD. "Qty Ordered" and "quantity" both mean quantity.
 *     Picking one and ignoring the other is how an empty "Qty Ordered" masks a
 *     filled "quantity" and every row is rejected as missing a quantity — or,
 *     worse, how "qty 900" quietly wins over "quantity 5" and the shop builds
 *     900 of something. There is no safe guess; say so and let the planner
 *     delete a column.
 *   * NOTHING RESOLVES. A file whose headers we recognise none of produces a
 *     "required" reason on every field of every row. One message naming the
 *     headers we actually found is what tells a planner they exported the wrong
 *     report.
 *
 * @param {object[]} rows
 * @returns {{ status: number, body: object } | null} ready-to-send error, or null
 */
function checkImportHeaders(rows) {
  const sources = new Map();   // canonical field → [source headers, in order seen]
  const found = [];            // every distinct header, for the "nothing resolved" message
  const seenRaw = new Set();

  for (const raw of rows) {
    for (const key of Object.keys(raw || {})) {
      const header = String(key);
      if (!seenRaw.has(header)) { seenRaw.add(header); if (header.trim()) found.push(header); }
      const field = ALIAS_TO_FIELD.get(normalizeHeader(header));
      if (!field) continue;
      const list = sources.get(field) || [];
      if (!list.includes(header)) list.push(header);
      sources.set(field, list);
    }
  }

  for (const [field, headers] of sources) {
    if (headers.length > 1) {
      return {
        status: 400,
        body: {
          error: 'ambiguous_columns',
          field,
          columns: headers,
          message: `two columns map to ${field} (${headers.map(h => `"${h}"`).join(', ')}) — remove one`,
        },
      };
    }
  }

  if (sources.size === 0) {
    return {
      status: 400,
      body: {
        error: 'unrecognised_columns',
        columns: found,
        message: `unrecognised_columns: ${found.length ? found.join(', ') : '(none)'}`,
      },
    };
  }
  return null;
}

// ─── Field-level checks ──────────────────────────────────────────────────────

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day written YYYY-MM-DD (so 2026-02-31 is false). */
function isCalendarDate(s) {
  if (!DATE_ONLY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Accepts YYYY-MM-DD, YYYY-MM-DD HH:MM[:SS] and the same with a 'T'. Returns
 * the value in the 'YYYY-MM-DDTHH:MM' shape the rest of the app stores, or null
 * when it is not a date this system can read. Punctuation is normalised; the
 * instant is never guessed at.
 */
function normalizeDateTime(s) {
  const v = String(s).trim();
  if (isCalendarDate(v)) return `${v}T00:00`;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  if (!isCalendarDate(m[1])) return null;
  const hh = Number(m[2]), mm = Number(m[3]), ss = m[4] === undefined ? 0 : Number(m[4]);
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${m[1]}T${m[2]}:${m[3]}`;
}

/** Lower-cased name → id for one company's rows of a table. First name wins. */
function nameIndex(table, companyId) {
  const idx = new Map();
  for (const r of db.prepare(`SELECT id, name FROM ${table} WHERE company_id = ?`).all(companyId)) {
    const key = String(r.name || '').trim().toLowerCase();
    if (key && !idx.has(key)) idx.set(key, r.id);
  }
  return idx;
}

const MAX_IMPORT_QUANTITY = 1000000;

/** Statuses an import may not touch. Reopen the job on the Schedule first. */
const CLOSED_STATUSES = Object.freeze(['completed', 'cancelled']);

/**
 * An external_id has to survive being a URL path segment (PATCH
 * /api/v1/work-orders/:external_id) and being read back by a human. "." and
 * ".." are not ids, and a slash cuts the path in half.
 */
function externalIdProblem(v) {
  if (v === '.' || v === '..') return 'external_id cannot be "." or ".."';
  if (v.includes('/') || v.includes('\\')) return 'external_id cannot contain "/" or "\\"';
  return null;
}

/**
 * Validate a batch of import rows and, unless dryRun, apply it.
 *
 * @param {string} companyId        tenant every row is written into — taken from
 *                                  the session or the API key, NEVER from a row
 * @param {object[]} rows           row objects keyed by whatever headers the
 *                                  source used
 * @param {{ dryRun?: boolean, actor?: string }} [opts]
 * @returns {{ results: object[], summary: object, dry_run: boolean }}
 *          results[i] = { row, result, reason, work_order_id, work_order_number,
 *                         external_id }
 *          result is one of vocab.IMPORT_ROW_RESULT. `reason` carries
 *          'nothing changed' on an update that matched the stored values.
 *          summary = { total, created, updated, rejected, unchanged }, where
 *          `unchanged` is the subset of `updated` that wrote nothing.
 */
// Columns an import may set on an existing work order. work_order_number is NOT
// here: renumbering is decided per row and applied only to a job nobody has
// started.
const UPDATABLE_BY_IMPORT = Object.freeze([
  'part_number', 'part_name', 'quantity', 'due_date', 'customer_ref',
  'app_id', 'department_id', 'routing_id', 'priority',
  'scheduled_start', 'scheduled_end', 'notes',
]);

function validateAndUpsertRows(companyId, rows, opts = {}) {
  const dryRun = opts.dryRun === true;
  const actor = opts.actor || 'Import';

  const apps        = nameIndex('apps', companyId);
  const departments = nameIndex('departments', companyId);
  const routings    = nameIndex('product_routings', companyId);

  const findByExternal = db.prepare(
    'SELECT * FROM work_orders WHERE company_id = ? AND external_id = ?'
  );
  const findByNumber = db.prepare(
    'SELECT id FROM work_orders WHERE company_id = ? AND work_order_number = ?'
  );

  // Map one raw row's keys onto canonical fields. checkImportHeaders() has
  // already refused a file where two headers claim the same field, so the first
  // hit here is the only hit.
  const mapFields = raw => {
    const f = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const field = ALIAS_TO_FIELD.get(normalizeHeader(k));
      if (!field || f[field] !== undefined) continue;   // unknown column: ignored
      f[field] = v === null || v === undefined ? '' : String(v).trim();
    }
    return f;
  };
  const mapped = rows.map(mapFields);

  // ── Pre-pass: which rows will be handed an automatic number, and which ─────
  // Without this the preview cannot be honest. A row that says WO-2026-004 is
  // fine against the database today and collides at commit with the number a
  // numberless sibling above it gets. Reserving them here turns that into a
  // per-row rejection both the preview and the commit report identically.
  //
  // The pre-pass judges nothing: it only asks "no number supplied, and not an
  // update?". A reserved number whose row is later rejected for some other
  // reason simply leaves a gap in the sequence, which is what a shop's numbers
  // do anyway.
  const autoRows = [];
  mapped.forEach((f, i) => {
    const num = f.work_order_number;
    if (num) return;
    const ext = f.external_id;
    if (ext && findByExternal.get(companyId, ext)) return;   // an update, not a create
    autoRows.push(i);
  });
  const allocated = allocateWorkOrderNumbers(companyId, autoRows.length);
  const autoNumberFor = new Map();   // row index → the number it will be given
  const reservedBy    = new Map();   // number → 1-based row that will take it
  autoRows.forEach((rowIndex, n) => {
    autoNumberFor.set(rowIndex, allocated[n]);
    reservedBy.set(allocated[n], rowIndex + 1);
  });

  const seenExternal = new Map();  // external_id → row number already claiming it
  const seenNumber   = new Map();  // work_order_number → row number

  const plans = [];

  mapped.forEach((f, i) => {
    const rowNo = i + 1;
    const reasons = [];
    const has = name => f[name] !== undefined && f[name] !== '';

    // ── external_id: the match key, so its shape is checked before it is used ──
    const externalId = has('external_id') ? f.external_id : '';
    let existing = null;
    if (externalId) {
      const problem = externalIdProblem(externalId);
      if (problem) {
        reasons.push(problem);
      } else if (seenExternal.has(externalId)) {
        reasons.push(`external_id "${externalId}" appears more than once in this file (first on row ${seenExternal.get(externalId)})`);
      } else {
        seenExternal.set(externalId, rowNo);
        existing = findByExternal.get(companyId, externalId) || null;
      }
    }
    const isUpdate = Boolean(existing);

    // ── A closed job is not something an ERP file may quietly reopen ──────────
    if (isUpdate && CLOSED_STATUSES.includes(existing.status)) {
      reasons.push(`work order is ${existing.status} — reopen it before importing changes`);
    }

    // ── Quantity ──
    // A whole number, no leading zeros ("007" is a part number habit, not the
    // integer 7), inside a range SQLite will store as an INTEGER. 1e20 was
    // silently becoming a float in an INTEGER column.
    let quantity = null;
    if (has('quantity')) {
      if (/^0\d+$/.test(f.quantity)) {
        reasons.push('quantity must not have leading zeros');
      } else {
        const n = Number(f.quantity);
        if (!/^\d+$/.test(f.quantity) || !Number.isSafeInteger(n) || n < 1 || n > MAX_IMPORT_QUANTITY) {
          reasons.push(`quantity must be a whole number between 1 and ${MAX_IMPORT_QUANTITY.toLocaleString('en-US')}`);
        } else {
          quantity = n;
        }
      }
    } else if (!isUpdate) {
      reasons.push(`quantity must be a whole number between 1 and ${MAX_IMPORT_QUANTITY.toLocaleString('en-US')}`);
    }
    // Cutting the order below what the floor has already built prints 60/10 on
    // the Schedule — 600% complete. The file is wrong; say which number it is.
    if (quantity !== null && isUpdate && quantity < existing.quantity_completed) {
      reasons.push(`quantity ${quantity} is below the ${existing.quantity_completed} already completed`);
    }

    // ── The two things a brand-new job cannot be created without ──
    if (!isUpdate) {
      if (!has('part_number')) reasons.push('part_number is required');
      if (!has('part_name'))   reasons.push('part_name is required');
    }

    // ── Dates ──
    let dueDate = null;
    if (has('due_date')) {
      if (!isCalendarDate(f.due_date)) reasons.push('due_date must be YYYY-MM-DD');
      else dueDate = f.due_date;
    }
    let schedStart = null, schedEnd = null;
    for (const [field, set] of [['scheduled_start', v => { schedStart = v; }], ['scheduled_end', v => { schedEnd = v; }]]) {
      if (!has(field)) continue;
      const norm = normalizeDateTime(f[field]);
      if (norm === null) reasons.push(`${field} must be YYYY-MM-DD or YYYY-MM-DD HH:MM`);
      else set(norm);
    }
    // Compared against what the work order will actually hold, so an update
    // that moves only the start cannot leave the window inside out.
    const effStart = schedStart !== null ? schedStart : (existing ? existing.scheduled_start : null);
    const effEnd   = schedEnd   !== null ? schedEnd   : (existing ? existing.scheduled_end   : null);
    if (effStart && effEnd && String(effEnd) < String(effStart)) {
      reasons.push(`scheduled_end (${effEnd}) is before scheduled_start (${effStart})`);
    }

    // ── Priority ──
    let priority = null;
    if (has('priority')) {
      const p = f.priority.toLowerCase();
      if (!PRIORITY_LABELS[p]) reasons.push(`priority must be one of: ${Object.keys(PRIORITY_LABELS).join(', ')}`);
      else priority = p;
    }

    // ── Names resolved to ids, inside this company only ──
    let appId = null, deptId = null, routingId = null;
    if (has('app_name')) {
      appId = apps.get(f.app_name.toLowerCase()) || null;
      if (!appId) reasons.push(`app "${f.app_name}" not found`);
    }
    if (has('department_name')) {
      deptId = departments.get(f.department_name.toLowerCase()) || null;
      if (!deptId) reasons.push(`department "${f.department_name}" not found`);
    }
    if (has('routing_name')) {
      routingId = routings.get(f.routing_name.toLowerCase()) || null;
      if (!routingId) reasons.push(`routing "${f.routing_name}" not found`);
    }

    // ── Work order number ──
    const woNumber = has('work_order_number') ? f.work_order_number : '';
    let renumber = false;
    if (woNumber) {
      const reservedFor = reservedBy.get(woNumber);
      const takenInFile = seenNumber.get(woNumber);
      if (reservedFor !== undefined) {
        reasons.push(`work_order_number "${woNumber}" collides with a number this import will assign`);
      } else if (takenInFile) {
        reasons.push(`work_order_number "${woNumber}" appears more than once in this file (first on row ${takenInFile})`);
      } else {
        seenNumber.set(woNumber, rowNo);
        const clash = findByNumber.get(companyId, woNumber);
        if (clash && (!existing || clash.id !== existing.id)) {
          reasons.push(`work_order_number "${woNumber}" already exists`);
        }
      }
      // Renaming a job the floor is already running breaks every printed
      // traveller and QR label carrying the old number. Only a job nobody has
      // started may be renumbered.
      if (existing && woNumber !== existing.work_order_number) {
        if (existing.status === 'pending') renumber = true;
        else reasons.push(`work_order_number cannot be changed — work order is ${existing.status}`);
      }
    }

    const values = {
        work_order_number: woNumber || null,
        part_number: has('part_number') ? f.part_number : null,
        part_name:   has('part_name')   ? f.part_name   : null,
        quantity,
        due_date: dueDate,
        customer_ref: has('customer_ref') ? f.customer_ref : null,
        app_id: appId,
        department_id: deptId,
        routing_id: routingId,
        priority,
        scheduled_start: schedStart,
      scheduled_end: schedEnd,
      notes: has('notes') ? f.notes : null,
    };

    // Which stored columns this row would actually move. Worked out here, not
    // at write time, so the preview can say "nothing changed" about exactly the
    // rows the commit will leave alone — a row that reads differently before
    // and after pressing Import is the bug this whole file is about.
    const changed = [];
    if (existing && reasons.length === 0) {
      for (const col of UPDATABLE_BY_IMPORT) {
        if (values[col] === null) continue;
        if (existing[col] === values[col]) continue;
        changed.push(col);
      }
      if (renumber) changed.push('work_order_number');
    }

    plans.push({
      rowNo,
      externalId: externalId || null,
      existing,
      reasons,
      renumber,
      changed,
      autoNumber: autoNumberFor.get(i) || null,
      values,
    });
  });

  const results = plans.map(p => ({
    row: p.rowNo,
    result: p.reasons.length ? 'rejected' : (p.existing ? 'updated' : 'created'),
    reason: p.reasons.length
      ? p.reasons.join('; ')
      : (p.existing && p.changed.length === 0 ? 'nothing changed' : null),
    external_id: p.externalId,
    work_order_id: p.existing ? p.existing.id : null,
    // A create's number is the one reserved for it above — the same number the
    // commit will actually write, so preview and commit read alike. A REJECTED
    // row gets none: its reserved number is never spent, and printing one next
    // to a row that will not exist is the preview promising a job it cannot
    // deliver.
    work_order_number: p.values.work_order_number
      || (p.existing ? p.existing.work_order_number : (p.reasons.length ? null : p.autoNumber)),
  }));

  if (!dryRun) {
    const insert = db.prepare(`
      INSERT INTO work_orders
        (id, work_order_number, part_number, part_name, quantity, quantity_completed,
         app_id, department_id, routing_id, scheduled_start, scheduled_end,
         takt_time_minutes, status, priority, notes, company_id,
         due_date, customer_ref, external_id, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const apply = db.transaction(() => {
      plans.forEach((p, i) => {
        if (p.reasons.length) return;
        const v = p.values;
        if (p.existing) {
          // Partial update, restricted to the columns the plan phase found had
          // actually moved. Re-sending yesterday's file must not stamp
          // updated_at on 200 rows and write 200 activity entries saying
          // nothing happened.
          if (p.changed.length) {
            const sets = p.changed.map(col => `${col} = ?`);
            const params = p.changed.map(col => v[col]);
            db.prepare(`UPDATE work_orders SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
              .run(...params, p.existing.id);
            logActivity(companyId, 'work_order', p.existing.id, 'Updated by import', actor,
              { department_id: v.department_id || p.existing.department_id || null });
          }
          results[i].work_order_id = p.existing.id;
          results[i].work_order_number = p.renumber ? v.work_order_number : p.existing.work_order_number;
        } else {
          const id = uuidv4();
          // The number reserved for this row in the pre-pass, so the number the
          // preview printed is the number the job gets.
          const number = v.work_order_number || p.autoNumber || nextWorkOrderNumber(companyId);
          insert.run(
            id, number, v.part_number, v.part_name, v.quantity,
            v.app_id, v.department_id, v.routing_id, v.scheduled_start, v.scheduled_end,
            v.priority || 'medium', v.notes === null ? '' : v.notes, companyId,
            v.due_date, v.customer_ref, p.externalId,
          );
          results[i].work_order_id = id;
          results[i].work_order_number = number;
          logActivity(companyId, 'work_order', id, 'Created by import', actor,
            { department_id: v.department_id || null });
        }
      });
    });
    apply();
  }

  // `unchanged` counts rows that matched an existing job and changed nothing.
  // They are still 'updated' — the vocabulary has three values and the ERP
  // asked us to make the row look like its file, which it already does — but a
  // planner reading "200 updated" deserves to know 200 of them were no-ops.
  const summary = { total: results.length, created: 0, updated: 0, rejected: 0, unchanged: 0 };
  results.forEach((r, i) => {
    summary[r.result]++;
    if (r.result === 'updated' && plans[i].changed.length === 0) summary.unchanged++;
  });
  return { results, summary, dry_run: dryRun };
}

/**
 * Pull the rows out of an import request body: either `{ csv }` text or
 * `{ rows: [...] }` / a bare array. Returns { rows, error } — error is a
 * ready-to-send { status, body } when the body is not something we can read.
 */
function readImportBody(body) {
  let rows = null;
  if (Array.isArray(body)) rows = body;
  else if (body && Array.isArray(body.rows)) rows = body.rows;
  else if (body && typeof body.csv === 'string') rows = rowsFromCSV(body.csv).rows;
  else if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length > 0
           && body.csv === undefined && body.rows === undefined) rows = [body]; // a single work order

  if (!rows) {
    return { rows: null, error: { status: 400, body: { error: 'no_rows', message: 'Send { csv: "..." }, { rows: [...] }, or a single work order object.' } } };
  }
  if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r))) {
    return { rows: null, error: { status: 400, body: { error: 'bad_rows', message: 'Every row must be an object of column values.' } } };
  }
  if (rows.length === 0) {
    return { rows: null, error: { status: 400, body: { error: 'no_rows', message: 'No rows found. The first line must be the column headers.' } } };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return { rows: null, error: { status: 413, body: { error: 'too_many_rows', message: `This file has ${rows.length.toLocaleString('en-US')} rows. Import at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows at a time.`, limit: MAX_IMPORT_ROWS } } };
  }
  const headerError = checkImportHeaders(rows);
  if (headerError) return { rows: null, error: headerError };
  return { rows, error: null };
}

// ─── Reusable enriched-fetch query ───────────────────────────────────────────

const ENRICHED_SELECT = `
  SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name
  FROM work_orders wo
  LEFT JOIN departments d ON d.id = wo.department_id
  LEFT JOIN apps        a ON a.id = wo.app_id
`;

// ─── GET / - list all work orders ────────────────────────────────────────────

router.get('/', (req, res) => {
  const { status, department_id, priority, site_id } = req.query;

  let query = ENRICHED_SELECT;
  const conditions = ['wo.company_id = ?'];
  const params     = [req.companyId];

  if (status)        { conditions.push('wo.status = ?');        params.push(status); }
  if (department_id) { conditions.push('wo.department_id = ?'); params.push(department_id); }
  if (priority)      { conditions.push('wo.priority = ?');      params.push(priority); }
  // Unassigned work orders stay visible under every site (see departments.js).
  if (site_id)       { conditions.push('(wo.site_id = ? OR wo.site_id IS NULL)'); params.push(site_id); }

  query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY wo.created_at DESC';

  const rows = db.prepare(query).all(...params);
  res.json(rows.map(enrichWorkOrder));
});

// ─── POST / - create work order ──────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    part_number,
    part_name,
    quantity,
    app_id,
    department_id,
    scheduled_start,
    scheduled_end,
    takt_time_minutes = 0,
    status            = 'pending',
    priority          = 'medium',
    notes             = '',
    work_order_number,
    site_id           = null,
    product_type_id   = null,
    due_date          = null,
    customer_ref      = null,
    external_id       = null,
  } = req.body;

  if (!part_number)              return res.status(400).json({ error: 'part_number is required' });
  if (!part_name)                return res.status(400).json({ error: 'part_name is required' });
  if (!quantity || quantity < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });
  if (!STATUS_LABELS[status])    return res.status(400).json({ error: `status must be one of: ${Object.keys(STATUS_LABELS).join(', ')}` });
  if (!PRIORITY_LABELS[priority]) return res.status(400).json({ error: `priority must be one of: ${Object.keys(PRIORITY_LABELS).join(', ')}` });
  // The ERP's three fields, checked the same way the importer checks them.
  // Trimmed once, then that trimmed value is what is validated AND what is
  // stored. " 2026-04-17 " passing validation and landing untrimmed is how the
  // Due column ends up printing a raw string.
  const dueDate = due_date === null || due_date === undefined || due_date === '' ? null : String(due_date).trim();
  if (dueDate && !isCalendarDate(dueDate)) {
    return res.status(400).json({ error: 'due_date must be YYYY-MM-DD' });
  }
  const customerRef = customer_ref === null || customer_ref === undefined ? null : String(customer_ref).trim();
  const extId = external_id ? String(external_id).trim() : null;
  if (extId && db.prepare('SELECT id FROM work_orders WHERE company_id = ? AND external_id = ?').get(req.companyId, extId)) {
    return res.status(409).json({ error: `external_id "${extId}" is already used by another work order`, code: 'EXTERNAL_ID_TAKEN' });
  }

  const id       = uuidv4();
  const woNumber = work_order_number || nextWorkOrderNumber(req.companyId);
  const safeAppId  = ownedOrNull('apps', app_id, req.companyId);
  const safeDeptId = ownedOrNull('departments', department_id, req.companyId);
  const safeSiteId = ownedOrNull('sites', site_id, req.companyId);
  const safeProductTypeId = ownedProductTypeOrNull(product_type_id, safeAppId, req.companyId);

  db.prepare(`
    INSERT INTO work_orders
      (id, work_order_number, part_number, part_name, quantity, quantity_completed,
       app_id, department_id, scheduled_start, scheduled_end, takt_time_minutes,
       status, priority, notes, company_id, site_id, product_type_id,
       due_date, customer_ref, external_id, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, woNumber, part_number, part_name, quantity,
    safeAppId, safeDeptId,
    scheduled_start || null, scheduled_end || null,
    takt_time_minutes, status, priority, notes, req.companyId, safeSiteId, safeProductTypeId,
    dueDate, customerRef, extId
  );

  const wo = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(id);
  logActivity(req.companyId, 'work_order', id, 'Work order created', req.user?.display_name, { department_id: safeDeptId });
  res.status(201).json(enrichWorkOrder(wo));
});

// ─── Import: template, preview, commit ───────────────────────────────────────
// Declared BEFORE `GET /:id`, or Express would read "import" as a work order id.
//
// Preview and commit share one validator and differ by a single flag, so what
// the preview table promises is what the commit does. Both are manager-or-above:
// a bulk import rewrites the week's schedule, which is not a supervisor task.

// GET /import/template — the header row, as a file a spreadsheet will open.
router.get('/import/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="work-order-import-template.csv"');
  // BOM so Excel reads the file as UTF-8, matching every other export we write.
  res.send('﻿' + importTemplateCSV());
});

// POST /import/preview — writes nothing, says what would happen to every row.
router.post('/import/preview', requireRole('manager'), (req, res) => {
  const { rows, error } = readImportBody(req.body);
  if (error) return res.status(error.status).json(error.body);
  res.json(validateAndUpsertRows(req.companyId, rows, { dryRun: true }));
});

// POST /import/commit — the same verdicts, applied.
router.post('/import/commit', requireRole('manager'), (req, res) => {
  const { rows, error } = readImportBody(req.body);
  if (error) return res.status(error.status).json(error.body);
  res.json(validateAndUpsertRows(req.companyId, rows, {
    dryRun: false,
    actor: req.user?.display_name,
  }));
});

// ─── GET /:id - single work order with completion history count ───────────────

router.get('/:id', (req, res) => {
  const wo = db.prepare(`
    SELECT wo.*, d.name AS department_name, d.color AS department_color, a.name AS app_name,
           pt.name AS product_type_name, k.id AS kit_id, k.status AS kit_status
    FROM work_orders wo
    LEFT JOIN departments d ON d.id = wo.department_id
    LEFT JOIN apps        a ON a.id = wo.app_id
    LEFT JOIN product_types pt ON pt.id = wo.product_type_id
    LEFT JOIN kits        k ON k.work_order_id = wo.id AND k.status != 'cancelled'
    WHERE wo.id = ? AND wo.company_id = ?
  `).get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const historyCount = db.prepare(
    `SELECT COUNT(*) as c FROM completions WHERE work_order_id = ? AND status = 'completed'`
  ).get(req.params.id).c;

  res.json({ ...enrichWorkOrder(wo), completion_history_count: historyCount });
});

// ─── PUT /:id - update work order ────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const fields = [
    'part_number', 'part_name', 'quantity', 'quantity_completed',
    'app_id', 'department_id', 'scheduled_start', 'scheduled_end',
    'takt_time_minutes', 'status', 'priority', 'notes', 'work_order_number',
    'site_id', 'product_type_id', 'due_date', 'customer_ref', 'external_id',
  ];

  const updates = {};
  for (const f of fields) {
    updates[f] = req.body[f] !== undefined ? req.body[f] : wo[f];
  }

  if (req.body.status !== undefined && !STATUS_LABELS[updates.status]) {
    return res.status(400).json({ error: `status must be one of: ${Object.keys(STATUS_LABELS).join(', ')}` });
  }
  if (req.body.priority !== undefined && !PRIORITY_LABELS[updates.priority]) {
    return res.status(400).json({ error: `priority must be one of: ${Object.keys(PRIORITY_LABELS).join(', ')}` });
  }
  // Same rule as POST: trim first, then validate and store the trimmed value.
  if (req.body.due_date !== undefined) {
    updates.due_date = updates.due_date ? String(updates.due_date).trim() : null;
    if (updates.due_date && !isCalendarDate(updates.due_date)) {
      return res.status(400).json({ error: 'due_date must be YYYY-MM-DD' });
    }
  }
  if (req.body.customer_ref !== undefined) {
    updates.customer_ref = updates.customer_ref === null || updates.customer_ref === undefined
      ? null : String(updates.customer_ref).trim();
  }
  if (req.body.external_id !== undefined) {
    updates.external_id = updates.external_id ? String(updates.external_id).trim() : null;
    if (updates.external_id) {
      const clash = db.prepare('SELECT id FROM work_orders WHERE company_id = ? AND external_id = ?')
        .get(req.companyId, updates.external_id);
      if (clash && clash.id !== req.params.id) {
        return res.status(409).json({ error: `external_id "${updates.external_id}" is already used by another work order`, code: 'EXTERNAL_ID_TAKEN' });
      }
    }
  }

  // Cross-tenant reference guard: linked ids supplied by the client must
  // belong to this company (existing stored values are already trusted).
  if (req.body.app_id !== undefined)        updates.app_id        = ownedOrNull('apps', updates.app_id, req.companyId);
  if (req.body.department_id !== undefined) updates.department_id = ownedOrNull('departments', updates.department_id, req.companyId);
  if (req.body.site_id !== undefined)       updates.site_id       = ownedOrNull('sites', updates.site_id, req.companyId);
  if (req.body.product_type_id !== undefined) {
    updates.product_type_id = ownedProductTypeOrNull(updates.product_type_id, updates.app_id, req.companyId);
  }

  db.prepare(`
    UPDATE work_orders SET
      part_number=?, part_name=?, quantity=?, quantity_completed=?,
      app_id=?, department_id=?, scheduled_start=?, scheduled_end=?,
      takt_time_minutes=?, status=?, priority=?, notes=?, work_order_number=?,
      site_id=?, product_type_id=?, due_date=?, customer_ref=?, external_id=?,
      updated_at=datetime('now')
    WHERE id=?
  `).run(
    updates.part_number, updates.part_name, updates.quantity, updates.quantity_completed,
    updates.app_id, updates.department_id, updates.scheduled_start, updates.scheduled_end,
    updates.takt_time_minutes, updates.status, updates.priority, updates.notes,
    updates.work_order_number, updates.site_id, updates.product_type_id,
    updates.due_date, updates.customer_ref, updates.external_id, req.params.id
  );

  // ─── Activity log: describe what changed ──────────────────────────────────
  const changes = [];
  if (updates.status !== wo.status) {
    changes.push(`Status changed from ${STATUS_LABELS[wo.status] || wo.status} to ${STATUS_LABELS[updates.status] || updates.status}`);
  }
  if (updates.priority !== wo.priority) {
    changes.push(`Priority changed from ${PRIORITY_LABELS[wo.priority] || wo.priority} to ${PRIORITY_LABELS[updates.priority] || updates.priority}`);
  }
  if (updates.department_id !== wo.department_id) {
    changes.push(`Department changed from ${departmentName(wo.department_id)} to ${departmentName(updates.department_id)}`);
  }
  if (updates.scheduled_start !== wo.scheduled_start || updates.scheduled_end !== wo.scheduled_end) {
    changes.push(`Schedule changed to ${fmtDate(updates.scheduled_start)} – ${fmtDate(updates.scheduled_end)}`);
  }
  if (updates.quantity !== wo.quantity) {
    changes.push(`Quantity changed from ${wo.quantity} to ${updates.quantity}`);
  }
  for (const change of changes) {
    logActivity(req.companyId, 'work_order', req.params.id, change, req.user?.display_name, { department_id: updates.department_id || null });
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  const enriched = enrichWorkOrder(updated);

  if (updates.scheduled_start !== wo.scheduled_start || updates.scheduled_end !== wo.scheduled_end) {
    notify(req.companyId, 'workorder.schedule_changed', {
      body: `Work order ${updated.work_order_number} rescheduled to ${fmtDate(updates.scheduled_start)} – ${fmtDate(updates.scheduled_end)}.`,
    });
    deliverWebhooks(req.companyId, 'workorder.schedule_changed', enriched);
  }
  if (updates.status === 'overdue' && wo.status !== 'overdue') {
    notify(req.companyId, 'workorder.overdue', {
      body: `Work order ${updated.work_order_number} (${updated.part_name || updated.part_number}) is now overdue.`,
    });
    deliverWebhooks(req.companyId, 'workorder.overdue', enriched);
  }

  res.json(enriched);
});

// ─── PUT /:id/complete - mark work order as completed ────────────────────────

router.put('/:id/complete', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  db.prepare(`
    UPDATE work_orders
    SET status='completed', quantity_completed=quantity, updated_at=datetime('now')
    WHERE id=?
  `).run(req.params.id);

  if (wo.status !== 'completed') {
    logActivity(req.companyId, 'work_order', req.params.id, 'Marked as completed', req.user?.display_name, { department_id: wo.department_id || null });
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── POST /:id/increment - increment quantity_completed by 1 ─────────────────

router.post('/:id/increment', (req, res) => {
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const newQty    = Math.min(wo.quantity_completed + 1, wo.quantity);
  const newStatus = newQty >= wo.quantity
    ? 'completed'
    : (wo.status === 'pending' ? 'in_progress' : wo.status);

  db.prepare(`
    UPDATE work_orders
    SET quantity_completed=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(newQty, newStatus, req.params.id);

  if (newStatus !== wo.status) {
    logActivity(req.companyId, 'work_order', req.params.id, `Status changed from ${STATUS_LABELS[wo.status] || wo.status} to ${STATUS_LABELS[newStatus] || newStatus}`, req.user?.display_name, { department_id: wo.department_id || null });
  }

  const updated = db.prepare(ENRICHED_SELECT + ' WHERE wo.id = ?').get(req.params.id);
  res.json(enrichWorkOrder(updated));
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  db.prepare('DELETE FROM work_orders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── GET /:id/comments ────────────────────────────────────────────────────────

router.get('/:id/comments', (req, res) => {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const rows = db.prepare('SELECT * FROM wo_comments WHERE work_order_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(rows);
});

// ─── POST /:id/comments ───────────────────────────────────────────────────────

router.post('/:id/comments', (req, res) => {
  const wo = db.prepare('SELECT id FROM work_orders WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body is required' });

  const id = uuidv4();
  const authorName = req.user?.display_name || 'Unknown';
  const authorId = req.user?.id || null;
  db.prepare('INSERT INTO wo_comments (id, work_order_id, author_id, author_name, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, authorId, authorName, body.trim());

  logActivity(req.companyId, 'work_order', req.params.id, `Comment added by ${authorName}`, authorName, { department_id: wo.department_id || null });
  res.status(201).json(db.prepare('SELECT * FROM wo_comments WHERE id = ?').get(id));
});

// ─── DELETE /:id/comments/:commentId ─────────────────────────────────────────

router.delete('/:id/comments/:commentId', (req, res) => {
  const comment = db.prepare(
    `SELECT c.* FROM wo_comments c
     JOIN work_orders wo ON wo.id = c.work_order_id
     WHERE c.id = ? AND wo.company_id = ?`
  ).get(req.params.commentId, req.companyId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const canDelete = req.user?.role === 'manager' || req.user?.role === 'developer' || comment.author_id === req.user?.id;
  if (!canDelete) return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM wo_comments WHERE id = ?').run(req.params.commentId);
  res.json({ success: true });
});

module.exports = {
  router,
  calcScheduleStatus,
  // The one import validator, shared with the public API in routes/v1.js.
  validateAndUpsertRows,
  readImportBody,
  checkImportHeaders,
  rowsFromCSV,
  importTemplateCSV,
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
};
