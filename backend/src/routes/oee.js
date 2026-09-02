const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { plantDayShift } = require('../plantDay');
// "Completions today" and "quality today" are two of the five numbers this
// product must only have one answer to. They come from src/plantTruth.js, the
// same module the Command Center and the department page read, so a station
// tile can no longer disagree with the page it is sitting on. Availability and
// Performance are this file's own arithmetic and are untouched.
const plantTruth = require('../plantTruth');
const { notify } = require('../notifications');
const { deliverWebhooks } = require('../webhooks');
const { requireRole } = require('../middleware/auth');
// Good/scrap/rework arithmetic lives in one module, so the OEE tab, the app
// screen and the shift note cannot each invent their own first-pass yield.
const scrapModel = require('../scrap');
// The six big losses are a frozen vocabulary, not a list this file keeps.
const { LOSS_BUCKET } = require('../vocab');

const router = express.Router();

/** How the six losses are printed. The keys are vocab.LOSS_BUCKET verbatim. */
const BUCKET_LABELS = Object.freeze({
  breakdown: 'Breakdown',
  setup_adjustment: 'Setup and adjustment',
  minor_stop: 'Minor stop',
  speed_loss: 'Speed loss',
  startup_reject: 'Startup reject',
  process_reject: 'Process reject',
});

/** Minutes, to a tenth. Every figure this file emits goes through it. */
const round1 = n => Math.round((Number(n) || 0) * 10) / 10;

// ─── OEE calculation helper ───────────────────────────────────────────────────

