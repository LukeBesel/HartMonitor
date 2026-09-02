'use strict';

// ─── Does this person have the sign-off to run this app? ──────────────────────
//
// The training module has kept training_records since it shipped, and nothing
// in the run-start path has ever read one. A skills matrix the software never
// consults is a compliance liability, not a feature.
//
// The reason it stayed unchecked is real, though: apps carry no "requires
// certification" flag, so an unconditional gate would have blocked every
// operator in every existing plant on the next deploy. So this is a COMPANY
// SETTING with three positions, stored in org_settings under
// `training_enforcement`, absent meaning 'off':
//
//   off    nothing changes. This module does not even look at training —
//          the middleware returns before any query is prepared.
//   warn   the run starts exactly as before, and what was true of the operator
//          is stamped onto the completion (qualification_state) so the matrix
//          and the run history agree afterwards.
//   block  an uncertified or expired operator cannot start, unless a supervisor
//          approves it with their PIN. That approval is single use and leaves a
//          permanent, attributable row naming both people.
//
// WHICH APPS NEED CERTIFICATION. There is no per-app flag, so inventing one
// here would make the gate disagree with the screen. The Skills Matrix
// (backend/src/routes/training.js GET /matrix and GET /summary) treats EVERY
// PUBLISHED APP as a skill column, and coverage as "every active operator
// against every published app". This module uses exactly that rule — a
// published app requires certification, a draft one does not — so the thing
// that blocks a run and the thing an auditor is shown are the same statement.
//
// WHEN AN EXPIRY LAPSES. At the start of the PLANT's day, not Greenwich's. A
// certificate that runs out "yesterday" in Auckland is expired for the shift
// that is working now, even while the server's UTC clock still reads the
// previous date. See backend/src/plantDay.js.

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const vocab = require('./vocab');
const { plantDayShift } = require('./plantDay');
const { logActivity } = require('./activity');
const { redeemGrant } = require('./authorization');

/** org_settings key holding the company's enforcement mode. */
const ENFORCEMENT_KEY = 'training_enforcement';

/** activity_log entity_type for everything this gate records. */
const LOG_ENTITY = 'qualification';

/** Action prefixes, so counting one kind never counts the other. */
const BLOCKED_ACTION = 'Blocked start';
const OVERRIDE_ACTION = 'Qualification override';

/** How long a minted override token is good for. Long enough for a supervisor
 *  to walk over and type a PIN; short enough that a token left on a tablet is
 *  not a standing exemption. Single use is what really bounds it. */
const OVERRIDE_TTL_MS = 10 * 60 * 1000;

// Counters, for tests only. Nothing reads these in production; they exist so a
// test can PROVE that 'off' issues no training query rather than inferring it
// from a response body that would look identical either way.
const __stats = { trainingQueries: 0, checks: 0 };

/**
 * The company's enforcement mode: one of vocab.TRAINING_ENFORCEMENT.
 * A missing row, an empty value, or a word this build does not recognise all
 * mean 'off' — the setting can only ever turn the gate ON deliberately.
 */
function enforcementMode(companyId) {
  const row = db
    .prepare(`SELECT value FROM org_settings WHERE company_id = ? AND key = ?`)
    .get(companyId, ENFORCEMENT_KEY);
  const value = row?.value || '';
  return vocab.isValid('TRAINING_ENFORCEMENT', value) ? value : 'off';
}

