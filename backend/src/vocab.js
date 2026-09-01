'use strict';

// ─── One vocabulary, quoted by both the schema and the code ───────────────────
// Every value a column is allowed to hold lives here once. A migration writes
// its CHECK constraint with checkList(), and the route validator that guards the
// same column reads the same array — so the two cannot drift into disagreeing
// about what "on_hold" is spelled like.
//
// THESE LISTS ARE FROZEN ON FIRST SHIP. SQLite cannot ALTER a CHECK constraint
// in place: changing one means rebuilding the table (create new, copy rows, drop
// old, rename) on a live customer database. Adding a value to a list below after
// its migration has shipped is therefore NOT a one-line edit — it is a table
// rebuild. Decide the full vocabulary before the migration lands.
//
// Adding a NEW vocabulary (a new name in this file) is always safe; it is the
// existing ones that are load-bearing.

/** Where an operation on a work order stands. */
const OPERATION_STATUS = Object.freeze(['queued', 'ready', 'running', 'complete', 'skipped', 'on_hold']);

/** What a coded reason explains. */
const REASON_KIND = Object.freeze(['scrap', 'rework', 'downtime']);

/** The six big OEE losses. Buckets, not free text — the whole point is that
 *  two plants can compare a "minor_stop". */
const LOSS_BUCKET = Object.freeze([
  'breakdown', 'setup_adjustment', 'minor_stop', 'speed_loss', 'startup_reject', 'process_reject',
]);

/** Whether a person is signed off to run a thing. */
const QUALIFICATION_STATE = Object.freeze(['certified', 'override', 'none', 'expired']);

/** What the plant does when someone unqualified starts a run. */
const TRAINING_ENFORCEMENT = Object.freeze(['off', 'warn', 'block']);

/** What happened to one row of an import file. */
const IMPORT_ROW_RESULT = Object.freeze(['created', 'updated', 'rejected']);

const VOCABULARIES = Object.freeze({
  OPERATION_STATUS,
  REASON_KIND,
  LOSS_BUCKET,
  QUALIFICATION_STATE,
  TRAINING_ENFORCEMENT,
  IMPORT_ROW_RESULT,
});

// The column each vocabulary normally guards, so checkList('REASON_KIND') reads
// the way the migration means it. Pass an explicit column for anything else.
const DEFAULT_COLUMNS = Object.freeze({
  OPERATION_STATUS: 'status',
  REASON_KIND: 'kind',
  LOSS_BUCKET: 'bucket',
  QUALIFICATION_STATE: 'state',
  TRAINING_ENFORCEMENT: 'enforcement',
  IMPORT_ROW_RESULT: 'result',
});

function assertKnown(name) {
  if (!Object.prototype.hasOwnProperty.call(VOCABULARIES, name)) {
    throw new Error(
      `[vocab] Unknown vocabulary "${name}". Known: ${Object.keys(VOCABULARIES).join(', ')}`
    );
  }
}

/**
 * The allowed values for a vocabulary (the frozen array itself).
 * @param {string} name  e.g. 'OPERATION_STATUS'
 */
function values(name) {
  assertKnown(name);
  return VOCABULARIES[name];
}

/**
 * Is this value in the vocabulary? Use in route validators so the API rejects
 * exactly what the CHECK would reject, with a readable 400 instead of a 500.
 * @param {string} name   e.g. 'OPERATION_STATUS'
 * @param {unknown} value
 */
function isValid(name, value) {
  assertKnown(name);
  return VOCABULARIES[name].includes(value);
}

/**
 * Render the SQL CHECK fragment for a column, e.g.
 *   checkList('OPERATION_STATUS')            →
 *     CHECK(status IN ('queued','ready','running','complete','skipped','on_hold'))
 *   checkList('REASON_KIND', 'reason_kind')  →
 *     CHECK(reason_kind IN ('scrap','rework','downtime'))
 *
 * Drop it straight into a CREATE TABLE column definition in a migration so the
 * constraint and the validator quote the same source.
 *
 * @param {string} name     vocabulary name; throws if unknown
 * @param {string} [column] column to constrain; defaults to the vocabulary's
 *                          usual column (see DEFAULT_COLUMNS)
 * @returns {string} `CHECK(<column> IN ('a','b',…))`
 */
function checkList(name, column) {
  assertKnown(name);
  const col = column || DEFAULT_COLUMNS[name];
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
    throw new Error(`[vocab] Invalid column name "${col}" for ${name}`);
  }
  const list = VOCABULARIES[name].map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
  return `CHECK(${col} IN (${list}))`;
}

module.exports = {
  OPERATION_STATUS,
  REASON_KIND,
  LOSS_BUCKET,
  QUALIFICATION_STATE,
  TRAINING_ENFORCEMENT,
  IMPORT_ROW_RESULT,
  VOCABULARIES,
  DEFAULT_COLUMNS,
  values,
  isValid,
  checkList,
};
