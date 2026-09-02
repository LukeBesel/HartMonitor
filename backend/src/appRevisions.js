'use strict';
// ─── App revisions: what the operator actually saw ───────────────────────────
//
// Publishing an app used to be `UPDATE apps SET status='published'`. Nothing
// was frozen, so editing a published app silently rewrote the instructions
// every past run had been measured against, and an auditor asking "what did
// the operator follow on 12 August?" had no answer in the system.
//
// Publishing now CUTS A REVISION: an immutable row holding the app's
// executable definition (steps, variables, step_groups, schema_version) exactly
// as it stood, the change note the publisher had to type, who published it and
// — when the app requires approval — who signed it off. Runs stamp the live
// revision at start. Editing the app afterwards writes the draft in `apps` and
// touches no revision row, ever: this module only ever INSERTs into
// app_revisions, and there is deliberately no update or delete path.
//
// Everything here is tenant-scoped on company_id. A revision belongs to the
// company that cut it, and an approver has to be a live user of that same
// company.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');

/** The columns that make an app executable — the whole of what a revision
 *  snapshots. Named once so the snapshot and the "has this drifted?" check can
 *  never read different fields. */
const DEFINITION_COLUMNS = ['steps', 'variables', 'step_groups', 'schema_version'];

/** The latest revision row for an app, or null when it has never been published
 *  under change control. */
function latestRevision(companyId, appId) {
  return db.prepare(`
    SELECT * FROM app_revisions
    WHERE company_id = ? AND app_id = ?
    ORDER BY revision DESC LIMIT 1
  `).get(companyId, appId) || null;
}

/** The id a run started right now would be stamped with — the live revision —
 *  or null when the app has never been published under change control. A NULL
 *  stamp is honest ("revision not recorded"), never a guessed Rev 1. */
function currentRevisionId(companyId, appId) {
  const app = db.prepare('SELECT current_revision FROM apps WHERE id = ? AND company_id = ?')
    .get(appId, companyId);
  if (!app || !app.current_revision) return null;
  const row = db.prepare(`
    SELECT id FROM app_revisions WHERE company_id = ? AND app_id = ? AND revision = ?
  `).get(companyId, appId, app.current_revision);
  return row ? row.id : null;
}

/** One numbered revision of one app, tenant-scoped. Null when company, app or
 *  number does not match — a company can never read another's revisions. */
function getRevision(companyId, appId, n) {
  const revision = Number(n);
  if (!Number.isInteger(revision) || revision < 1) return null;
  return db.prepare(`
    SELECT * FROM app_revisions
    WHERE company_id = ? AND app_id = ? AND revision = ?
  `).get(companyId, appId, revision) || null;
}

/** A revision row by id, tenant-scoped. */
function getRevisionById(companyId, id) {
  if (!id) return null;
  return db.prepare('SELECT * FROM app_revisions WHERE id = ? AND company_id = ?')
    .get(id, companyId) || null;
}

// ─── Diff ────────────────────────────────────────────────────────────────────

/** Steps out of a revision row, an app row, a parsed app, or a bare array.
 *  Anything unreadable is an empty list rather than a throw — a diff is a
 *  courtesy on top of the publish, and must never be what blocks it. */
function stepsOf(source) {
  let raw = source;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) raw = raw.steps;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw.filter(s => s && typeof s === 'object') : [];
}

function stepKey(step, index) {
  return step.id ? `id:${step.id}` : `idx:${index}:${step.name || ''}`;
}

function widgetsOf(step) {
  return Array.isArray(step.widgets) ? step.widgets.filter(w => w && typeof w === 'object') : [];
}

/**
 * What changed between two definitions, in the words a publisher reads back:
 * "1 step added, 1 renamed". Steps are matched on id (the builder keeps step
 * ids stable across a rename — that is exactly what makes a rename visible
 * rather than an add plus a remove).
 *
 * @returns {{added: string[], removed: string[], renamed: {from: string, to: string}[], changed_widgets: number}}
 */
function diff(a, b) {
  const before = stepsOf(a);
  const after = stepsOf(b);
  const beforeByKey = new Map(before.map((s, i) => [stepKey(s, i), s]));
  const afterByKey = new Map(after.map((s, i) => [stepKey(s, i), s]));

  const added = [];
  const removed = [];
  const renamed = [];
  let changedWidgets = 0;

  for (const [key, step] of afterByKey) {
    if (!beforeByKey.has(key)) { added.push(step.name || 'Untitled step'); continue; }
    const was = beforeByKey.get(key);
    if ((was.name || '') !== (step.name || '')) {
      renamed.push({ from: was.name || 'Untitled step', to: step.name || 'Untitled step' });
    }
    // Widget-level churn: added, removed, or edited in place.
    const wasWidgets = new Map(widgetsOf(was).map((w, i) => [w.id || `idx:${i}`, w]));
    const nowWidgets = new Map(widgetsOf(step).map((w, i) => [w.id || `idx:${i}`, w]));
    for (const [wid, widget] of nowWidgets) {
      const previous = wasWidgets.get(wid);
      if (!previous || JSON.stringify(previous) !== JSON.stringify(widget)) changedWidgets++;
    }
    for (const wid of wasWidgets.keys()) if (!nowWidgets.has(wid)) changedWidgets++;
  }
  for (const [key, step] of beforeByKey) {
    if (!afterByKey.has(key)) removed.push(step.name || 'Untitled step');
  }

  return { added, removed, renamed, changed_widgets: changedWidgets };
}

