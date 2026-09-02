'use strict';

// ─── A help call that chases someone ─────────────────────────────────────────
//
// Andon had routing and teams but no clock. A call was resolved to a set of
// recipients once, at the moment it was raised, and then nothing ever looked at
// it again. If the person who was pinged was on a forklift, at lunch, or simply
// did not care, the call sat 'open' for the rest of the shift with nobody
// chasing it — and the board could not say so, because "waiting 46m" reads the
// same whether the target was five minutes or an hour.
//
// So every call now carries a target (`respond_by`, stamped at creation from
// the company's andon_targets row for that team + priority) and this sweeper
// enforces it:
//
//   open + respond_by in the past + escalation_level < 2
//     → level += 1, a NEW set of people (the escalate-to team, with everyone
//       already alerted excluded), a message each, an activity line, a webhook.
//
// Three rules keep it honest:
//
//   1. ESCALATION IS A LEVEL, NOT A STATUS. andon_calls.status is frozen at
//      three words by a CHECK that cannot be altered in place. An escalated
//      call stays 'open', which is also what it is: unanswered.
//   2. ONE MESSAGE PER LEVEL, EVER. Escalating pushes respond_by forward by the
//      escalate window, so the next tick inside that window matches nothing;
//      and level 2 is the end of the chain, so a call that nobody ever answers
//      generates exactly two chases, not one every minute forever.
//   3. NEVER THE SAME PERSON TWICE. The people already alerted are passed to
//      resolveRecipients as excludeUserIds, so an escalation always reaches
//      somebody new — or falls through to the company's alert address.
//   4. A LEVEL IS ONLY CLAIMED WHEN SOMEBODY IS ACTUALLY TOLD. If the tier
//      resolves to nobody (a one-supervisor shop, a company with no manager),
//      the level is NOT stamped, no webhook fires and the board paints no
//      badge. One activity line says who is missing, and the call is retried on
//      the next tick — so adding the manager makes the escalation happen rather
//      than leaving a call that was "escalated" to an empty room.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { logActivity } = require('./activity');
const { broadcast, sendToUsers } = require('./ws');
const { deliverWebhooks } = require('./webhooks');
const { TEAMS, teamOf, teamLabel } = require('./andonTeams');
const { resolveRecipients, SEVERITY_BY_PRIORITY } = require('./andonRouting');
const { sendAndonAlertEmail } = require('./email');

/** How many times one call may climb. Two chases is a policy, not a loop. */
const MAX_ESCALATION_LEVEL = 2;

const SWEEP_INTERVAL_MS = 60 * 1000;

// ─── Default targets ─────────────────────────────────────────────────────────
// respond = how long someone has to say "on my way"; escalate = how long after
// THAT before the call climbs again. Seeded per company the first time anything
// reads them, so a new customer has a working clock without configuring one.
//
// 'safety' is not one of the four routing teams — it is an andon *type* that
// routes to the supervisor — but a safety call is the one that must never wait,
// so it gets a row of its own and the lookup prefers it. Two minutes, then five.
//
// escalate_to is a LADDER, and a ladder has to go UP. Escalating a supervisor
// call to the supervisors is not an escalation: the people who did not answer
// are excluded, which in a normal shop leaves nobody, and the board would paint
// a red badge over an alert that reached an empty room. So the function teams
// climb to the supervisor, and the supervisor — and safety, which must never
// sit — climb to MANAGEMENT. Level 2 always ends at management, whatever the
// team, because there is nowhere above it inside one company.
const MANAGER_TIER = 'manager';

const DEFAULT_TARGETS = Object.freeze({
  safety:      { respond: 2,  escalate: 5,  escalate_to: MANAGER_TIER },
  quality:     { respond: 10, escalate: 20, escalate_to: 'supervisor' },
  maintenance: { respond: 10, escalate: 20, escalate_to: 'supervisor' },
  supervisor:  { respond: 15, escalate: 30, escalate_to: MANAGER_TIER },
  materials:   { respond: 20, escalate: 40, escalate_to: 'supervisor' },
});

/** What a target's escalate_to may name: one of the four routing teams, or
 *  management. Validated by the route, so a typo is a 400 and not a silent
 *  coercion that quietly re-points a plant's escalation path. */
const ESCALATE_TO_OPTIONS = Object.freeze([...Object.keys(TEAMS), MANAGER_TIER]);

