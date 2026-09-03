'use strict';
// ─── The demo tells the truth, and search finds the job by its name ───────────
// An audit of the live demo found four things a prospect can see:
//
//   A1  the wall board's "Fastest Today" was a race between numbers off a
//       lattice — every operator's step timers were a pure function of the run
//       index, so the fastest run of every seeded day was the arithmetic
//       minimum of a formula and the Final Inspection time was decided by WHICH
//       OPERATOR was holding the part, not by the part.
//   A2  the floor search matched a work-order number and a part number, so a
//       supervisor who typed "Standard Bracket" — the name printed beside the
//       number on every screen — was told nothing was found.
//   A3  the demo's reason-code vocabulary was defined twice.
//   A4  a permission message named a role with its stored token.
//   A5  "WO-1001 is not released: at in_progress" put a status enum inside a
//       sentence a person reads.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test test/seed-race-and-name-search.test.js

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Set BEFORE any src/ require: it is what keeps the andon sweeper and the PM
// sweeper off in THIS process, which requires src/routes/andon.js below to
// prove there is only one reason-code list left.
process.env.NODE_ENV = 'test';

// Pure arithmetic out of the seed itself — no second copy of the formulas here,
// because two definitions of the demo's timings is how a board and the test
// that guards it drift apart.
const { shiftShape, seededStepTimes, BENCH_PACE_S } = require('../src/sandbox');
const { weldScrapRunSeconds } = require('../src/seedShapes');

