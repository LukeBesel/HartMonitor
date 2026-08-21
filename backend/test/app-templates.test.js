// ─── App templates tests ──────────────────────────────────────────────────────
// Spawns the real server against a throwaway database and exercises:
//   • GET  /api/apps/templates      — built-in model templates always listed
//                                     (with step_count) plus company-owned ones,
//   • POST /api/apps/:id/save-as-template → list → POST /api/apps/from-template
//     → DELETE /api/apps/templates/:id full lifecycle,
//   • id regeneration on from-template (no step/widget/group id shared with the
//     source; go_to_step + group_id references remapped),
//   • tenant isolation in both directions,
//   • the supervisor write gate (operator gets 403 on save-as-template).
// Run with: npm test — uses only Node built-ins (node:test + global fetch).

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3187; // unique per test file — 3191-3199 are taken by the other suites
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-app-templates-test-${Date.now()}.db`);

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

let tokenA;        // Widget Co (owner/developer)
let tokenB;        // Gadget Co (owner/developer)
let operatorToken; // operator inside Widget Co
let sourceAppId;   // Widget Co app the template is snapshotted from
let sourceSteps;   // the blob saved into the source app

// A v2-ish blob with a step group, widget/step triggers and a go_to_step —
// everything the id-regeneration pass has to remap.
function makeSourceBlob() {
  const steps = [
    {
      id: 'src-step-1', name: 'Prep', order: 0, group_id: 'src-grp-1',
      triggers: [{ id: 'src-trg-s1', event: 'step_exit', match: 'all', conditions: [], actions: [{ type: 'show_message', text: 'On to assembly' }] }],
      widgets: [
        { id: 'src-w-11', type: 'instruction', order: 0, label: 'Read Me', config: { content: 'Prep the fixture.' } },
        { id: 'src-w-12', type: 'checkbox', order: 1, label: 'Fixture Ready', config: { required: true, variableName: 'fixture_ready' } },
        {
          id: 'src-w-13', type: 'button', order: 2, label: '', config: { buttonText: 'Skip to QC' },
          triggers: [{
            id: 'src-trg-w13', event: 'button_press', match: 'all', conditions: [],
            actions: [{ type: 'go_to_step', stepId: 'src-step-2' }],
          }],
        },
      ],
    },
    {
      id: 'src-step-2', name: 'QC', order: 1, group_id: 'src-grp-1',
      widgets: [
        { id: 'src-w-21', type: 'pass-fail', order: 0, label: 'Looks Good', config: { variableName: 'looks_good' } },
      ],
    },
  ];
  const step_groups = [{ id: 'src-grp-1', name: 'Main Flow', order: 0 }];
  const variables = [{ id: 'src-v-1', name: 'fixture_ready', type: 'boolean' }];
  return { steps, step_groups, variables };
}

// Collect every id that appears anywhere in a steps/groups blob.
function collectIds(steps, stepGroups = []) {
  const ids = new Set();
  for (const g of stepGroups) ids.add(g.id);
  for (const s of steps) {
    ids.add(s.id);
    for (const t of s.triggers || []) if (t.id) ids.add(t.id);
    for (const w of s.widgets || []) {
      ids.add(w.id);
      for (const t of w.triggers || []) if (t.id) ids.add(t.id);
    }
  }
  return ids;
}

before(async () => {
  await startServer();

  const a = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Widget Co', email: 'owner@widget-tpl.test', password: 'supersecret1', display_name: 'Widget Owner' },
  });
  assert.equal(a.status, 201);
  tokenA = a.json.token;

  const b = await api('POST', '/api/auth/signup', {
    body: { company_name: 'Gadget Co', email: 'owner@gadget-tpl.test', password: 'supersecret1', display_name: 'Gadget Owner' },
  });
  assert.equal(b.status, 201);
  tokenB = b.json.token;

  // An operator in company A — below the supervisor write gate on /api/apps.
  const op = await api('POST', '/api/users', {
    token: tokenA,
    body: { email: 'op@widget-tpl.test', display_name: 'Line Op', password: 'supersecret1', role: 'operator' },
  });
  assert.equal(op.status, 201);
  const opLogin = await api('POST', '/api/auth/login', {
    body: { email: 'op@widget-tpl.test', password: 'supersecret1' },
  });
  assert.equal(opLogin.status, 200);
  operatorToken = opLogin.json.token;

  // Source app with a rich blob.
  const app = await api('POST', '/api/apps', { token: tokenA, body: { name: 'Source App', description: 'The original' } });
  assert.equal(app.status, 201);
  sourceAppId = app.json.id;
  const blob = makeSourceBlob();
  sourceSteps = blob.steps;
  const put = await api('PUT', `/api/apps/${sourceAppId}`, {
    token: tokenA,
    body: { steps: blob.steps, step_groups: blob.step_groups, variables: blob.variables, schema_version: 2 },
  });
  assert.equal(put.status, 200);
});

after(() => {
  if (server) server.kill('SIGTERM');
  for (const ext of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* ignore */ } }
});

// ─── Built-in model templates ─────────────────────────────────────────────────

test('built-in model templates are always listed with step_count', async () => {
  const res = await api('GET', '/api/apps/templates', { token: tokenA });
  assert.equal(res.status, 200, 'GET /templates is not shadowed by /:id');
  assert.ok(Array.isArray(res.json.built_in));
  assert.ok(Array.isArray(res.json.mine));
  assert.equal(res.json.mine.length, 0, 'nothing saved yet');

  const bracket = res.json.built_in.find(t => t.key === 'bracket-assembly');
  assert.ok(bracket, 'Bracket Assembly built-in exists');
  assert.equal(bracket.name, 'Bracket Assembly');
  assert.equal(bracket.step_count, 3);
  assert.ok(bracket.description.length > 0);

  const qc = res.json.built_in.find(t => t.key === 'quality-inspection');
  assert.ok(qc, 'Quality Inspection built-in exists');
  assert.ok(qc.step_count >= 1);
});

test('from-template with a built-in key creates a draft with fresh ids each time', async () => {
  const first = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { built_in_key: 'bracket-assembly', name: 'Bracket Line 1' },
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.status, 'draft');
  assert.equal(first.json.name, 'Bracket Line 1');
  assert.equal(first.json.steps.length, 3);
  assert.ok(first.json.variables.length > 0, 'template variables copied');

  const second = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { built_in_key: 'bracket-assembly', name: 'Bracket Line 2' },
  });
  assert.equal(second.status, 201);

  const idsFirst = collectIds(first.json.steps, first.json.step_groups);
  const idsSecond = collectIds(second.json.steps, second.json.step_groups);
  for (const id of idsFirst) assert.ok(!idsSecond.has(id), `id ${id} not shared between instantiations`);

  const unknown = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { built_in_key: 'does-not-exist', name: 'Nope' },
  });
  assert.equal(unknown.status, 404);

  const noName = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { built_in_key: 'bracket-assembly' },
  });
  assert.equal(noName.status, 400);

  const bothSources = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { built_in_key: 'bracket-assembly', template_id: 'x', name: 'Ambiguous' },
  });
  assert.equal(bothSources.status, 400);
});

// ─── Save → list → create-from → delete lifecycle ─────────────────────────────

let templateId;

test('save-as-template snapshots the app and lists it under mine', async () => {
  const saved = await api('POST', `/api/apps/${sourceAppId}/save-as-template`, {
    token: tokenA, body: { name: 'Standard Two-Stepper', description: 'Prep then QC' },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.json.name, 'Standard Two-Stepper');
  assert.equal(saved.json.description, 'Prep then QC');
  assert.equal(saved.json.step_count, 2);
  assert.ok(saved.json.id && saved.json.created_at);
  templateId = saved.json.id;

  const list = await api('GET', '/api/apps/templates', { token: tokenA });
  assert.equal(list.status, 200);
  const mine = list.json.mine.find(t => t.id === templateId);
  assert.ok(mine, 'saved template appears in mine');
  assert.equal(mine.step_count, 2);
  assert.equal(mine.name, 'Standard Two-Stepper');
});

test('from-template instantiates the snapshot with regenerated, remapped ids', async () => {
  const created = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { template_id: templateId, name: 'Cloned Line' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, 'draft');
  assert.equal(created.json.name, 'Cloned Line');
  assert.equal(created.json.description, 'Prep then QC', 'template description carried over');

  const steps = created.json.steps;
  assert.equal(steps.length, 2, 'structure preserved');
  assert.equal(steps[0].name, 'Prep');
  assert.equal(steps[0].widgets.length, 3);
  assert.equal(steps[1].widgets[0].label, 'Looks Good');

  // No id from the source blob survives.
  const srcIds = collectIds(sourceSteps, [{ id: 'src-grp-1', name: 'Main Flow', order: 0 }]);
  const newIds = collectIds(steps, created.json.step_groups);
  for (const id of newIds) assert.ok(!srcIds.has(id), `id ${id} regenerated`);

  // go_to_step retargeted onto the NEW second step.
  const button = steps[0].widgets.find(w => w.type === 'button');
  const goTo = button.triggers[0].actions.find(a => a.type === 'go_to_step');
  assert.equal(goTo.stepId, steps[1].id, 'go_to_step remapped to the copied step');

  // group ids regenerated and step.group_id remapped consistently.
  assert.equal(created.json.step_groups.length, 1);
  const newGroupId = created.json.step_groups[0].id;
  assert.notEqual(newGroupId, 'src-grp-1');
  assert.equal(steps[0].group_id, newGroupId);
  assert.equal(steps[1].group_id, newGroupId);

  // The created draft is a real, editable app.
  const fetched = await api('GET', `/api/apps/${created.json.id}`, { token: tokenA });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.json.steps.length, 2);
});

test('deleting a template removes it from the list; the deleted id is gone for from-template', async () => {
  const del = await api('DELETE', `/api/apps/templates/${templateId}`, { token: tokenA });
  assert.equal(del.status, 200);

  const list = await api('GET', '/api/apps/templates', { token: tokenA });
  assert.ok(!list.json.mine.some(t => t.id === templateId), 'deleted template no longer listed');

  const create = await api('POST', '/api/apps/from-template', {
    token: tokenA, body: { template_id: templateId, name: 'Ghost' },
  });
  assert.equal(create.status, 404);

  const again = await api('DELETE', `/api/apps/templates/${templateId}`, { token: tokenA });
  assert.equal(again.status, 404, 'double delete is a 404');
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

test('templates never cross tenants in either direction', async () => {
  // A saves a template; B saves its own.
  const savedA = await api('POST', `/api/apps/${sourceAppId}/save-as-template`, {
    token: tokenA, body: { name: 'A-Only Template' },
  });
  assert.equal(savedA.status, 201);
  const aTemplateId = savedA.json.id;

  const bApp = await api('POST', '/api/apps', { token: tokenB, body: { name: 'B App' } });
  assert.equal(bApp.status, 201);
  const savedB = await api('POST', `/api/apps/${bApp.json.id}/save-as-template`, {
    token: tokenB, body: { name: 'B-Only Template' },
  });
  assert.equal(savedB.status, 201);
  const bTemplateId = savedB.json.id;

  // Lists are scoped (built-ins visible to everyone).
  const listA = await api('GET', '/api/apps/templates', { token: tokenA });
  const listB = await api('GET', '/api/apps/templates', { token: tokenB });
  assert.ok(listA.json.mine.some(t => t.id === aTemplateId));
  assert.ok(!listA.json.mine.some(t => t.id === bTemplateId), "A never sees B's template");
  assert.ok(listB.json.mine.some(t => t.id === bTemplateId));
  assert.ok(!listB.json.mine.some(t => t.id === aTemplateId), "B never sees A's template");
  assert.ok(listB.json.built_in.some(t => t.key === 'bracket-assembly'), 'built-ins listed for every tenant');

  // from-template across tenants → 404 both ways.
  assert.equal((await api('POST', '/api/apps/from-template', { token: tokenB, body: { template_id: aTemplateId, name: 'Steal A' } })).status, 404);
  assert.equal((await api('POST', '/api/apps/from-template', { token: tokenA, body: { template_id: bTemplateId, name: 'Steal B' } })).status, 404);

  // Cross-tenant delete → 404 and the row survives.
  assert.equal((await api('DELETE', `/api/apps/templates/${aTemplateId}`, { token: tokenB })).status, 404);
  assert.equal((await api('DELETE', `/api/apps/templates/${bTemplateId}`, { token: tokenA })).status, 404);
  const stillA = await api('GET', '/api/apps/templates', { token: tokenA });
  assert.ok(stillA.json.mine.some(t => t.id === aTemplateId), "A's template survived B's delete attempt");

  // save-as-template against a foreign app id → 404.
  assert.equal((await api('POST', `/api/apps/${sourceAppId}/save-as-template`, { token: tokenB, body: {} })).status, 404);
});

// ─── Role gate ────────────────────────────────────────────────────────────────

test('operators cannot save templates (403) but can read the list', async () => {
  const denied = await api('POST', `/api/apps/${sourceAppId}/save-as-template`, {
    token: operatorToken, body: { name: 'Sneaky' },
  });
  assert.equal(denied.status, 403);

  const list = await api('GET', '/api/apps/templates', { token: operatorToken });
  assert.equal(list.status, 200, 'reads stay open to authenticated members');
  assert.ok(list.json.built_in.length >= 2);
});