/** "Quality", "Supervisor", "Management" — the label for either kind of tier. */
function tierLabel(tier) {
  return tier === MANAGER_TIER ? 'Management' : teamLabel(tier);
}

const PRIORITIES = ['normal', 'high', 'critical'];

// A critical call is answered in half the time and chased in half the time; a
// high one is the base. One rule, printed on the Targets panel, so a manager can
// predict what a row will say before they open it.
function scaleForPriority(minutes, priority) {
  if (priority === 'critical') return Math.max(1, Math.round(minutes / 2));
  return minutes;
}

/** Seeds a company's default targets on its first read, and only then.
 *
 *  The cheap check is the point: every board poll asks for the targets, and
 *  fifteen INSERT OR IGNOREs per poll is fifteen writes a second on a wall
 *  display doing nothing but re-proving what it proved a moment ago. One COUNT
 *  answers it. INSERT OR IGNORE stays for the race where two requests seed at
 *  once, and because a company seeded before a new team existed gets the new
 *  rows the next time this runs against an empty result. */
function seedTargets(companyId) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM andon_targets WHERE company_id = ?').get(companyId).n;
  if (existing > 0) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO andon_targets
      (id, company_id, team, priority, respond_minutes, escalate_minutes, escalate_to_team)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    for (const [team, t] of Object.entries(DEFAULT_TARGETS)) {
      for (const priority of PRIORITIES) {
        insert.run(
          uuidv4(), companyId, team, priority,
          scaleForPriority(t.respond, priority),
          scaleForPriority(t.escalate, priority),
          t.escalate_to,
        );
      }
    }
  });
  seed();
}

/** Every target row for a company, seeded on first read. */
function listTargets(companyId) {
  seedTargets(companyId);
  return db.prepare(`
    SELECT * FROM andon_targets WHERE company_id = ?
     ORDER BY team ASC, CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END
  `).all(companyId);
}

/** The team key a call is measured against: its routing team, except a safety
 *  call, which has its own (much shorter) clock. */
function targetTeamOf(call) {
  return call?.type === 'safety' ? 'safety' : teamOf(call);
}

/**
 * The target for one team + priority. Seeds the company's defaults on the way
 * past, then falls back to the built-in default and finally to the supervisor
 * row, so this can never return nothing — a call without a target is a call
 * with no clock, which is the bug being fixed.
 */
function targetFor(companyId, team, priority) {
  seedTargets(companyId);
  const row = db.prepare('SELECT * FROM andon_targets WHERE company_id = ? AND team = ? AND priority = ?')
    .get(companyId, team, priority);
  if (row) return row;
  const fallback = DEFAULT_TARGETS[team] || DEFAULT_TARGETS.supervisor;
  return {
    team,
    priority,
    respond_minutes: scaleForPriority(fallback.respond, priority),
    escalate_minutes: scaleForPriority(fallback.escalate, priority),
    escalate_to_team: fallback.escalate_to,
  };
}

/** A stored stamp as epoch ms, UTC whatever shape it is in. SQLite's DEFAULT
 *  writes 'YYYY-MM-DD HH:MM:SS' with no zone marker; the route writes ISO. */