const PORT = 3522; // reserved for this stream (seed-search) in MIGRATIONS.md
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-seed-search-${Date.now()}.db`);

process.env.DATABASE_PATH = DB_PATH;
process.env.SEED_DEMO_DATA = 'false';

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(__dirname, '..', 'src', 'index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DATABASE_PATH: DB_PATH,
        SEED_DEMO_DATA: 'false',
        EARLY_ACCESS: 'true',
        BACKUP_DIR: '',
        APP_URL: BASE,
        SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));
    const deadline = Date.now() + 15000;
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error('server did not start in time'));
      setTimeout(poll, 200);
    })();
  });
}

async function api(method, pathname, { token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

const list = payload => (Array.isArray(payload) ? payload : (payload?.departments || []));
const wip = (token, q) => api('GET', `/api/floor/wip?q=${encodeURIComponent(q)}`, { token });

/** A work order in the OTHER company, so every search here has something it
 *  must not find. Returns the created row. */
async function makeWo(token, fields) {
  const r = await api('POST', '/api/work-orders', {
    token,
    body: { quantity: 10, ...fields },
  });
  assert.equal(r.status, 201, `work order ${fields.work_order_number}: ${JSON.stringify(r.json)}`);
  return r.json;
}

// Company A is a no-sign-in sandbox — the demo a prospect actually sees.
// Company B is a real signup, holding a job on the SAME part name, so tenant
// scoping is tested against a collision rather than against absence.
let tokenA, tokenB, opTokenB;

const CAP_NAME = 'Capped Fitting';
const CAP_JOBS = 26;   // one more than WIP_PART_LIMIT, so the cap has to show
// A second part whose name carries the same fragment, so a capped NAME search
// is one that really did span more than one part — which is the case where a
// note reading "on this part" would be counting the flanges as fittings.
const CAP_SIBLING_NAME = 'Capped Flange';
const CAP_SIBLING_JOBS = 4;
const CAP_FRAGMENT = 'Capped';

// The demo app's own step takts, summed: 5 + 240 + 120. Read from the seed in
// production; pinned here the way sandbox-shift-shape.test.js pins it, so these
// tests measure the arithmetic rather than the sample app.
const IDEAL_CYCLE_S = 365;

/** Minutes since UTC midnight, the clock the sandbox seeds itself against
 *  (sandbox.js reads exactly this expression out of SQLite). */
const utcMinutesToday = () => {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
};

before(async () => {
  await startServer();

  const demo = await api('POST', '/api/auth/demo');
  assert.equal(demo.status, 201, `demo login: ${JSON.stringify(demo.json)}`);
  tokenA = demo.json.token;

  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Second Plant Co', email: `owner-${Date.now()}@secondplant.test`,
      password: 'SecretPass1', display_name: 'Olive Owner',
    },
  });
  assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
  tokenB = signup.json.token;

  // The collision: B's own job on the name A's whole demo is built around.
  await makeWo(tokenB, {
    work_order_number: 'WO-8801', part_number: 'BRKT-100', part_name: 'Standard Bracket',
  });
  // A number stored with a plant-code prefix, the way an ERP (and every
  // pre-wave-5 sandbox) writes it.
  await makeWo(tokenB, {
    work_order_number: 'ZZZ999-WO-8802', part_number: 'TAG-1', part_name: 'Tagged Fitting',
  });
  // One job per state the "no operation to stand on" branch can reach.
  await makeWo(tokenB, {
    work_order_number: 'WO-8810', part_number: 'REL-1', part_name: 'Release State Fitting',
    status: 'pending',
  });
  await makeWo(tokenB, {
    work_order_number: 'WO-8811', part_number: 'REL-1', part_name: 'Release State Fitting',
    status: 'in_progress',
  });
  await makeWo(tokenB, {
    work_order_number: 'WO-8812', part_number: 'REL-1', part_name: 'Release State Fitting',
    status: 'overdue',
  });
  // More open jobs on one part than a search box may print at once.
  for (let i = 1; i <= CAP_JOBS; i++) {
    await makeWo(tokenB, {
      work_order_number: `WO-89${String(i).padStart(2, '0')}`,
      part_number: 'CAP-1', part_name: CAP_NAME,
    });
  }
  // …and a few on a DIFFERENT part whose name shares a fragment with it. They
  // sort ahead of the fittings, so the capped page visibly holds two parts.
  for (let i = 1; i <= CAP_SIBLING_JOBS; i++) {
    await makeWo(tokenB, {
      work_order_number: `WO-885${i}`,
      part_number: 'CAP-2', part_name: CAP_SIBLING_NAME,
    });
  }

  const operator = await api('POST', '/api/users', {
    token: tokenB,
    body: {
      email: `op-${Date.now()}@secondplant.test`, display_name: 'Otto Operator',
      password: 'SecretPass1', role: 'operator',
    },
  });
  assert.equal(operator.status, 201, `operator: ${JSON.stringify(operator.json)}`);
  const login = await api('POST', '/api/auth/login', {
    body: { email: operator.json.email, password: 'SecretPass1' },
  });
  assert.equal(login.status, 200, `operator login: ${JSON.stringify(login.json)}`);
  opTokenB = login.json.token;
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── A1: "Fastest Today" is a race, not a dead heat ───────────────────────────

test('the wall board names each operator once, and no two best runs share a time', async () => {
  const departments = list((await api('GET', '/api/departments', { token: tokenA })).json);
  const assembly = departments.find(d => d.name === 'Assembly');
  assert.ok(assembly, `the seed builds an Assembly department (got: ${departments.map(d => d.name).join(', ')})`);

  const day = await api('GET', `/api/sqdc/department/${assembly.id}`, { token: tokenA });
  assert.equal(day.status, 200, JSON.stringify(day.json));
  const board = day.json.leaderboard;

  // ── How many rows there can BE is a question about the clock ──────────────
  // The seed lays down as many runs as the plant day has had room for, and the
  // bench of three rotates one run each, so before roughly 00:24 UTC there has
  // not been a third run to rank. sandbox.js:40-58 exists because of exactly
  // this class of bug: the mismatch it fixes "used to exist only between 00:00
  // and 00:48 UTC, which is precisely the window nobody runs the suite in". A
  // test that demanded three rows at 00:10 would fail on correct code, so it
  // asks the same arithmetic the seed asked. Computed two minutes BEHIND the
  // clock, so a shift that ticked over between seeding and this line is never
  // claimed. The distinctness this test is really about is proven at every
  // minute of the day, off the clock entirely, by the last test in this file.
  const runsWhenSeeded = shiftShape(Math.max(0, utcMinutesToday() - 2), IDEAL_CYCLE_S).runs;
  // Two Weld scrap runs are booked into this department today whatever the
  // hour, so there is always at least one operator to rank.
  assert.ok(board.length >= Math.max(1, Math.min(3, runsWhenSeeded)),
    `every operator the seed has given a run today is on the board `
    + `(${runsWhenSeeded} assembly runs so far today, got ${board.length} rows)`);

  const names = board.map(r => r.operator_name);
  assert.equal(new Set(names).size, names.length,
    `one row per operator, not one operator's best five runs: ${names.join(', ')}`);

  const seconds = board.map(r => r.duration_seconds);
  for (const s of seconds) assert.ok(s > 0, `every row carries a measured duration (got ${s})`);
  assert.equal(new Set(seconds).size, seconds.length,
    `a board that says "fastest" has to have a fastest — got ${seconds.join(', ')}`);

  // Ordered fastest first, which is the only reason ranking it means anything.
  assert.deepEqual(seconds, [...seconds].sort((a, b) => a - b), 'ranked fastest first');
});