/** Store the mode. Callers validate first; this refuses anything else anyway. */
function setEnforcementMode(companyId, value) {
  if (!vocab.isValid('TRAINING_ENFORCEMENT', value)) return false;
  db.prepare(`
    INSERT INTO org_settings (company_id, key, value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(companyId, ENFORCEMENT_KEY, value);
  return true;
}

/**
 * Resolve the person a run is being booked to: the verified user id the portal
 * carried, or failing that an exact display-name match on this company's active
 * roster. A name that matches nobody resolves to nobody, which is 'none' — a
 * gate that guessed would be worse than one that refuses.
 */
function resolveOperator(companyId, { userId, operatorName }) {
  if (userId) {
    const byId = db.prepare(
      `SELECT id, display_name FROM users WHERE id = ? AND company_id = ?`
    ).get(userId, companyId);
    if (byId) return byId;
  }
  const name = String(operatorName || '').trim();
  if (!name) return null;
  const byName = db.prepare(`
    SELECT id, display_name FROM users
    WHERE company_id = ? AND is_active = 1 AND display_name = ?
    ORDER BY id LIMIT 1
  `).get(companyId, name);
  return byName || null;
}

/**
 * What is true of this person, for this app, right now.
 *
 * @returns {{state: string, expiry_date: string|null, mode: string,
 *            app_name: string, operator_name: string, required: boolean,
 *            user_id: string|null}}
 *   state      '' when nothing is required or measured, otherwise one of
 *              vocab.QUALIFICATION_STATE.
 *   required   the app is published, so the Skills Matrix asks for a
 *              certification against it.
 */
function checkQualification(companyId, { userId, operatorName, appId }) {
  __stats.checks += 1;
  const mode = enforcementMode(companyId);
  const app = db.prepare(
    `SELECT id, name, status FROM apps WHERE id = ? AND company_id = ?`
  ).get(appId, companyId);

  const operator = resolveOperator(companyId, { userId, operatorName });
  const displayName = operator?.display_name || String(operatorName || '').trim();

  // An app that does not exist, or is not published, asks nothing of anybody.
  if (!app || app.status !== 'published') {
    return {
      state: '', expiry_date: null, mode,
      app_name: app?.name || '', operator_name: displayName,
      required: false, user_id: operator?.id || null,
    };
  }

  if (!operator) {
    return {
      state: 'none', expiry_date: null, mode,
      app_name: app.name, operator_name: displayName,
      required: true, user_id: null,
    };
  }

  // The expiry comparison happens in SQL against the PLANT's day. Both sides of
  // the comparison carry the same shift, which is the whole rule in plantDay.js.
  __stats.trainingQueries += 1;
  const day = plantDayShift(companyId);
  const record = db.prepare(`
    SELECT status, certified_date, expiry_date,
           CASE WHEN expiry_date IS NOT NULL AND date(expiry_date) < date('now', ?)
                THEN 1 ELSE 0 END AS lapsed
    FROM training_records
    WHERE company_id = ? AND user_id = ? AND app_id = ?
  `).get(day, companyId, operator.id, appId);

  let state = 'none';
  if (record) {
    if (record.status === 'expired' || record.lapsed === 1) state = 'expired';
    else if (record.status === 'certified') state = 'certified';
    else state = 'none';
  }

  return {
    state,
    expiry_date: record?.expiry_date || null,
    mode,
    app_name: app.name,
    operator_name: displayName,
    required: true,
    user_id: operator.id,
  };
}

// ─── One-shot override proofs ────────────────────────────────────────────────
//
// A supervisor's PIN is verified by POST /api/operators/verify-authorizer,
// which already exists and already mints a single-use, company-scoped
// authorization grant. That mechanism is reused verbatim rather than a second
// copy of PIN handling being written here.
//
// The header X-Qualification-Override on the start request therefore carries
// ONE of two things, both single use and both rooted in that same PIN check:
//
//   • a token from POST /api/training/overrides — scoped to this app AND this
//     operator, valid for ten minutes. This is the shape the API contract
//     describes and what an integration would use.
//   • an authorization grant id straight from verify-authorizer. This is what
//     the player sends, because /api/training is mounted behind a supervisor
//     write role: a tablet signed in as an operator can call verify-authorizer
//     but cannot call /api/training/overrides at all, and an override an
//     operator can never obtain is not an override.
//
// Tokens live in this process's memory, like the PIN lockout counters in
// routes/operators.js: they are valid for ten minutes and are consumed once.
// A restart forgets pending tokens, which costs a supervisor one more PIN
// entry — the durable record is the qualification_overrides row, and that is
// written to the database the moment a proof is consumed.
const pendingOverrides = new Map();

function sweepOverrides(now = Date.now()) {
  for (const [token, entry] of pendingOverrides) {
    if (entry.expires_at <= now) pendingOverrides.delete(token);
  }
}

/**
 * Mint a one-shot override token for app+operator.
 * @param {object} p
 * @param {string} p.companyId
 * @param {string} p.appId
 * @param {string|null} p.userId        the operator's user id, when known
 * @param {string} p.operatorName
 * @param {object} p.approvedBy         { user_id, display_name } from the grant
 * @param {string} [p.reason]
 */
function issueOverrideToken({ companyId, appId, userId, operatorName, approvedBy, reason = '' }) {
  sweepOverrides();
  const token = crypto.randomBytes(24).toString('hex');
  pendingOverrides.set(token, {
    company_id: companyId,
    app_id: appId,
    user_id: userId || null,
    operator_name: String(operatorName || ''),
    approved_by_user_id: approvedBy.user_id,
    approved_by_name: approvedBy.display_name || '',
    reason: String(reason || ''),
    expires_at: Date.now() + OVERRIDE_TTL_MS,
  });
  return token;
}

/** Write the permanent record of an override that has just been used. */
function recordOverride(companyId, entry, { appName }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO qualification_overrides
      (id, company_id, completion_id, app_id, user_id, operator_name,
       approved_by_user_id, approved_by_name, reason)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `).run(
    id, companyId, entry.app_id, entry.user_id, entry.operator_name,
    entry.approved_by_user_id, entry.approved_by_name, entry.reason,
  );
  // Both people are named, because "somebody approved it" is not an audit
  // trail. entity_id is the app, so a per-app count is one GROUP BY.
  logActivity(
    companyId, LOG_ENTITY, entry.app_id,
    `${OVERRIDE_ACTION}: ${entry.operator_name || 'Unnamed operator'} started ${appName || 'an app'} `
      + `without certification — approved by ${entry.approved_by_name || 'a supervisor'}`,
    entry.approved_by_name || 'System',
  );
  return id;
}

