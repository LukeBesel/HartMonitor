'use strict';

// ─── What the plant actually made ─────────────────────────────────────────────
//
// Production quantity used to be good-only: a completion existed, therefore one
// good piece existed. First-pass yield, scrap by part and the cost of poor
// quality were all uncomputable, and the only plant-wide scrap figure anywhere
// in the product was whatever a supervisor typed into a shift note by hand.
//
// Migration 012 gave a run three counts and a coded reason. This module is the
// one place those counts are turned into rates, so the app screen, the OEE tab,
// the shift note and any future report cannot each invent their own arithmetic
// for the same word.
//
// THE TWO RULES it enforces:
//
//   1. NULL is not zero. A run that recorded nothing is not a run that made
//      nothing — it is a run nobody counted. Every query here selects only the
//      runs that carry a count, so an app whose operators have never touched
//      the units control has a yield of `null` with a reason, never a
//      fabricated 0% or 100%.
//
//   2. The window is the PLANT'S day, and it is CLOSED AT BOTH ENDS. Each
//      comparison binds plantDay's modifier to both sides — `date(completed_at,
//      ?) >= date('now', ?, ?)` — so `days: 1` means today at the plant, not
//      the last 24 hours and not today-in-Greenwich. The upper end is bound
//      too: a row stamped in the future by a skewed tablet clock or an import
//      belongs to the day it claims, not to every window that has not reached
//      it yet.
//
// Rework is reported but is deliberately NOT in the first-pass-yield
// denominator: FPY asks how many pieces came through right the first time, so
// a reworked piece is a piece that did not. It is counted as neither good nor
// scrap because it is still in the job — it has not been decided yet. The
// figure this module calls `fpy` is good ÷ (good + scrap), and `rework` rides
// alongside so a screen can say how much of the "good" needed a second pass.

const db = require('./db');
const { plantDayShift, plantToday } = require('./plantDay');

/** A run counts toward yield only if somebody recorded at least one number on
 *  it. Everything else is unmeasured, not zero. */
const HAS_COUNTS = `(c.quantity_good IS NOT NULL OR c.quantity_scrap IS NOT NULL OR c.quantity_rework IS NOT NULL)`;

/** Printed where a rate would be, so a dash is never left uninterpreted. */
const REASONS = {
  fpy: 'no run has recorded a good or scrap count yet',
};

/**
 * Normalise the `days` argument. A positive whole number is a window of that
 * many plant days ending today (1 = today only); anything else means "every
 * run this company has ever recorded".
 */
function windowDays(days) {
  const n = Number(days);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The window fragment plus its bindings, or nothing at all.
 *
 * Closed at BOTH ends and shifted on BOTH sides of each comparison: the lower
 * end is `days - 1` plant days back, the upper end is today at the plant. The
 * upper bound is not decoration — a completed_at stamped in the future (a
 * tablet with a wrong clock, an imported row) would otherwise sit inside every
 * window forever, inflating today's scrap with work that has not happened.
 */
function windowClause(days, shift) {
  const n = windowDays(days);
  if (n === null) return { sql: '', params: [] };
  return {
    sql: ` AND date(c.completed_at, ?) >= date('now', ?, ?)`
       + ` AND date(c.completed_at, ?) <= date('now', ?)`,
    params: [shift, shift, `-${n - 1} days`, shift, shift],
  };
}

/**
 * Read a `?days=` query parameter for the endpoints that take one.
 *
 * A bad value is REFUSED rather than quietly replaced by the default: `days=0`
 * and `days=abc` both used to come back as a full month of data under a heading
 * that said something else, which is a wrong number nobody can see is wrong.
 *
 * @returns {{ok: true, days: number} | {ok: false, error: string}}
 */
function parseDays(raw, fallback = 30, max = 365) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, days: fallback };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    return { ok: false, error: `days must be a whole number between 1 and ${max}` };
  }
  return { ok: true, days: n };
}

/**
 * The good/scrap/rework totals and first-pass yield for a slice of the plant.
 *
 * Every filter is optional and every one of them narrows: no filters at all is
 * the whole company. An id belonging to another tenant simply matches nothing
 * (the company clause is always present), so a scope can never widen.
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {string} [opts.appId]        only runs of this app
 * @param {string} [opts.workOrderId]  only runs against this work order
 * @param {string} [opts.operationId]  only runs booked to this operation
 * @param {number} [opts.days]         plant-day window; 1 = today, omitted = all
 * @returns {{good:number, scrap:number, rework:number, fpy:number|null,
 *            fpy_pct:number|null, sample:number, fpy_reason:string|null,
 *            window_days:number|null, plant_date:string}}
 */
function yieldFor({ companyId, appId, workOrderId, operationId, days } = {}) {
  const shift = plantDayShift(companyId);
  const win = windowClause(days, shift);

  const clauses = [`c.company_id = ?`, `c.status = 'completed'`, HAS_COUNTS];
  const params = [companyId];
  if (appId)       { clauses.push('c.app_id = ?');                  params.push(appId); }
  if (workOrderId) { clauses.push('c.work_order_id = ?');           params.push(workOrderId); }
  if (operationId) { clauses.push('c.work_order_operation_id = ?'); params.push(operationId); }

  const row = db.prepare(`
    SELECT COALESCE(SUM(c.quantity_good), 0)   AS good,
           COALESCE(SUM(c.quantity_scrap), 0)  AS scrap,
           COALESCE(SUM(c.quantity_rework), 0) AS rework,
           COUNT(*)                            AS sample
    FROM completions c
    WHERE ${clauses.join(' AND ')}${win.sql}
  `).get(...params, ...win.params);

  return shapeYield(row, windowDays(days), plantToday(companyId));
}