test('a seeded step time is not decided by who ran it', async () => {
  // This is the defect underneath the board. Step times were `k % 4`, `k % 5`
  // and `k % 3` on the run's position in the shift, and the operator rotated on
  // the same index — so within any one shift Final Inspection took exactly
  // 108 s for one operator, 119 for the next and 130 for the third, every run,
  // every day. That put every operator's best run on one 11-second lattice with
  // the formula's own minimum at the top of it. Three people are not stopwatches.
  //
  // Judged a shift at a time, because a shift is where the rotation and the
  // timers met.
  const runs = (await api('GET', '/api/completions?status=completed&limit=500', { token: tokenA })).json;
  assert.ok(runs.length >= 30, `the seed lays out a real history (got ${runs.length} runs)`);

  const shifts = new Map();
  for (const run of runs) {
    const inspection = run.step_times?.['2'];
    if (inspection == null || !run.completed_at) continue;
    const key = `${String(run.completed_at).slice(0, 10)} · ${run.operator_name}`;
    if (!shifts.has(key)) shifts.set(key, { runs: 0, times: new Set() });
    const seen = shifts.get(key);
    seen.runs++;
    seen.times.add(inspection);
  }

  // A shift too short to have given somebody three units cannot say whether
  // their times vary, so it is not asked.
  const judged = [...shifts].filter(([, seen]) => seen.runs >= 3);
  assert.ok(judged.length >= 3,
    `at least three operator-shifts long enough to judge (got ${judged.length})`);
  for (const [who, seen] of judged) {
    assert.ok(seen.times.size > 1,
      `${who}: Final Inspection must vary run to run, not be a constant of the person `
      + `(all ${seen.runs} runs took ${[...seen.times][0]} s)`);
  }
});

// ─── A2: the search box answers to the name on the screen ─────────────────────

test('a job is found by its part name, and by a fragment of it', async () => {
  const full = await wip(tokenA, 'Standard Bracket');
  assert.equal(full.json.match, 'part_name', JSON.stringify(full.json));
  assert.ok(full.json.results.length >= 2, 'the demo has several jobs on that part');
  for (const row of full.json.results) {
    assert.equal(row.part_name, 'Standard Bracket');
  }
  assert.match(full.json.answer, /work orders are on Standard Bracket$/);

  // A fragment is how a person searches for something they can see.
  const fragment = await wip(tokenA, 'brack');
  assert.equal(fragment.json.match, 'part_name');
  const found = new Set(fragment.json.results.map(r => r.part_name));
  assert.ok(found.has('Standard Bracket') && found.has('Heavy Duty Bracket'),
    `a fragment spans both bracket parts (got: ${[...found].join(', ')})`);
  // …and because it spans two parts, the sentence may not speak for either.
  assert.equal(fragment.json.answer, `${fragment.json.total_matches} work orders match "brack"`);

  // Case does not decide whether a supervisor finds their job.
  const shouty = await wip(tokenA, 'STANDARD BRACKET');
  assert.equal(shouty.json.match, 'part_name');
  assert.equal(shouty.json.total_matches, full.json.total_matches);
});

test('a number still wins over a name, and a tagged number answers to the plain one', async () => {
  const byNumber = await wip(tokenA, 'WO-1001');
  assert.equal(byNumber.json.match, 'work_order', JSON.stringify(byNumber.json));
  assert.equal(byNumber.json.result.work_order_number, 'WO-1001');

  // A part number is a number too, and it is answered before any name.
  const byPart = await wip(tokenA, 'BRKT-100');
  assert.equal(byPart.json.match, 'part_number');

  // 'ZZZ999-WO-8802' is the same job as 'WO-8802' said two ways.
  const tagged = await wip(tokenB, 'WO-8802');
  assert.equal(tagged.json.match, 'work_order', JSON.stringify(tagged.json));
  assert.equal(tagged.json.result.work_order_number, 'ZZZ999-WO-8802');
  assert.equal(tagged.json.result.part_name, 'Tagged Fitting');
});

test('a name search is capped, and the payload says it was capped', async () => {
  const capped = await wip(tokenB, CAP_NAME);
  assert.equal(capped.json.match, 'part_name', JSON.stringify(capped.json));
  assert.equal(capped.json.total_matches, CAP_JOBS, 'the count is all of them');
  assert.ok(capped.json.results.length < CAP_JOBS, 'the page is not all of them');
  assert.equal(capped.json.truncated, true);
  assert.match(capped.json.truncated_note,
    new RegExp(`showing the first ${capped.json.results.length} of ${CAP_JOBS} open jobs`));
  // Nobody may read the page as the whole answer.
  assert.equal(capped.json.answer, `${CAP_JOBS} work orders match "${CAP_NAME}"`);
});