/**
 * Consume the proof carried on a start request. Returns the id of the
 * qualification_overrides row written, or null when the proof is unusable —
 * unknown, expired, already spent, another company's, or minted for a
 * different app or a different operator.
 *
 * Consumption is what makes it single use: the second start carrying the same
 * value finds nothing and is refused exactly like the first would have been.
 */
function consumeOverrideProof(companyId, proof, { appId, userId, operatorName, appName }) {
  if (!proof || typeof proof !== 'string') return null;
  sweepOverrides();

  const minted = pendingOverrides.get(proof);
  if (minted) {
    pendingOverrides.delete(proof);
    if (minted.company_id !== companyId) return null;
    if (minted.app_id !== appId) return null;
    // The token names an operator; it may not be spent on somebody else.
    const wantName = String(minted.operator_name || '').trim().toLowerCase();
    const gotName = String(operatorName || '').trim().toLowerCase();
    const sameUser = !!(minted.user_id && userId && minted.user_id === userId);
    const sameName = !!(wantName && gotName && wantName === gotName);
    if (!sameUser && !sameName) return null;
    return recordOverride(companyId, minted, { appName });
  }

  // Otherwise: a supervisor authorization grant, redeemed the same way an
  // in-run NCR redeems one. redeemGrant is atomic and single use.
  const grant = redeemGrant(proof, companyId, 'qualification_override');
  if (!grant) return null;
  return recordOverride(companyId, {
    app_id: appId,
    user_id: userId || null,
    operator_name: String(operatorName || ''),
    approved_by_user_id: grant.user_id,
    approved_by_name: grant.display_name || '',
    reason: '',
  }, { appName });
}

/** Record a refused start so a manager can see what the setting is costing. */
function recordBlockedStart(companyId, { appId, appName, operatorName, state }) {
  logActivity(
    companyId, LOG_ENTITY, appId,
    `${BLOCKED_ACTION}: ${operatorName || 'Unnamed operator'} is not signed off for `
      + `${appName || 'this app'} (${state === 'expired' ? 'certification expired' : 'no certification'})`,
    operatorName || 'System',
  );
}

/**
 * Blocked starts per app over the last `days`, as a map of app_id → count.
 * An app with no refusals is ABSENT from the map rather than present with a
 * zero: "0 blocked starts" and "nothing has been measured" are different
 * facts, and the screen says '—' for the second.
 */
function blockedStartsByApp(companyId, days = 7) {
  const window = `-${Math.max(1, Math.min(365, Number(days) || 7))} days`;
  const rows = db.prepare(`
    SELECT entity_id AS app_id, COUNT(*) AS blocked
    FROM activity_log
    WHERE company_id = ? AND entity_type = ? AND action LIKE ?
      AND created_at >= datetime('now', ?)
    GROUP BY entity_id
  `).all(companyId, LOG_ENTITY, `${BLOCKED_ACTION}%`, window);
  const out = {};
  for (const r of rows) out[r.app_id] = r.blocked;
  return out;
}

