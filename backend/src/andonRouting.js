// ─── Andon alert routing — who actually gets pinged ──────────────────────────
// An alert that nobody receives is worse than no alert at all, so resolution is
// a cascade that always terminates somewhere real:
//
//   1. Members of the alert's DEPARTMENT holding the matching team_role
//      (the department comes from the station / work order / app context, or
//      from the department that was alerted directly).
//   2. Failing that, anyone in the COMPANY holding that team_role — a small
//      shop may have one quality person covering every line.
//   3. Failing that, the company's configured notification email, so the alert
//      is never silently dropped.
//
// A department alert additionally pulls in that department's 'lead' members.
// Each recipient is honoured per their own preferences: notify_email sends a
// real email through email.js (logged to notification_log), notify_in_app
// writes a targeted `messages` row so they get the existing toast + bell badge.
// Nothing here throws back into the request handler.

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { sendAndonAlertEmail } = require('./email');
const { getPrefs } = require('./notifications');
const { sendToUsers } = require('./ws');

const SELECT_MESSAGE = `
  SELECT m.id, m.sender_id, m.sender_name, m.sender_role, m.body, m.severity,
         m.created_at, m.recipient_id, r.display_name AS recipient_name
  FROM messages m
  LEFT JOIN users r ON r.id = m.recipient_id
`;

// Alert priority → the severity vocabulary the message toast already renders.
const SEVERITY_BY_PRIORITY = { critical: 'urgent', high: 'warning', normal: 'info', low: 'info' };

function memberQuery(extraWhere) {
  return `
    SELECT dm.id AS membership_id, dm.team_role, dm.notify_email, dm.notify_in_app,
           dm.department_id, d.name AS department_name,
           u.id AS user_id, u.display_name, u.email
    FROM department_members dm
    JOIN users u ON u.id = dm.user_id
    LEFT JOIN departments d ON d.id = dm.department_id
    WHERE dm.company_id = ? AND u.is_active = 1 AND u.company_id = ?
      AND ${extraWhere}
  `;
}

/**
 * Resolves the people who should hear about one alert.
 * Returns { recipients: [...], scope: 'department' | 'company' | 'fallback' | 'none' }.
 * `recipients` is de-duplicated by user id — someone who matches on two
 * memberships is one person and gets one ping.
 *
 * `excludeUserIds` leaves people out of the result. Escalation is the reason it
 * exists: chasing a call that nobody answered means reaching someone NEW, so
 * andonEscalation.js passes the people who were already alerted and they are
 * skipped at every step of the cascade — including the company-wide fallback,
 * which would otherwise hand the same silent person the same alert twice and
 * call it an escalation.
 */