test('a capped name search counts what was asked, not "this part"', async () => {
  // The group total behind a name fragment spans every part the fragment hit.
  // Printing it under the words "open jobs on this part" is the screen saying
  // 30 fittings when 4 of them are flanges — and it is the sentence the box
  // prints, in a case a supervisor reaches by typing one ordinary word.
  const total = CAP_JOBS + CAP_SIBLING_JOBS;
  const capped = await wip(tokenB, CAP_FRAGMENT);
  assert.equal(capped.json.match, 'part_name', JSON.stringify(capped.json));
  assert.equal(capped.json.total_matches, total, 'the count spans both parts');
  assert.equal(capped.json.truncated, true);

  const names = new Set(capped.json.results.map(r => r.part_name));
  assert.ok(names.size > 1, `the page itself holds both parts (got: ${[...names].join(', ')})`);

  assert.equal(capped.json.truncated_note,
    `showing the first ${capped.json.results.length} of ${total} open jobs matching "${CAP_FRAGMENT}"`);
  assert.doesNotMatch(capped.json.truncated_note, /on this part/,
    `${total} jobs across ${names.size} parts were called one part's: ${capped.json.truncated_note}`);
});

test('a capped part-number search may still say "on this part"', async () => {
  // The other half of the same rule: every job in a part-NUMBER group really
  // does carry the one part that was typed, so the note stays specific rather
  // than being softened everywhere to make one case right.
  const capped = await wip(tokenB, 'CAP-1');
  assert.equal(capped.json.match, 'part_number', JSON.stringify(capped.json));
  assert.equal(capped.json.total_matches, CAP_JOBS);
  assert.equal(capped.json.truncated, true);
  assert.equal(capped.json.truncated_note,
    `showing the first ${capped.json.results.length} of ${CAP_JOBS} open jobs on this part`);
});

test('another company\'s job on the same part name is simply not there', async () => {
  const mine = await wip(tokenA, 'Standard Bracket');
  const numbers = mine.json.results.map(r => r.work_order_number);
  assert.ok(!numbers.includes('WO-8801'),
    `the other tenant's job must not come back (got: ${numbers.join(', ')})`);

  const theirs = await wip(tokenB, 'Standard Bracket');
  assert.equal(theirs.json.match, 'part_name');
  assert.deepEqual(theirs.json.results.map(r => r.work_order_number), ['WO-8801'],
    'and B sees its own job, only');

  // A name only the other tenant uses is not "found and hidden" — it is not
  // found, and nothing of theirs is echoed back in the reason.
  const alien = await wip(tokenA, 'Tagged Fitting');
  assert.equal(alien.json.match, 'none', JSON.stringify(alien.json));
  assert.equal(alien.json.results.length, 0);
  assert.doesNotMatch(alien.json.reason, /WO-8802|ZZZ999/);
});

// ─── A3: one definition of the reason-code vocabulary ─────────────────────────

test('the demo reason codes have exactly one definition', () => {
  const andon = require('../src/routes/andon');
  const seedShapes = require('../src/seedShapes');

  assert.equal(typeof andon.seedReasonCodes, 'function',
    'routes/andon.js exports the seeder the API itself runs');
  // IDENTITY, not deep equality: two objects that happen to agree today are
  // exactly what a Pareto and a stop reason drift out of.
  assert.strictEqual(seedShapes.REASON_DEFAULTS, andon.REASON_DEFAULTS,
    'seedShapes must re-export the router\'s list, not carry a copy of it');
  assert.strictEqual(seedShapes.seedReasonCodes, andon.seedReasonCodes);

  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'seedShapes.js'), 'utf8');
  assert.doesNotMatch(source, /const REASON_DEFAULTS\s*=\s*(Object\.freeze\()?\{/,
    'seedShapes.js must not define a second reason-code list');
});

test('a company seeded by the demo and a company seeded by its first read get the same list', async () => {
  const shape = rows => rows
    .map(r => `${r.kind}|${r.code}|${r.label}|${r.loss_bucket}`)
    .sort();

  const demo = await api('GET', '/api/andon/reason-codes', { token: tokenA });
  const fresh = await api('GET', '/api/andon/reason-codes', { token: tokenB });
  assert.equal(demo.status, 200);
  assert.equal(fresh.status, 200);
  assert.ok(demo.json.length > 0, 'the sandbox seeds the coded reasons');
  assert.deepEqual(shape(demo.json), shape(fresh.json),
    'the seed path and the API path write one vocabulary');
});