function asUtcMs(ts) {
  if (!ts) return null;
  const str = String(ts).trim().replace(' ', 'T');
  const ms = Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(str) ? str : `${str}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** "1 minute" / "20 minutes" — a sentence a person wrote, not a template with a
 *  bracketed (s) in it. */
function minutesPhrase(n) {
  const value = Math.max(0, Math.round(Number(n) || 0));
  return `${value} minute${value === 1 ? '' : 's'}`;
}

/** ISO instant `minutes` from `from`. */
function plusMinutes(minutes, from = new Date()) {
  return new Date(from.getTime() + Math.max(0, Number(minutes) || 0) * 60000).toISOString();
}

/** The respond-by instant for a call being raised now. */
function respondByFor(companyId, call, at = new Date()) {
  const target = targetFor(companyId, targetTeamOf(call), call.priority || 'normal');
  return { respond_by: plusMinutes(target.respond_minutes, at), target };
}

// ─── One escalation ──────────────────────────────────────────────────────────

const SELECT_MESSAGE = `
  SELECT m.id, m.sender_id, m.sender_name, m.sender_role, m.body, m.severity,
         m.created_at, m.recipient_id, r.display_name AS recipient_name
  FROM messages m
  LEFT JOIN users r ON r.id = m.recipient_id
`;

function logNotification(companyId, recipient, subject, body) {
  try {
    db.prepare(`
      INSERT INTO notification_log (id, company_id, channel, event, recipient, subject, body, status)
      VALUES (?, ?, 'email', 'andon.escalated', ?, ?, ?, 'simulated')
    `).run(uuidv4(), companyId, recipient, subject, body);
  } catch (e) {
    console.error('[andon-escalation] could not log notification:', e.message);
  }
}

/**
 * The people who ARE the management tier: every active user in the company at
 * manager level or above, minus anyone already alerted.
 *
 * Deliberately a ROLE query, not a department_members one. Management is the
 * top of the ladder precisely because it does not depend on somebody having
 * been added to a team — a plant that never filled in its department roster
 * still has an owner, and an unanswered safety call has to reach them. The
 * shape matches what resolveRecipients returns, so the delivery loop does not
 * care which kind of tier it is looking at.
 */
function resolveManagers(companyId, excludeUserIds = []) {
  const excluded = new Set((excludeUserIds || []).filter(Boolean));
  const rows = db.prepare(`
    SELECT id AS user_id, display_name, email
      FROM users
     WHERE company_id = ? AND is_active = 1 AND role IN ('manager', 'developer')
     ORDER BY display_name ASC
  `).all(companyId);
  return rows
    .filter(r => r.user_id && !excluded.has(r.user_id))
    .map(r => ({
      ...r,
      // Management has no per-department notification preferences to honour —
      // this tier exists because the ones that do have them stayed silent.
      notify_email: 1,
      notify_in_app: 1,
      team_role: MANAGER_TIER,
      department_id: null,
      department_name: null,
    }));
}

/** One tier of the ladder, whichever kind it is. */
function resolveTier(companyId, tier, call, excludeUserIds) {
  if (tier === MANAGER_TIER) {
    return { recipients: resolveManagers(companyId, excludeUserIds), scope: 'manager' };
  }
  return resolveRecipients(companyId, {
    team: tier,
    departmentId: call.department_id,
    targetType: 'team',
    excludeUserIds,
  });
}

/**
 * Records — once per call and level — that the ladder ran out of people.
 *
 * The alternative shipped for about a day: stamp the level anyway, log
 * "Escalated to Supervisor", fire the webhook and paint the badge, having told
 * nobody. That is worse than not escalating, because the board then says the
 * call is being handled. This says what is actually wrong and who would fix it.
 *
 * The guard is the log itself: the same sentence for the same call and level is
 * written once, however many ticks retry it. No new column, and it survives a
 * restart — which an in-memory set does not.
 */
function noteNobodyToEscalateTo(call, level, tier) {
  const action = `Nobody to escalate to for ${tierLabel(tier)} — add a manager or a team member (level ${level})`;
  const already = db.prepare(`
    SELECT 1 FROM activity_log
     WHERE company_id = ? AND entity_type = 'andon' AND entity_id = ? AND action = ?
  `).get(call.company_id, call.id, action);
  if (already) return false;
  try {
    logActivity(call.company_id, 'andon', call.id, action, 'System',
      { department_id: call.department_id || null, station_id: call.station_id || null });
  } catch (e) {
    console.error('[andon-escalation] could not log the empty tier:', e.message);
  }
  return true;
}

/** Who heard about this call when it was RAISED — the original recipients plus
 *  the person who raised it (nobody needs chasing about their own call).
 *  Recomputed from the same cascade that alerted them, because who is on a team
 *  is a question with one answer and storing a copy would only let it rot. */
function originallyAlerted(call) {
  const ids = new Set();
  const origin = resolveRecipients(call.company_id, {
    team: teamOf(call),
    departmentId: call.department_id,
    targetType: call.target_type,
  });
  for (const r of origin.recipients) if (r.user_id) ids.add(r.user_id);
  if (call.created_by_user_id) ids.add(call.created_by_user_id);
  return ids;
}

/**
 * Escalates one call by one level. Returns a small record of what happened, or
 * null when the row moved underneath us (somebody acknowledged it between the
 * SELECT and the UPDATE — the UPDATE's own WHERE is what decides).
 */
function escalateOne(call, at = new Date()) {
  const companyId = call.company_id;
  const level = call.escalation_level + 1;
  const priority = call.priority || 'normal';
  const target = targetFor(companyId, targetTeamOf(call), priority);
  // Level 1 climbs to whatever this team's target says. Level 2 always ends at
  // management: there is no rung above it, and "escalate the supervisor to the
  // supervisors" is how a chase reaches nobody.
  const tier = level >= MAX_ESCALATION_LEVEL
    ? MANAGER_TIER
    : (target.escalate_to_team || 'supervisor');

  const exclude = originallyAlerted(call);
  // A second climb also skips everyone the first climb reached. That tier is
  // reproduced by replaying its resolution with exactly the exclusions it had
  // at the time — replaying it with today's larger set would resolve to a
  // DIFFERENT tier and leave the people who were actually pinged eligible
  // again. escalated_to_user_id (the head of that tier) is added afterwards as
  // the belt to that braces.
  if (level > 1) {
    const firstTier = target.escalate_to_team || 'supervisor';
    const first = resolveTier(companyId, firstTier, call, [...exclude]);
    for (const r of first.recipients) if (r.user_id) exclude.add(r.user_id);
  }
  if (call.escalated_to_user_id) exclude.add(call.escalated_to_user_id);

  const { recipients, scope } = resolveTier(companyId, tier, call, [...exclude]);

  // ── Nobody up there ────────────────────────────────────────────────────────
  // The level is NOT claimed. A one-supervisor shop, or a company with no
  // manager on the roster, must not end up with a call the board says was
  // escalated and a tier that never heard a thing. The call keeps its level,
  // stays visibly past its target, and every later tick tries again — so the
  // moment somebody is added, the escalation actually happens.
  if (recipients.length === 0) {
    const logged = noteNobodyToEscalateTo(call, level, tier);
    return { id: call.id, company_id: companyId, level, tier, skipped: 'no_recipients', logged };
  }

  const nowIso = at.toISOString();
  const firstUser = recipients.find(r => r.user_id)?.user_id || null;
  // At the last level the target is not pushed forward: the call stays visibly
  // past its respond-by, because it IS past it and nothing more is coming.
  const nextRespondBy = level < MAX_ESCALATION_LEVEL
    ? plusMinutes(target.escalate_minutes, at)
    : call.respond_by;

  const claimed = db.prepare(`
    UPDATE andon_calls
       SET escalation_level = ?, escalated_at = ?, escalated_to_user_id = ?, respond_by = ?
     WHERE id = ? AND company_id = ? AND status = 'open' AND escalation_level = ?
  `).run(level, nowIso, firstUser, nextRespondBy, call.id, companyId, call.escalation_level);
  // Somebody acknowledged (or another process escalated) between read and
  // write: no message goes out, because this level is not ours to send.
  if (claimed.changes !== 1) return null;

  const label = tierLabel(tier);
  const title = call.title || call.description || 'Help request';
  const where = call.station_id
    ? (db.prepare('SELECT name FROM stations WHERE id = ?').get(call.station_id)?.name || '')
    : '';
  const createdAt = asUtcMs(call.created_at);
  const waited = createdAt === null ? null : Math.max(1, Math.round((at.getTime() - createdAt) / 60000));
  const subject = `Escalated to ${label} — ${title}`;
  const body = `Nobody acknowledged this help request within the ${minutesPhrase(target.respond_minutes)} target.`
    + (waited === null ? '' : ` It has been waiting ${minutesPhrase(waited)}.`);
  // An escalation is never "info": it exists because the first ping was
  // ignored. A critical call shouts; everything else is at least a warning.
  const severity = call.priority === 'critical' ? 'urgent' : 'warning';

  const pinged = [];
  for (const person of recipients) {
    if (person.notify_in_app && person.user_id) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO messages (id, company_id, sender_id, sender_name, sender_role, body, severity, recipient_id)
        VALUES (?, ?, NULL, ?, 'system', ?, ?, ?)
      `).run(
        id, companyId,
        `${label} — escalation ${level}`,
        [subject, where && `at ${where}`, body].filter(Boolean).join(' — '),
        severity, person.user_id,
      );
      pinged.push({ userId: person.user_id, messageId: id });
    }
    if (person.notify_email && person.email) {
      logNotification(companyId, person.email, subject, body);
      sendAndonAlertEmail({
        to: person.email,
        name: person.display_name,
        who: label,
        title: `Escalated: ${title}`,
        context: where,
        note: body,
        raisedBy: call.created_by || call.raised_by || '',
        priority: call.priority,
      }).catch(err => console.error('[andon-escalation] email failed:', err.message));
    }
  }

  for (const { userId, messageId } of pinged) {
    const message = db.prepare(`${SELECT_MESSAGE} WHERE m.id = ?`).get(messageId);
    if (message) sendToUsers(companyId, [userId], { type: 'message', message });
  }

  try {
    logActivity(
      companyId, 'andon', call.id,
      `Escalated to ${label} — no acknowledgement within ${minutesPhrase(target.respond_minutes)} (level ${level})`,
      'System',
      { department_id: call.department_id || null, station_id: call.station_id || null },
    );
  } catch (e) {
    console.error('[andon-escalation] activity log failed:', e.message);
  }

  const updated = db.prepare('SELECT * FROM andon_calls WHERE id = ?').get(call.id);
  const payload = {
    ...updated,
    escalated_to_team: tier,
    escalated_to_label: label,
    escalation_level: level,
    notified: recipients.filter(r => r.user_id).map(r => ({ user_id: r.user_id, display_name: r.display_name })),
    notify_scope: scope,
  };
  try { deliverWebhooks(companyId, 'andon.escalated', payload); } catch (e) {
    console.error('[andon-escalation] webhook failed:', e.message);
  }
  try { broadcast(companyId, { type: 'andon', action: 'escalated', call: payload }); } catch { /* board will poll */ }

  return { id: call.id, company_id: companyId, level, team: tier, tier, recipients: payload.notified };
}