function resolveRecipients(companyId, { team, departmentId, targetType, excludeUserIds }) {
  const seen = new Set();
  const excluded = new Set((excludeUserIds || []).filter(Boolean));
  const pick = rows => {
    const out = [];
    for (const r of rows) {
      if (!r.user_id || seen.has(r.user_id) || excluded.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push(r);
    }
    return out;
  };

  // 1. The department this alert came from (or was aimed at).
  if (departmentId) {
    // A department alert wants the whole responding side of that department:
    // the matching function role AND the department's leads.
    const roles = targetType === 'department' ? [team, 'lead'] : [team];
    const placeholders = roles.map(() => '?').join(', ');
    const rows = db.prepare(memberQuery(`dm.department_id = ? AND dm.team_role IN (${placeholders})`))
      .all(companyId, companyId, departmentId, ...roles);
    const recipients = pick(rows);
    if (recipients.length) return { recipients, scope: 'department' };
  }

  // 2. Anyone in the company holding that role.
  const companyRows = db.prepare(memberQuery('dm.team_role = ?')).all(companyId, companyId, team);
  const companyWide = pick(companyRows);
  if (companyWide.length) return { recipients: companyWide, scope: 'company' };

  // 3. Nobody is on that team yet — fall back to the company's alert address.
  const prefs = getPrefs(companyId);
  if (prefs.email_to) {
    return {
      recipients: [{
        user_id: null,
        display_name: 'Company alerts',
        email: prefs.email_to,
        notify_email: 1,
        notify_in_app: 0,
        team_role: team,
        department_id: null,
        department_name: null,
      }],
      scope: 'fallback',
    };
  }
  return { recipients: [], scope: 'none' };
}

function logNotification(companyId, recipient, subject, body, status) {
  try {
    db.prepare(`
      INSERT INTO notification_log (id, company_id, channel, event, recipient, subject, body, status)
      VALUES (?, ?, 'email', 'andon.alert', ?, ?, ?, ?)
    `).run(uuidv4(), companyId, recipient, subject, body, status);
  } catch (e) {
    console.error('[andon-routing] could not log notification:', e.message);
  }
}

/** One plain-text summary of the alert, reused by the email and the in-app ping.
 *  The place is dropped when the title already names it — an auto-titled alert
 *  reads "Quality needed at Station 3", and repeating "Station 3" underneath
 *  helps nobody. */
function describe(call) {
  const place = call.station_name || (call.target_type === 'department' ? '' : call.department_name);
  const where = place && !(call.title || '').includes(place) ? place : '';
  return [
    where,
    call.work_order_number && `WO ${call.work_order_number}`,
    call.app_name && call.step_name ? `${call.app_name} · ${call.step_name}` : call.app_name,
  ].filter(Boolean).join(' · ');
}

/**
 * Fire-and-forget delivery for one alert. Returns the resolution so callers
 * (and tests) can see who was chosen without waiting on the sends.
 */
function deliverAlert(companyId, call) {
  try {
    const { recipients, scope } = resolveRecipients(companyId, {
      team: call.team,
      departmentId: call.department_id,
      targetType: call.target_type,
    });
    if (!recipients.length) return { recipients: [], scope };

    const who = call.target_label || call.team_label || 'A team';
    const context = describe(call);
    const subject = `${who} alerted — ${call.title}`;
    const bodyLines = [
      `${who} has been alerted${call.created_by ? ` by ${call.created_by}` : ''}.`,
      call.title,
      context,
      call.message && `Note: ${call.message}`,
    ].filter(Boolean);
    const body = bodyLines.join('\n');
    const severity = SEVERITY_BY_PRIORITY[call.priority] || 'info';

    const inAppRecipients = [];
    for (const person of recipients) {
      // ── Email
      if (person.notify_email && person.email) {
        logNotification(companyId, person.email, subject, body, 'simulated');
        sendAndonAlertEmail({
          to: person.email,
          name: person.display_name,
          who,
          title: call.title,
          context,
          note: call.message,
          raisedBy: call.created_by,
          priority: call.priority,
        }).catch(err => console.error('[andon-routing] email failed:', err.message));
      }
      // ── In-app: a targeted message row IS the ping (toast + bell badge).
      if (person.notify_in_app && person.user_id) {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO messages (id, company_id, sender_id, sender_name, sender_role, body, severity, recipient_id)
          VALUES (?, ?, NULL, ?, 'system', ?, ?, ?)
        `).run(
          id, companyId,
          `${who} needed`,
          [call.title, context, call.message].filter(Boolean).join(' — '),
          severity, person.user_id,
        );
        inAppRecipients.push({ userId: person.user_id, messageId: id });
      }
    }

    // Push the in-app pings down the socket the recipients already hold open.
    for (const { userId, messageId } of inAppRecipients) {
      const message = db.prepare(`${SELECT_MESSAGE} WHERE m.id = ?`).get(messageId);
      if (message) sendToUsers(companyId, [userId], { type: 'message', message });
    }

    return { recipients, scope };
  } catch (e) {
    console.error('[andon-routing] delivery error:', e.message);
    return { recipients: [], scope: 'none' };
  }
}

module.exports = { resolveRecipients, deliverAlert, SEVERITY_BY_PRIORITY };