// ─── A4: a role reaches a person by the name a screen prints ──────────────────

test('the permission message names the role the way the users grid does', async () => {
  const { displayRole } = require('../src/roles');

  const refused = await api('POST', '/api/andon/reason-codes', {
    token: opTokenB,
    body: { kind: 'scrap', code: 'nope', label: 'Should not be created' },
  });
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.equal(refused.json.code, 'FORBIDDEN');
  assert.equal(refused.json.error, `Requires the ${displayRole('manager')} role or higher`);
  // The stored token is a permission level, not a job title. It may not be the
  // word a person is asked to go and find.
  assert.doesNotMatch(refused.json.error, /\bmanager\b/,
    `the stored role token reached a person: ${refused.json.error}`);
});

// ─── A5: no status enum inside a sentence ─────────────────────────────────────

test('a job with no operation to stand on says so in English, whatever state it is in', async () => {
  const cases = [
    ['WO-8810', 'pending',     'WO-8810 has not been released yet, so it is not on the floor'],
    ['WO-8811', 'in_progress', 'WO-8811 is running, but nobody released its operations — there is no step to point at'],
    ['WO-8812', 'overdue',     'WO-8812 is past its due date and was never released to the floor'],
  ];

  for (const [number, status, sentence] of cases) {
    const res = await wip(tokenB, number);
    assert.equal(res.json.match, 'work_order', JSON.stringify(res.json));
    assert.equal(res.json.answer, sentence, `the sentence for a ${status} job`);
    // The token still rides on the payload — a machine field a screen can chip
    // or colour — it just never lands in the words.
    assert.equal(res.json.result.work_order_status, status);
    assert.doesNotMatch(res.json.answer, /\b(pending|in_progress|overdue|completed|cancelled)\b/,
      `a status token reached a reader: ${res.json.answer}`);
    assert.equal(res.json.result.operation_count, 0, 'no operations is a count, not a guess');
  }
});

// ─── A1, off the clock: the race is a race at every minute of the day ─────────

test('no two operators can share a best run, at any minute of the plant day', () => {
  // The live board above is one sample: whatever the wall shows at the minute
  // this suite runs. The claim the seed actually has to keep is stronger — the
  // board is a race EVERY hour the demo is open — and it cannot be sampled,
  // because both halves of it move with the clock:
  //
  //   · the seeded assembly shift grows a run at a time (shiftShape), so which
  //     of the bench's runs are on the board depends on the hour;
  //   · the two Weld scrap runs are booked into the SAME department today and
  //     are compressed to fit inside a young plant day (layOutAgo), so early in
  //     the morning they are the shortest completions in the department and one
  //     of them becomes an operator's best run.
  //
  // The wall board ranks the sum of a run's step timers (runSecondsSQL prefers
  // hands-on time over wall clock), so that sum is what is compared here.
  //
  // The Weld batches are booked to Maria Lopez today (see the seedWeldScrapRuns
  // call in sandbox.js). This checks them against every seat on the bench
  // instead, so a later edit that hands them to somebody else cannot quietly
  // reintroduce the dead heat.
  const bench = BENCH_PACE_S.length;
  assert.ok(bench >= 2, 'a race needs at least two people');

  for (let minutesToday = 0; minutesToday <= 1440; minutesToday++) {
    const runs = shiftShape(minutesToday, IDEAL_CYCLE_S).runs;
    const shiftBest = new Map();
    for (let k = 0; k < runs; k++) {
      const seconds = seededStepTimes(k).reduce((a, b) => a + b, 0);
      const seat = k % bench;
      if (!shiftBest.has(seat) || seconds < shiftBest.get(seat)) shiftBest.set(seat, seconds);
    }

    const scrapSeconds = weldScrapRunSeconds(minutesToday);
    for (const s of scrapSeconds) {
      assert.ok(s > 0, `${minutesToday} min in: a scrap run must have a measured duration (got ${s})`);
    }

    for (let booker = 0; booker < bench; booker++) {
      const best = new Map(shiftBest);
      for (const seconds of scrapSeconds) {
        if (!best.has(booker) || seconds < best.get(booker)) best.set(booker, seconds);
      }
      const board = [...best.values()];
      assert.equal(new Set(board).size, board.length,
        `${minutesToday} minutes into the day, with the Weld batches on seat ${booker}: `
        + `a board that says "fastest" has to have a fastest — got ${board.join(', ')} s `
        + `from ${runs} assembly runs and scrap runs of ${scrapSeconds.join(', ')} s`);
    }
  }
});