/**
 * One sweep. Every open call whose respond-by has passed and that has not
 * already climbed twice moves up one level.
 *
 * Exported so tests drive escalation a tick at a time instead of waiting on a
 * timer — "escalates on the first tick, sends nothing on the second" is a claim
 * a sleep cannot make.
 */
function runOnce(at = new Date(), companyId = null) {
  // ONE instant decides both what is due and what the stamps say. Selecting on
  // julianday('now') while stamping `at` let the two drift apart by however long
  // the sweep took — and made a test that passes an explicit instant a test of
  // the wall clock instead.
  const atIso = at.toISOString();
  const due = db.prepare(`
    SELECT * FROM andon_calls
     WHERE status = 'open'
       AND respond_by IS NOT NULL
       AND escalation_level < ?
       AND julianday(respond_by) <= julianday(?)
       AND (? IS NULL OR company_id = ?)
     ORDER BY created_at ASC
  `).all(MAX_ESCALATION_LEVEL, atIso, companyId, companyId);

  const escalated = [];
  const stalled = [];
  for (const call of due) {
    if (!call.company_id) continue;
    try {
      const done = escalateOne(call, at);
      if (!done) continue;
      if (done.skipped) stalled.push(done);
      else escalated.push(done);
    } catch (e) {
      console.error('[andon-escalation] could not escalate', call.id, '-', e.message);
    }
  }
  if (escalated.length) console.log(`[andon-escalation] escalated ${escalated.length} call(s)`);
  if (stalled.length) console.log(`[andon-escalation] ${stalled.length} call(s) have nobody to escalate to`);
  return { escalated, stalled };
}