// Returns the three OEE factors as percentages, or `null` for any factor the
// station has no basis to measure. Nothing here is ever guessed: Performance
// needs a configured ideal cycle time, Quality needs at least one run today,
// and OEE itself is only reported when all three factors are real.
function calcOEE(station, context = null) {
  const fullDayMinutes = (station.planned_hours_per_day || 8) * 60;
  // "Today" means the plant's today. Against UTC, a second-shift crew watched
  // every counter on this screen reset in the middle of their shift.
  //
  // A caller looping over stations passes ONE context in, so a fleet of thirty
  // machines resolves the company's day once instead of thirty times — and so
  // every tile on the screen is measured against the same instant.
  const ctx = context || plantTruth.plantContext(station.company_id);
  const day = ctx.day;

  // Planned time ELAPSED SO FAR today, not the whole shift. Dividing today's
  // output by a full eight hours at ten in the morning reports a station
  // running perfectly as roughly 25% — the number only becomes meaningful once
  // the shift is over, which is the one time nobody is watching it. Every
  // morning reading was structurally wrong in the same way.
  //
  // The window opens at the first thing that actually happened on this station
  // today — a machine event or a run being started — because a shift start time
  // is not something every company has told us. It is capped at the planned day
  // so a station left running past its shift cannot inflate its own denominator,
  // and floored at one minute so the first run of the day is not divided by zero.
  const firstActivity = db.prepare(`
    SELECT MIN(t) AS t FROM (
      SELECT MIN(started_at) AS t FROM machine_events
       WHERE station_id = ? AND date(started_at, ?) = date('now', ?)
      UNION ALL
      SELECT MIN(started_at) AS t FROM completions
       WHERE station_id = ? AND date(started_at, ?) = date('now', ?)
    )
  `).get(station.id, day, day, station.id, day, day);

  const startedMs = firstActivity?.t ? new Date(firstActivity.t).getTime() : null;
  const elapsedMinutes = startedMs === null
    ? 0
    : Math.max(1, Math.min(fullDayMinutes, (Date.now() - startedMs) / 60000));

  // Nothing has happened on this station today: there is no window to measure
  // against, so the factors below come back unmeasured rather than invented.
  const plannedMinutes = elapsedMinutes;

  // Sum all downtime/maintenance events today that have ended
  const downtimeRows = db.prepare(`
    SELECT COALESCE(SUM(duration_minutes), 0) as total
    FROM machine_events
    WHERE station_id = ? AND event_type IN ('down','maintenance')
      AND date(started_at, ?) = date('now', ?) AND duration_minutes IS NOT NULL
  `).get(station.id, day, day);

  // Also count ongoing downtime/maintenance event if current_status is down/maintenance
  let ongoingDowntime = 0;
  if (['down', 'maintenance'].includes(station.current_status) && station.current_status_since) {
    ongoingDowntime = Math.max(0,
      (Date.now() - new Date(station.current_status_since).getTime()) / 60000
    );
  }

  const downtimeMinutes = (downtimeRows.total || 0) + ongoingDowntime;
  const uptimeMinutes = Math.max(0, plannedMinutes - downtimeMinutes);
  // Nothing has run today, so there is no planned window yet and no
  // availability to state. This used to report 0%, which reads as "the machine
  // was down all day" rather than "the day has not started".
  const availability = plannedMinutes > 0 ? uptimeMinutes / plannedMinutes : null;

  // Completions today for this station — the plant's day, counted once, by the
  // module that defines what "today" is.
  const scope = plantTruth.stationScope(station);
  const completionsToday = plantTruth.finishedToday(ctx, scope);

  // Performance: actual output vs the ideal cycle time. Without a configured
  // ideal cycle there is no yardstick, so Performance is reported as unknown
  // rather than invented (this used to default to a made-up 90%).
  const hasIdealCycle = (station.ideal_cycle_seconds || 0) > 0;
  const performance = hasIdealCycle && uptimeMinutes > 0
    ? Math.min(1, (completionsToday * station.ideal_cycle_seconds) / (uptimeMinutes * 60))
    : null;

  // ── Quality: units when the plant counted them, inspections when it did not ─
  //
  // Quality is a QUANTITY question — how many of the pieces this station made
  // today were good — and until migration 012 there were no quantities to ask
  // it of. So it was answered by string-matching 'Pass'/'Fail' inside the run's
  // JSON blob, which measures how many RUNS were inspected, not how many PIECES
  // were good. A run that made ten pieces and scrapped four counted as one
  // pass.
  //
  // The order below is best-evidence-first, and the basis is NAMED on the
  // payload, because "90% quality" from counted units and "90% quality" from
  // pass/fail stamps are different claims and a screen has to be able to say
  // which one it is showing:
  //
  //   'quantities' — at least one run today recorded good/scrap/rework.
  //                  quality = good ÷ (good + scrap + rework). Rework is in the
  //                  denominator on purpose: a piece that needed a second pass
  //                  was not right the first time.
  //   'inspection' — no counts, but runs carrying a Pass/Fail verdict.
  //   null         — neither. NOT 100%: a station that measures nothing has no
  //                  quality figure, and `quality_reason` says exactly that.
  const counts = db.prepare(`
    SELECT COALESCE(SUM(quantity_good), 0)   AS good,
           COALESCE(SUM(quantity_scrap), 0)  AS scrap,
           COALESCE(SUM(quantity_rework), 0) AS rework,
           COUNT(*)                          AS runs
    FROM completions
    WHERE station_id = ? AND company_id = ? AND status = 'completed'
      AND date(completed_at, ?) = date('now', ?)
      AND (quantity_good IS NOT NULL OR quantity_scrap IS NOT NULL OR quantity_rework IS NOT NULL)
  `).get(station.id, station.company_id, day, day);
  const unitsCounted = (counts?.good || 0) + (counts?.scrap || 0) + (counts?.rework || 0);

  // A rate over INSPECTED runs only. A run with no Pass/Fail step was never
  // inspected — the old `if (!Fail) pass++` counted it as good (and kept it in
  // the denominator), so a station that inspects nothing reported 100% quality.
  const verdicts = plantTruth.passRate(ctx, scope, 'today');
  const inspected = verdicts.sample;

  let quality = null;
  let qualityBasis = null;
  let qualitySample = 0;
  let qualityReason = null;
  if ((counts?.runs || 0) > 0 && unitsCounted > 0) {
    quality = counts.good / unitsCounted;
    qualityBasis = 'quantities';
    qualitySample = counts.runs;
  } else if (inspected > 0) {
    quality = verdicts.pass / inspected;
    qualityBasis = 'inspection';
    qualitySample = inspected;
  } else {
    qualityReason = 'no run today recorded a unit count or a pass/fail result';
  }

  const measurable = availability !== null && performance !== null && quality !== null;
  const pct = v => (v === null ? null : Math.round(v * 100));

  // What a supervisor must do to make this station's OEE real.
  const missing = [];
  if (!hasIdealCycle) missing.push('ideal cycle time');
  // Either one of these makes Quality real. They stay as two entries because
  // that is what the array has always been, but a screen must not join them
  // with "and": doing so sends a supervisor off to build inspection steps when
  // typing the units at the end of a run would have done. `missing_hint` below
  // is the sentence to print, written once here rather than assembled
  // differently on every screen.
  if (quality === null) missing.push('an inspected run today');
  if (quality === null) missing.push('a recorded good/scrap count');
  if (availability === null) missing.push('any activity today');

  const needs = [];
  if (!hasIdealCycle) needs.push('an ideal cycle time');
  if (quality === null) needs.push('either an inspected run or a good/scrap count today');
  if (availability === null) needs.push('any activity today');
  // Joined as a list, not as a chain of "and"s: one of these clauses already
  // contains an "or", and "a and either b or c and d" is a sentence nobody can
  // parse on a tile they glanced at.
  const missingHint = needs.length === 0 ? null
    : `Needs ${needs.length <= 2 ? needs.join(' and ')
        : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`}`;

  // OEE is the product of the three numbers the screen SHOWS, so it is computed
  // from the rounded factors rather than from the raw fractions. Multiplying the
  // fractions and rounding once put the tile a point away from what a supervisor
  // gets multiplying the three figures printed beside it — 100 × 78 × 95 reads
  // as 74, and the tile said 75. One of the four is then wrong and the screen
  // does not say which.
  const availabilityPct = pct(availability);
  const performancePct  = pct(performance);
  const qualityPct      = pct(quality);

  return {
    availability: availabilityPct,
    performance: performancePct,
    quality: qualityPct,
    oee: measurable
      ? Math.round((availabilityPct / 100) * (performancePct / 100) * (qualityPct / 100) * 100)
      : null,
    measurable,
    missing,
    /** The sentence a screen prints when OEE cannot be stated. One wording, so
     *  the station page and the OEE tab cannot describe the same gap
     *  differently — and never "and" where the truth is "either". */
    missing_hint: missingHint,
    uptime_minutes: Math.round(uptimeMinutes),
    downtime_minutes: Math.round(downtimeMinutes),
    /** Planned time elapsed so far today — the denominator actually used. */
    planned_minutes: Math.round(plannedMinutes),
    /** The whole configured shift, for a screen that wants to say "of 8h". */
    planned_day_minutes: Math.round(fullDayMinutes),
    completions_today: completionsToday,
    /** How many of today's runs the quality figure was measured over. 0 ⇒
     *  quality is null, not 100%. */
    quality_sample: qualitySample,
    /** 'quantities' | 'inspection' | null — WHAT the quality figure counted.
     *  A screen printing the percentage has to print this beside it. */
    quality_basis: qualityBasis,
    /** Why there is no quality figure, when there is none. */
    quality_reason: qualityReason,
    /** The units behind a 'quantities' quality. Zeroes when the basis is not
     *  'quantities' — the sample above is what says whether they mean anything. */
    units_good: counts?.good || 0,
    units_scrap: counts?.scrap || 0,
    units_rework: counts?.rework || 0,
  };
}

// ─── GET / - all machines with live OEE ───────────────────────────────────────

router.get('/', (req, res) => {
  // This view measures TODAY (calcOEE's window is the plant's day so far), so
  // there is no window to widen — but `?days=-1` and `?days=abc` were answered
  // 200 with a full board of tiles, which reads as "your window was honoured".
  // A parameter this endpoint cannot honour is refused in the same words
  // /losses uses, rather than silently ignored.
  const window = scrapModel.parseDays(req.query.days, 1);
  if (!window.ok) return res.status(400).json({ error: window.error, field: 'days' });
  const stations = db.prepare('SELECT * FROM stations WHERE company_id = ? ORDER BY name ASC').all(req.companyId);
  // One day, resolved once, for every tile on the screen.
  const ctx = plantTruth.plantContext(req.companyId);
  const result = stations.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    location: s.location,
    status: s.status,
    current_status: s.current_status || 'idle',
    current_status_since: s.current_status_since || null,
    planned_hours_per_day: s.planned_hours_per_day || 8,
    ideal_cycle_seconds: s.ideal_cycle_seconds || 0,
    oee: calcOEE(s, ctx),
  }));
  res.json(result);
});

// ─── GET /losses - the downtime Pareto and the six big losses ────────────────
//
// Registered BEFORE '/:id' on purpose: Express matches in registration order,
// and '/:id' would swallow '/losses' as a station id.
//
// Downtime used to be a free-text `reason` on a machine event, so the plant had
// a word cloud where it needed a Pareto. Coded stops (migration 012) give every
// minute a reason code, and every downtime reason code carries one of the six
// big losses. What this endpoint will not do is GUESS: minutes logged before
// codes existed, or against a code that has since been deleted, are reported as
// `unclassified_minutes` and are never redistributed across the buckets. A
// Pareto built by spreading unknown minutes over known reasons is a chart that
// invents its own top cause.
router.get('/losses', (req, res) => {
  const day = plantDayShift(req.companyId);
  // A bad window is refused, not silently replaced: `days=0` coming back as
  // "today" under a heading that says otherwise is a wrong number nobody can
  // see is wrong.
  const window = scrapModel.parseDays(req.query.days, 1);
  if (!window.ok) return res.status(400).json({ error: window.error, field: 'days' });
  const days = window.days;
  const stationId = req.query.station_id ? String(req.query.station_id) : '';

  // An id from another tenant selects nothing rather than everything.
  let station = null;
  if (stationId) {
    station = db.prepare('SELECT id, name FROM stations WHERE id = ? AND company_id = ?')
      .get(stationId, req.companyId) || null;
  }

  const rows = (stationId && !station) ? [] : db.prepare(`
    SELECT me.id, me.event_type, me.reason, me.started_at, me.ended_at, me.duration_minutes,
           me.reason_code_id, me.station_id,
           rc.code AS code, rc.label AS label, rc.loss_bucket AS loss_bucket,
           s.name AS station_name
    FROM machine_events me
    JOIN stations s ON s.id = me.station_id
    LEFT JOIN reason_codes rc ON rc.id = me.reason_code_id AND rc.company_id = s.company_id
    WHERE s.company_id = ?
      AND me.event_type IN ('down','maintenance')
      AND date(me.started_at, ?) >= date('now', ?, ?)
      ${station ? 'AND me.station_id = ?' : ''}
    ORDER BY me.started_at DESC
  `).all(...[req.companyId, day, day, `-${days - 1} days`, ...(station ? [station.id] : [])]);

  // How long a stop lasted. A stop still open is counted up to this instant —
  // it is happening, and leaving it out is how a four-hour breakdown stays
  // invisible on the screen a supervisor is watching it on.
  const minutesOf = (ev) => {
    if (ev.duration_minutes !== null && ev.duration_minutes !== undefined) return Math.max(0, Number(ev.duration_minutes));
    const started = new Date(ev.started_at).getTime();
    if (!Number.isFinite(started)) return 0;
    const ended = ev.ended_at ? new Date(ev.ended_at).getTime() : Date.now();
    return Math.max(0, (ended - started) / 60000);
  };

  const buckets = new Map();   // loss_bucket → raw minutes
  const reasons = new Map();   // reason_code_id → { …, minutes }
  let unclassifiedRaw = 0;
  let unclassifiedEvents = 0;
  let classifiedRaw = 0;

  for (const ev of rows) {
    const mins = minutesOf(ev);
    if (!ev.reason_code_id || !ev.code) {
      // Pre-existing free text, or a code that has since been deleted. Its own
      // bar, its own number, never folded into a bucket it was never assigned.
      unclassifiedRaw += mins;
      unclassifiedEvents += 1;
      continue;
    }
    classifiedRaw += mins;
    const bucket = ev.loss_bucket || '';
    buckets.set(bucket, (buckets.get(bucket) || 0) + mins);
    const prev = reasons.get(ev.reason_code_id);
    if (prev) { prev.minutes += mins; prev.stops += 1; }
    else {
      reasons.set(ev.reason_code_id, {
        reason_code_id: ev.reason_code_id, code: ev.code, label: ev.label,
        loss_bucket: bucket, minutes: mins, stops: 1,
      });
    }
  }

  const totalRaw = classifiedRaw + unclassifiedRaw;
  const pct = raw => (totalRaw > 0 ? Math.round((raw / totalRaw) * 1000) / 10 : null);

  // The Pareto: every coded reason, longest first, plus the uncoded minutes as
  // their OWN labelled bar. Cumulative percent rides along so the 80/20 line can
  // be drawn without the screen re-deriving it.
  const paretoRaw = [...reasons.values()];
  if (unclassifiedRaw > 0) {
    // Sorted WITH the coded reasons, not appended after them: a Pareto is
    // ordered by size, and a plant whose biggest loss is "nobody coded it"
    // needs to see that at the top, not tucked underneath.
    paretoRaw.push({
      reason_code_id: null, code: 'unclassified', label: 'Not coded',
      loss_bucket: '', minutes: unclassifiedRaw, stops: unclassifiedEvents,
    });
  }
  paretoRaw.sort((a, b) => b.minutes - a.minutes);
  let running = 0;
  const pareto = paretoRaw.map(r => {
    running += r.minutes;
    return {
      reason_code_id: r.reason_code_id,
      code: r.code,
      label: r.label,
      loss_bucket: r.loss_bucket,
      // The bucket a reason rolls up into, and NULL when the two are the same
      // word. Several default reason codes ARE their bucket ('Breakdown' in
      // 'breakdown'), and a screen that prints "label · bucket_label" then
      // stuttered "Breakdown · Breakdown". Null is the honest answer to "what
      // else does this row tell you" — nothing — and is what stops the repeat
      // at the source rather than asking every reader to de-duplicate.
      bucket_label: (BUCKET_LABELS[r.loss_bucket] && BUCKET_LABELS[r.loss_bucket] !== r.label)
        ? BUCKET_LABELS[r.loss_bucket]
        : null,
      stops: r.stops,
      minutes: round1(r.minutes),
      pct: pct(r.minutes),
      cumulative_pct: pct(running),
    };
  });

  // The six big losses, always all six and always in the vocabulary's order, so
  // two months of this row can be read side by side. A reason code carrying no
  // bucket ('' — the honest answer for a stop that maps to none of the six) gets
  // its own trailing row rather than being pushed into one of them.
  const sixBigLosses = LOSS_BUCKET.map(b => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    minutes: round1(buckets.get(b) || 0),
    pct: pct(buckets.get(b) || 0),
  }));
  if ((buckets.get('') || 0) > 0) {
    sixBigLosses.push({
      bucket: '', label: 'No loss bucket',
      minutes: round1(buckets.get('')), pct: pct(buckets.get('')),
    });
  }

  res.json({
    days,
    plant_date: plantTruth.plantContext(req.companyId).plant_date,
    station_id: station ? station.id : null,
    station_name: station ? station.name : null,
    stops: rows.length,
    total_down_minutes: round1(totalRaw),
    classified_minutes: round1(classifiedRaw),
    /** Minutes logged before codes existed, or against a deleted code. Shown as
     *  its own bar; NEVER spread across the buckets. */
    unclassified_minutes: round1(unclassifiedRaw),
    unclassified_events: unclassifiedEvents,
    buckets: sixBigLosses.filter(b => b.minutes > 0).sort((a, b) => b.minutes - a.minutes),
    six_big_losses: sixBigLosses,
    pareto,
    /** Why the chart is empty, when it is. Printed instead of a row of zeros. */
    empty_reason: rows.length === 0
      ? (days === 1 ? 'No stops recorded today' : `No stops recorded in the last ${days} days`)
      : null,
  });
});

// ─── GET /scrap - first-pass yield and scrap by part ─────────────────────────
// Also before '/:id'. The arithmetic is backend/src/scrap.js; this is a door.
router.get('/scrap', (req, res) => {
  const window = scrapModel.parseDays(req.query.days, 30);
  if (!window.ok) return res.status(400).json({ error: window.error, field: 'days' });
  res.json(scrapModel.scrapByPart({ companyId: req.companyId, days: window.days }));
});

// ─── GET /:id - single machine detail ─────────────────────────────────────────

router.get('/:id', (req, res) => {
  // Same rule as GET / above: today's window, and a malformed one is refused
  // rather than ignored.
  const window = scrapModel.parseDays(req.query.days, 1);
  if (!window.ok) return res.status(400).json({ error: window.error, field: 'days' });
  const s = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: s.id, name: s.name, description: s.description, location: s.location,
    current_status: s.current_status || 'idle',
    current_status_since: s.current_status_since,
    planned_hours_per_day: s.planned_hours_per_day || 8,
    ideal_cycle_seconds: s.ideal_cycle_seconds || 0,
    oee: calcOEE(s),
  });
});

// ─── POST /:id/event - log status change ──────────────────────────────────────

router.post('/:id/event', requireRole('operator'), (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });

  const { event_type: rawEventType, reason = '', reason_code_id } = req.body;
  // Accept 'running' as alias for 'up'
  const event_type = rawEventType === 'running' ? 'up' : rawEventType;
  const validTypes = ['up', 'running', 'down', 'maintenance', 'idle'];
  if (!validTypes.includes(rawEventType)) {
    return res.status(400).json({ error: `event_type must be one of: ${validTypes.join(', ')}` });
  }

  // ── Stopping a station means picking from the coded list ───────────────────
  // The old free-text `reason` is kept as an optional note, because "conveyor
  // drive, third time this week" is worth writing down — but it is a note
  // beside a code now, not the only record. Free text cannot be summed, so a
  // plant with a hundred spellings of "no material" had no Pareto and no six
  // big losses, only a word cloud.
  //
  // machine_events has no company_id column of its own: a stop belongs to the
  // company that owns the STATION, so that is where the code's owner is checked
  // from. A code from another tenant, or one that explains scrap rather than a
  // stoppage, is refused and nothing is written.
  //
  // A RETIRED code is refused too. Retiring one takes it out of the picker but
  // never out of history, so last month's Pareto still reads correctly — what
  // must not happen is new minutes continuing to arrive under a cause the plant
  // has decided it no longer uses.
  let codeId = null;
  if (reason_code_id) {
    const rc = db.prepare('SELECT id, kind, is_active FROM reason_codes WHERE id = ? AND company_id = ?')
      .get(reason_code_id, station.company_id);
    if (!rc || rc.kind !== 'downtime' || !rc.is_active) {
      return res.status(400).json({
        error: 'reason_code_id must be one of this company\'s active downtime reason codes',
        field: 'reason_code_id',
      });
    }
    codeId = rc.id;
  }
  // Required for a stoppage, never for going back up or standing idle: an
  // operator restarting a machine should not have to explain the good news.
  if ((event_type === 'down' || event_type === 'maintenance') && !codeId) {
    return res.status(400).json({
      error: 'reason_code_id is required when a station goes down or into maintenance',
      field: 'reason_code_id',
    });
  }

  const now = new Date().toISOString();

  // Close any open event for this station
  const openEvent = db.prepare(`
    SELECT id, started_at FROM machine_events
    WHERE station_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1
  `).get(station.id);

  if (openEvent) {
    const startedMs = new Date(openEvent.started_at).getTime();
    const durationMinutes = (Date.now() - startedMs) / 60000;
    db.prepare(`UPDATE machine_events SET ended_at=?, duration_minutes=? WHERE id=?`)
      .run(now, Math.round(durationMinutes * 10) / 10, openEvent.id);
  }

  // Create new event
  const eventId = uuidv4();
  db.prepare(`INSERT INTO machine_events (id, station_id, event_type, reason, reason_code_id, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(eventId, station.id, event_type, reason, codeId, now);

  // Map event_type to current_status
  const statusMap = { up: 'running', down: 'down', maintenance: 'maintenance', idle: 'idle' };
  db.prepare(`UPDATE stations SET current_status=?, current_status_since=? WHERE id=?`)
    .run(statusMap[event_type], now, station.id);

  const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(station.id);

  if (event_type === 'down' && station.current_status !== 'down') {
    notify(req.companyId, 'station.down', {
      body: `Station "${station.name}" went down${reason ? ` (${reason})` : ''}.`,
    });
    deliverWebhooks(req.companyId, 'station.down', { id: station.id, name: station.name, reason });
  }

  res.json({
    id: updated.id, name: updated.name, current_status: updated.current_status,
    current_status_since: updated.current_status_since,
    oee: calcOEE(updated),
  });
});