/** True when the draft in `apps` no longer matches the latest revision — the
 *  state the builder banner exists to announce. An app that has never been
 *  published under change control has no revision to differ from, so this is
 *  false: it is a draft, not a drifted publication. */
function hasUnpublishedChanges(app, revision = null) {
  const rev = revision || latestRevision(app.company_id, app.id);
  if (!rev) return false;
  return DEFINITION_COLUMNS.some(col => normalizeColumn(col, app[col]) !== normalizeColumn(col, rev[col]));
}

function normalizeColumn(col, value) {
  if (col === 'schema_version') return value === null || value === undefined ? '' : String(value);
  if (value === null || value === undefined) return col === 'variables' || col === 'step_groups' || col === 'steps' ? '[]' : '';
  // Compare the MEANING of the blob, not its whitespace: a re-save that
  // reorders nothing should not read as an unpublished change.
  try { return JSON.stringify(JSON.parse(String(value))); } catch { return String(value); }
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Cut the next numbered revision of an app and make it live, in one
 * transaction: the snapshot row and `apps.current_revision` move together or
 * not at all.
 *
 * The snapshot copies the app's definition columns BYTE FOR BYTE out of the
 * `apps` row — no re-serialisation — so what the revision holds is exactly what
 * was published, and a later edit of the app cannot touch it.
 *
 * @param {string} companyId
 * @param {string} appId
 * @param {{userId?: string|null, changeNote?: string, approverUserId?: string|null}} opts
 * @returns {{revision: number, id: string}}
 */
function publish(companyId, appId, { userId = null, changeNote = '', approverUserId = null } = {}) {
  const cut = db.transaction(() => {
    const app = db.prepare('SELECT * FROM apps WHERE id = ? AND company_id = ?').get(appId, companyId);
    if (!app) throw new Error('App not found');

    // The next number is one past whatever exists, not just past
    // current_revision — so a counter that ever drifted cannot collide with the
    // UNIQUE(company_id, app_id, revision) constraint and lose a publish.
    const maxRow = db.prepare('SELECT MAX(revision) AS n FROM app_revisions WHERE company_id = ? AND app_id = ?')
      .get(companyId, appId);
    const revision = Math.max(app.current_revision || 0, maxRow?.n || 0) + 1;

    const id = uuidv4();
    db.prepare(`
      INSERT INTO app_revisions
        (id, company_id, app_id, revision, steps, variables, step_groups, schema_version,
         change_note, published_by_user_id, approved_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, companyId, appId, revision,
      app.steps ?? '[]', app.variables ?? '[]', app.step_groups ?? '[]', app.schema_version ?? null,
      changeNote, userId, approverUserId,
    );

    db.prepare(`UPDATE apps SET status='published', current_revision=?, updated_at=datetime('now') WHERE id=? AND company_id=?`)
      .run(revision, appId, companyId);

    return { revision, id };
  });
  return cut();
}

/** Every revision of an app, newest first, with the names an audit reads and
 *  how many runs each one measured. Names come from a LEFT JOIN, so a user who
 *  has since been deleted leaves a null the UI must label — never a made-up
 *  name. */
function listRevisions(companyId, appId) {
  return db.prepare(`
    SELECT r.id, r.revision, r.change_note, r.effective_at, r.created_at,
           r.published_by_user_id, r.approved_by_user_id,
           pu.display_name AS published_by_name,
           au.display_name AS approved_by_name,
           (SELECT COUNT(*) FROM completions c
             WHERE c.app_revision_id = r.id AND c.company_id = r.company_id) AS run_count
    FROM app_revisions r
    LEFT JOIN users pu ON pu.id = r.published_by_user_id AND pu.company_id = r.company_id
    LEFT JOIN users au ON au.id = r.approved_by_user_id AND au.company_id = r.company_id
    WHERE r.company_id = ? AND r.app_id = ?
    ORDER BY r.revision DESC
  `).all(companyId, appId);
}

/** One revision, shaped for the wire: blobs parsed, names joined. */
function shapeRevision(row) {
  if (!row) return null;
  const parse = (value, fallback) => {
    try { return JSON.parse(value ?? fallback); } catch { return JSON.parse(fallback); }
  };
  const names = db.prepare(`
    SELECT
      (SELECT display_name FROM users WHERE id = ? AND company_id = ?) AS published_by_name,
      (SELECT display_name FROM users WHERE id = ? AND company_id = ?) AS approved_by_name
  `).get(row.published_by_user_id, row.company_id, row.approved_by_user_id, row.company_id);
  return {
    id: row.id,
    app_id: row.app_id,
    revision: row.revision,
    steps: parse(row.steps, '[]'),
    variables: parse(row.variables, '[]'),
    step_groups: parse(row.step_groups, '[]'),
    schema_version: row.schema_version,
    change_note: row.change_note,
    published_by_user_id: row.published_by_user_id,
    approved_by_user_id: row.approved_by_user_id,
    published_by_name: names?.published_by_name ?? null,
    approved_by_name: names?.approved_by_name ?? null,
    effective_at: row.effective_at,
    created_at: row.created_at,
  };
}

module.exports = {
  publish, currentRevisionId, getRevision, getRevisionById, latestRevision,
  listRevisions, shapeRevision, hasUnpublishedChanges, diff, DEFINITION_COLUMNS,
};