let started = false;

/**
 * Starts the minute sweep. Safe to call more than once.
 *
 * Under NODE_ENV=test the timer stays off unless ANDON_SWEEP_MS asks for it:
 * a suite drives runOnce() itself, and a background sweeper firing against a
 * test database mid-assertion is exactly the kind of flake that gets a test
 * deleted rather than fixed.
 */
function startAndonEscalation() {
  if (started) return;
  started = true;
  const configured = Number(process.env.ANDON_SWEEP_MS) || 0;
  if (process.env.NODE_ENV === 'test' && !configured) return;
  const every = configured > 0 ? configured : SWEEP_INTERVAL_MS;
  const sweep = () => {
    try { runOnce(); } catch (e) { console.error('[andon-escalation] sweep failed:', e.message); }
  };
  // unref() so requiring this module never keeps a process alive.
  setTimeout(sweep, Math.min(every, 15000)).unref();
  setInterval(sweep, every).unref();
}

module.exports = {
  runOnce, startAndonEscalation, escalateOne, resolveTier, resolveManagers,
  seedTargets, listTargets, targetFor, targetTeamOf, respondByFor, tierLabel,
  DEFAULT_TARGETS, MAX_ESCALATION_LEVEL, PRIORITIES, MANAGER_TIER, ESCALATE_TO_OPTIONS,
};