// ─── PUT /:id/settings - update OEE settings ──────────────────────────────────

router.put('/:id/settings', requireRole('supervisor'), (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!station) return res.status(404).json({ error: 'Not found' });

  const { planned_hours_per_day, ideal_cycle_seconds } = req.body;
  const hours = planned_hours_per_day ?? station.planned_hours_per_day ?? 8;
  const cycle = ideal_cycle_seconds ?? station.ideal_cycle_seconds ?? 0;
  if (!Number.isFinite(Number(hours)) || Number(hours) < 0 || Number(hours) > 24) {
    return res.status(400).json({ error: 'planned_hours_per_day must be a number between 0 and 24' });
  }
  if (!Number.isFinite(Number(cycle)) || Number(cycle) < 0) {
    return res.status(400).json({ error: 'ideal_cycle_seconds must be a non-negative number' });
  }
  db.prepare(`UPDATE stations SET planned_hours_per_day=?, ideal_cycle_seconds=? WHERE id=?`)
    .run(Number(hours), Number(cycle), station.id);
  const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(station.id);
  res.json({ ...updated, oee: calcOEE(updated) });
});

// ─── GET /:id/history - event history ─────────────────────────────────────────

router.get('/:id/history', (req, res) => {
  const { limit = 50 } = req.query;
  const owned = db.prepare('SELECT id FROM stations WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const events = db.prepare(`
    SELECT * FROM machine_events
    WHERE station_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(req.params.id, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500));
  res.json(events);
});

// ─── GET /analytics/trend - plant-wide OEE trend (last 30 days) ───────────────

router.get('/analytics/trend', (req, res) => {
  const stations = db.prepare('SELECT id FROM stations WHERE company_id = ?').all(req.companyId);
  // For now return per-day throughput and uptime summary
  // Buckets are plant days, so the last point on this trend is the same day the
  // station tiles above it call "today".
  const day = plantDayShift(req.companyId);
  const trend = db.prepare(`
    SELECT
      date(completed_at, ?) as date,
      COUNT(*) as completions,
      COUNT(DISTINCT station_id) as active_stations
    FROM completions
    WHERE company_id = ? AND status='completed' AND date(completed_at, ?) >= date('now', ?, '-30 days')
    GROUP BY 1 ORDER BY date ASC
  `).all(day, req.companyId, day, day);
  res.json({ station_count: stations.length, trend });
});

module.exports = router;
module.exports.calcOEE = calcOEE;
