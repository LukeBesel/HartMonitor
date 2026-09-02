'use strict';
// ─── Every count on screen matches the thing it counts ────────────────────────
// Three small lies that cost trust, each pinned by one thing this test file
// actually creates and reads back:
//
//   1. GET /api/sites counted `departments WHERE site_id = s.id` — a
//      department made before anyone touched Sites (site_id NULL) vanished
//      from the primary site's own count. It now counts the same way GET
//      /departments and the analytics site scope already do: assigned to
//      this site, OR not assigned to any site.
//   2. Training coverage divided by `operators * published apps` and printed
//      0% the moment either was zero — "0% coverage" when nothing was ever
//      required of anyone. It is now null with a reason.
//   3. App analytics fell back to the raw widget id as a field's label and to
//      whatever storage bucket a value landed in as its type, when a captured
//      widget no longer matched anything in the app's steps blob. It now
//      humanises the variable name the value was captured under, and only
//      gives up (and says so) when there is truly nothing to go on.
//
// Uses Node built-ins only (node:test + global fetch). Run with:
//   node --test backend/test/credibility-numbers.test.js
// Reserved port for this workstream: 3404.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3404; // reserved for honest-numbers-one-formatter — do not reuse
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-credibility-numbers-${Date.now()}.db`);

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

before(async () => { await startServer(); });
after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ }
  }
});

describe('a site counts what it actually holds', () => {
  let token;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Predates Sites Co', email: 'admin@predates.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    // Departments created with no site_id at all — exactly what a company
    // that never touched Sites looks like. The primary site ("Main Site" /
    // MAIN) is auto-created at signup.
    for (const name of ['Welding', 'Assembly']) {
      const dept = await api('POST', '/api/departments', { token, body: { name } });
      assert.equal(dept.status, 201, `department "${name}": ${JSON.stringify(dept.json)}`);
      assert.equal(dept.json.site_id, null, 'a department made with no site_id must stay unassigned, not silently attached');
    }
  });

  it('counts unassigned departments under the primary site instead of losing them', async () => {
    const sites = await api('GET', '/api/sites', { token });
    assert.equal(sites.status, 200, JSON.stringify(sites.json));
    const main = sites.json.find(s => s.code === 'MAIN');
    assert.ok(main, 'the auto-created primary site is missing from GET /api/sites');
    assert.equal(main.department_count, 2, `MAIN should count both unassigned departments, got ${JSON.stringify(main)}`);
    assert.ok(main.counts_basis, 'the card should say what it counted, not just a bare number');
  });

  it('gives a brand-new site the same honest count on creation', async () => {
    const created = await api('POST', '/api/sites', { token, body: { name: 'Satellite', code: 'SAT' } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    // The two unassigned departments belong to the whole company, so a
    // second site inherits them too — its count must not lie by starting at
    // zero when GET / would immediately show 2 for the same site.
    assert.equal(created.json.department_count, 2, `new site's own create response undercounted: ${JSON.stringify(created.json)}`);
  });
});

describe('training coverage says "nothing required" instead of "0%"', () => {
  it('reports coverage_pct null with a reason for a fresh company', async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Nothing Required Co', email: 'admin@nothingreq.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    const token = signup.json.token;

    // A fresh signup: the founder's own 'developer' user isn't an
    // operator/supervisor, and no app has been published yet — total_possible
    // (operators * published apps) is genuinely zero.
    const summary = await api('GET', '/api/training/summary', { token });
    assert.equal(summary.status, 200, JSON.stringify(summary.json));
    assert.equal(summary.json.total_possible, 0, `expected nothing required yet, got ${JSON.stringify(summary.json)}`);
    assert.equal(summary.json.coverage_pct, null, `0 possible must read as null, not a fabricated 0%: ${JSON.stringify(summary.json)}`);
    assert.ok(
      typeof summary.json.empty_reason === 'string' && summary.json.empty_reason.length > 0,
      `empty_reason must be a non-empty string, got ${JSON.stringify(summary.json.empty_reason)}`,
    );
  });
});

describe('an unnamed field never guesses a label or a type', () => {
  let token, appId, completionId;

  before(async () => {
    const signup = await api('POST', '/api/auth/signup', {
      body: { company_name: 'Ghost Widget Co', email: 'admin@ghostwidget.test', password: 'SecretPass1', display_name: 'Admin' },
    });
    assert.equal(signup.status, 201, `signup: ${JSON.stringify(signup.json)}`);
    token = signup.json.token;

    const app = await api('POST', '/api/apps', { token, body: { name: 'Bracket Line' } });
    assert.equal(app.status, 201, JSON.stringify(app.json));
    appId = app.json.id;

    const created = await api('POST', '/api/completions', { token, body: { app_id: appId, operator_name: 'Ada' } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    completionId = created.json.id;

    // The app's steps blob never mentions this widget_id — it stands in for a
    // widget deleted (or renamed away) since the run that captured it, the
    // one case `meta()`'s fallback exists for. A real photo-capture widget's
    // player would record it with a variableName and value_type = 'photo'.
    const finished = await api('PUT', `/api/completions/${completionId}`, {
      token,
      body: {
        status: 'completed',
        data: {},
        values: [
          { widget_id: 'ghost-widget-1', variable_name: '_part_number', value_type: 'photo', value_text: 'photo://part.jpg' },
          // No variable_name at all: nothing to humanise, nothing to guess.
          { widget_id: 'ghost-widget-2', variable_name: '', value_type: 'photo', value_text: 'photo://mystery.jpg' },
        ],
      },
    });
    assert.equal(finished.status, 200, JSON.stringify(finished.json));
  });

  it('humanises a captured variableName into the label, and keeps the real captured type', async () => {
    const analytics = await api('GET', `/api/apps/${appId}/analytics`, { token });
    assert.equal(analytics.status, 200, JSON.stringify(analytics.json));
    const field = analytics.json.fields.find(f => f.widget_id === 'ghost-widget-1');
    assert.ok(field, `ghost-widget-1 missing from fields: ${JSON.stringify(analytics.json.fields)}`);
    assert.equal(field.label, 'Part number', `expected humanised label, got ${JSON.stringify(field)}`);
    assert.equal(field.type, 'photo', `expected the real captured type, not a guess: ${JSON.stringify(field)}`);
  });

  it('says "Unnamed field" / "unknown" rather than inventing a label or a type', async () => {
    const analytics = await api('GET', `/api/apps/${appId}/analytics`, { token });
    const field = analytics.json.fields.find(f => f.widget_id === 'ghost-widget-2');
    assert.ok(field, `ghost-widget-2 missing from fields: ${JSON.stringify(analytics.json.fields)}`);
    assert.equal(field.label, 'Unnamed field', `expected the honest fallback label, got ${JSON.stringify(field)}`);
    assert.equal(field.type, 'unknown', `expected the honest fallback type, got ${JSON.stringify(field)}`);
  });
});