/** The shared shape, so every caller reads the same field names. */
function shapeYield(row, days, plantDate) {
  const good   = row?.good   || 0;
  const scrap  = row?.scrap  || 0;
  const rework = row?.rework || 0;
  const sample = row?.sample || 0;
  // Nobody counted, or everybody counted zero: there is no yield to state.
  // 100% here would be the single most flattering lie the product could tell.
  const base = good + scrap;
  const fpy = base > 0 ? good / base : null;
  return {
    good, scrap, rework, sample,
    /** good ÷ (good + scrap), 0–1. Null when nothing was counted. */
    fpy,
    /** The same figure as whole percent, for a screen that prints one. */
    fpy_pct: fpy === null ? null : Math.round(fpy * 100),
    fpy_reason: fpy === null ? REASONS.fpy : null,
    /** The window this answered. On the payload, so nobody has to guess. */
    window_days: days,
    plant_date: plantDate,
  };
}

/**
 * Scrap grouped by the part number of the work order each run was booked to,
 * each group carrying the coded reasons behind its scrap.
 *
 * Runs with no work order have no part number: they come back as one group with
 * `part_number: null`, never folded into another part's total and never
 * silently dropped.
 *
 * @param {object} opts
 * @param {string} opts.companyId
 * @param {number} [opts.days]  plant-day window; 1 = today, omitted = all
 * @returns {{parts: object[], totals: object, window_days: number|null, plant_date: string}}
 */
function scrapByPart({ companyId, days } = {}) {
  const shift = plantDayShift(companyId);
  const win = windowClause(days, shift);
  const n = windowDays(days);
  const plantDate = plantToday(companyId);

  const scope = `c.company_id = ? AND c.status = 'completed' AND ${HAS_COUNTS}`;

  const rows = db.prepare(`
    SELECT COALESCE(wo.part_number, '')          AS part_number,
           COALESCE(wo.part_name, '')            AS part_name,
           COALESCE(SUM(c.quantity_good), 0)     AS good,
           COALESCE(SUM(c.quantity_scrap), 0)    AS scrap,
           COALESCE(SUM(c.quantity_rework), 0)   AS rework,
           COUNT(*)                              AS sample
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id AND wo.company_id = c.company_id
    WHERE ${scope}${win.sql}
    GROUP BY 1, 2
  `).all(companyId, ...win.params);

  // The reasons behind the scrap, per part. A row whose reason code has since
  // been deleted keeps its scrap and reports the code as unknown rather than
  // vanishing from the total.
  const reasonRows = db.prepare(`
    SELECT COALESCE(wo.part_number, '')       AS part_number,
           c.scrap_reason_code_id             AS reason_code_id,
           rc.code                            AS code,
           rc.label                           AS label,
           COALESCE(SUM(c.quantity_scrap), 0) AS scrap
    FROM completions c
    LEFT JOIN work_orders wo ON wo.id = c.work_order_id AND wo.company_id = c.company_id
    LEFT JOIN reason_codes rc ON rc.id = c.scrap_reason_code_id AND rc.company_id = c.company_id
    WHERE ${scope} AND c.quantity_scrap > 0${win.sql}
    GROUP BY 1, 2, 3, 4
  `).all(companyId, ...win.params);

  const byPart = new Map();
  for (const r of reasonRows) {
    if (!byPart.has(r.part_number)) byPart.set(r.part_number, []);
    byPart.get(r.part_number).push({
      reason_code_id: r.reason_code_id || null,
      code: r.code || null,
      label: r.label || (r.reason_code_id ? 'Retired reason code' : 'No reason recorded'),
      scrap: r.scrap || 0,
    });
  }

  const parts = rows.map(r => {
    const shaped = shapeYield(r, n, plantDate);
    return {
      // '' is "this run had no work order", which is a fact about the run and
      // not a part called "". It travels as null so a screen can say so.
      part_number: r.part_number || null,
      part_name: r.part_name || null,
      ...shaped,
      reasons: (byPart.get(r.part_number) || []).sort((a, b) => b.scrap - a.scrap),
    };
  }).sort((a, b) => b.scrap - a.scrap || (a.part_number || '').localeCompare(b.part_number || ''));

  const totals = shapeYield({
    good:   parts.reduce((a, p) => a + p.good, 0),
    scrap:  parts.reduce((a, p) => a + p.scrap, 0),
    rework: parts.reduce((a, p) => a + p.rework, 0),
    sample: parts.reduce((a, p) => a + p.sample, 0),
  }, n, plantDate);

  return { parts, totals, window_days: n, plant_date: plantDate };
}

module.exports = { yieldFor, scrapByPart, parseDays, HAS_COUNTS, REASONS };