// ─── The middleware ──────────────────────────────────────────────────────────

/**
 * Mounted in index.js as `app.post('/api/completions', enforceQualification)`,
 * immediately before the completions router. It is a middleware precisely so
 * that routes/completions.js — the file that books runs, and the file another
 * workstream is editing this wave — is not touched at all.
 *
 * HOW THE STAMP LANDS WITHOUT EDITING completions.js. In 'warn' (and in 'block'
 * once the operator is allowed through) the middleware wraps res.json for this
 * one request. The router builds and sends its 201 exactly as it always has;
 * the wrapper sees the created row's id in the body it is about to serialize,
 * writes qualification_state onto that row, and adds the same value to the body
 * so the client and the database cannot disagree. Nothing is deferred to
 * res.on('finish'), so the UPDATE is inside the request and a caller reading
 * the run back immediately sees the stamp.
 */
function enforceQualification(req, res, next) {
  const companyId = req.companyId;
  if (!companyId) return next();

  // 'off' is a genuine short circuit: no training table is read, no app row is
  // fetched, nothing is prepared. An existing customer's start path is byte for
  // byte the one they have today.
  const mode = enforcementMode(companyId);
  if (mode === 'off') return next();

  const appId = req.body?.app_id;
  if (!appId) return next();   // the router answers 400 for this, as it always has

  const userId = req.body?.operator_user_id || null;
  const operatorName = req.body?.operator_name || '';

  let check;
  try {
    check = checkQualification(companyId, { userId, operatorName, appId });
  } catch (err) {
    // A gate that throws must not become a gate that stops production. Let the
    // run through and leave the state unstated rather than 500 the floor.
    req.log?.error?.({ err }, 'qualification check failed');
    return next();
  }

  // Nothing is asked of anybody for this app: pass through with no stamp, which
  // is the honest '' — not 'none', which would read as an uncertified run.
  if (!check.required) return next();

  let state = check.state;
  let overrideId = null;
  const proof = req.get('X-Qualification-Override');
  if (proof) {
    overrideId = consumeOverrideProof(companyId, proof, {
      appId, userId: check.user_id, operatorName: check.operator_name, appName: check.app_name,
    });
    if (overrideId) state = 'override';
  }

  if (mode === 'block' && state !== 'certified' && state !== 'override') {
    recordBlockedStart(companyId, {
      appId, appName: check.app_name, operatorName: check.operator_name, state,
    });
    return res.status(403).json({
      error: check.state === 'expired'
        ? `${check.operator_name || 'This operator'} is not signed off for ${check.app_name} — the certification has expired.`
        : `${check.operator_name || 'This operator'} is not signed off for ${check.app_name}.`,
      code: 'NOT_QUALIFIED',
      app_name: check.app_name,
      operator_name: check.operator_name,
      state: check.state,
      expiry_date: check.expiry_date,
    });
  }

  const stamp = vocab.isValid('QUALIFICATION_STATE', state) ? state : '';
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode === 201 && body && typeof body === 'object' && body.id) {
        db.prepare(`UPDATE completions SET qualification_state = ? WHERE id = ? AND company_id = ?`)
          .run(stamp, body.id, companyId);
        body.qualification_state = stamp;
        if (overrideId) {
          db.prepare(`UPDATE qualification_overrides SET completion_id = ? WHERE id = ? AND company_id = ?`)
            .run(body.id, overrideId, companyId);
        }
      }
    } catch (err) {
      // The run is already booked. Losing the stamp is a reporting gap, not a
      // reason to fail a request the floor has already succeeded at.
      req.log?.error?.({ err }, 'stamping qualification_state failed');
    }
    return sendJson(body);
  };
  next();
}

module.exports = {
  ENFORCEMENT_KEY, LOG_ENTITY, BLOCKED_ACTION, OVERRIDE_ACTION, OVERRIDE_TTL_MS,
  enforcementMode, setEnforcementMode, checkQualification,
  issueOverrideToken, consumeOverrideProof, recordBlockedStart, blockedStartsByApp,
  enforceQualification,
  __stats,
};
