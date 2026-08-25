'use strict';
// ─── Numbered-id sequence tests ───────────────────────────────────────────────
// Every human id (CAPA-2026-001, KZN-2026-001, WO-…, NCR-…, PO-…, MWO-…) is
// minted by a next*Number helper that finds the current max and adds one. Those
// helpers used to pick the max with `ORDER BY <col> DESC LIMIT 1` on a TEXT
// column — a LEXICAL sort. Once a sequence passes 999 the string "…-1000" sorts
// BEFORE "…-999" (because '1' < '9'), so the helper reads "…-999" as the max,
// hands back "…-1000" a second time (a collision) and never climbs past 1000.
//
// These tests seed a fresh company's sequence right up to the 999→1000 cliff,
// then mint two more ids through the REAL POST routes and assert they climb
// numerically (…-1000, then …-1001) instead of colliding. Seeding copies a real
// row — so every NOT NULL column is satisfied without hard-coding the schema —
// varying only the id and the number, through a second better-sqlite3 handle on
// the same WAL database the server is using.
//
// Node built-ins + better-sqlite3 only. Run with: npm test

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const PORT = 3232;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-numbering-${Date.now()}.db`);

let server, db2, token;

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

before(async () => {
  await startServer();
  const signup = await api('POST', '/api/auth/signup', {
    body: {
      company_name: 'Numbering Co', email: 'admin@numbering.test',
      password: 'SecretPass1', display_name: 'Admin',
    },
  });
  assert.equal(signup.status, 201, `signup failed: ${JSON.stringify(signup.json)}`);
  token = signup.json.token;

  // A second handle on the same WAL database, used only to bulk-seed the
  // sequence. WAL lets this writer and the server's connection share the file;
  // the test never has both writing at the same instant.
  db2 = new Database(DB_PATH);
  db2.pragma('foreign_keys = ON');
});

after(() => {
  if (db2) { try { db2.close(); } catch { /* ignore */ } }
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

// The trailing sequence is always zero-padded to at least three digits, exactly
// as the next*Number helpers format it (String(seq).padStart(3, '0')).
const pad = (seq) => String(seq).padStart(3, '0');

// "CAPA-2026-001" → "CAPA-2026-" (everything up to and including the last dash).
const prefixOf = (number) => number.slice(0, number.lastIndexOf('-') + 1);

// Copy `base` into rows numbered `from`..`to` (inclusive), keeping every other
// column (company_id included) and setting each numberCol to the padded id.
function seedRange(table, base, numberCols, prefix, from, to) {
  const cols = Object.keys(base);
  const insert = db2.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`
  );
  const run = db2.transaction((lo, hi) => {
    for (let seq = lo; seq <= hi; seq++) {
      const row = { ...base, id: randomUUID() };
      for (const nc of numberCols) row[nc] = `${prefix}${pad(seq)}`;
      insert.run(row);
    }
  });
  run(from, to);
}

async function runScenario({ label, createPath, createBody, table, numberCols, readNumber }) {
  // 1. Mint the first id through the real route: gives a fully-populated
  //    template row plus the actual prefix for this year and company.
  const first = await api('POST', createPath, { token, body: createBody });
  assert.equal(first.status, 201, `${label}: create #1 failed: ${JSON.stringify(first.json)}`);
  const firstNumber = readNumber(first.json);
  const prefix = prefixOf(firstNumber);
  assert.equal(firstNumber, `${prefix}001`, `${label}: first id should be …-001, got ${firstNumber}`);

  const base = db2.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(first.json.id);
  assert.ok(base, `${label}: could not read the template row back`);

  // 2. Fill 002..999 by copying the template, so the row set straddles the
  //    lexical cliff the moment …-1000 lands.
  seedRange(table, base, numberCols, prefix, 2, 999);
  const seeded = db2.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND ${numberCols[0]} LIKE ?`
  ).get(base.company_id, prefix + '%').n;
  assert.equal(seeded, 999, `${label}: expected 999 seeded rows, got ${seeded}`);

  // 3. With 001..999 present the next id is …-1000. (Old and new code agree
  //    here — this is the "1000 follows 999" step, and it lands the 1000th row.)
  const n1000 = await api('POST', createPath, { token, body: createBody });
  assert.equal(n1000.status, 201, `${label}: create at 1000 failed: ${JSON.stringify(n1000.json)}`);
  assert.equal(readNumber(n1000.json), `${prefix}1000`,
    `${label}: expected ${prefix}1000, got ${readNumber(n1000.json)}`);

  // 4. Now 001..1000 are present (>1000 rows total). A lexical DESC picks
  //    "…-999" and re-mints …-1000 — a collision. The numeric max climbs to
  //    …-1001. This is the assertion the old, lexical code fails.
  const n1001 = await api('POST', createPath, { token, body: createBody });
  assert.equal(n1001.status, 201, `${label}: create at 1001 failed: ${JSON.stringify(n1001.json)}`);
  assert.equal(readNumber(n1001.json), `${prefix}1001`,
    `${label}: id must climb numerically past 1000, got ${readNumber(n1001.json)}`);

  // 5. …-1001 must be the only row wearing that number — a collision would
  //    leave two, and it must stay scoped to this company.
  const dupes = db2.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ? AND ${numberCols[0]} = ?`
  ).get(base.company_id, `${prefix}1001`).n;
  assert.equal(dupes, 1, `${label}: ${prefix}1001 should exist exactly once, found ${dupes}`);
}

describe('next*Number sequences climb numerically past 999', () => {
  it('CAPA numbers reach …-1000 then …-1001 without colliding', async () => {
    await runScenario({
      label: 'CAPA',
      createPath: '/api/capa',
      createBody: { title: 'Sequence probe' },
      table: 'capa_items',
      numberCols: ['number'],
      readNumber: (r) => r.number,
    });
  });

  it('Kaizen idea numbers reach …-1000 then …-1001 without colliding', async () => {
    await runScenario({
      label: 'Kaizen',
      createPath: '/api/kaizen',
      createBody: { title: 'Sequence probe', category: 'cost' },
      table: 'kaizen_ideas',
      numberCols: ['idea_number', 'number'],
      readNumber: (r) => r.idea_number ?? r.number,
    });
  });
});
