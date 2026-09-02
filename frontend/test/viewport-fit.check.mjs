// ─── Viewport fit check ───────────────────────────────────────────────────────
//
// A page must never scroll horizontally. Wide content — tab rows, tables, chart
// axes, filter bars, button groups — scrolls inside its own container. When it
// does not, the whole layout slides sideways under the thumb and the app reads
// as if it were zoomed in, which is the complaint this check exists to catch.
//
// It drives a real Chromium over the production build, at a phone (390x844) and
// a tablet (834x1112), in both themes, signed in as both a fresh company and the
// seeded demo sandbox, and asserts on every route that
//
//   document.documentElement.scrollWidth <= document.documentElement.clientWidth
//
// The app shell clips the document (`flex h-screen overflow-hidden`) and puts
// each page inside `main.overflow-auto`, so a page too wide for the screen
// scrolls <main> rather than the document. The same assertion is therefore made
// against <main>, otherwise every signed-in route would pass while sliding.
//
// This is deliberately NOT part of `npm test --workspace=backend` (it needs a
// browser and takes minutes) and NOT named `*.test.*` so the frontend's vitest
// run does not try to load it. Run it on demand:
//
//   npm run test:fit
//
// which builds the frontend and then runs this file. To run it against a build
// you already have, `node frontend/test/viewport-fit.check.mjs`.
//
// Environment:
//   PLAYWRIGHT_BROWSERS_PATH  where the Chromium download lives
//   FIT_ACCOUNTS              default "demo,fresh" — comma separated
//   FIT_THEMES                default "light,dark"
//   FIT_PORT                  default 3302 (3301 and 3171-3258 are spoken for)

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const DIST = path.join(REPO, 'frontend', 'dist');

const PORT = Number(process.env.FIT_PORT || 3302);
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(os.tmpdir(), `mes-viewport-fit-${Date.now()}.db`);

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '834x1112', width: 834, height: 1112 },
];
const THEMES = (process.env.FIT_THEMES || 'light,dark').split(',');
const ACCOUNTS = (process.env.FIT_ACCOUNTS || 'demo,fresh').split(',');

// Every route the app serves. `:app`, `:dept` and `:station` are filled in from
// whatever the signed-in company actually has; a company with none of a thing
// still exercises the route's empty state, which is the layout a new customer
// sees first.
const ROUTES = [
  ['Landing', '/'],
  ['Pricing', '/pricing'],
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Login', '/login'],
  ['ForgotPassword', '/forgot-password'],
  ['Command Center', '/dashboard'],
  ['Apps Library', '/apps'],
  ['App Detail', '/apps/:app'],
  ['App Detail — Runs', '/apps/:app?tab=runs'],
  ['App Detail — Who ran it', '/apps/:app?tab=who'],
  ['App Detail — Steps', '/apps/:app?tab=steps'],
  ['App Builder', '/apps/:app/build'],
  ['Tables', '/tables'],
  ['App comparison', '/analytics'],
  ['Analytics — OEE', '/analytics?tab=oee'],
  ['Stations', '/stations'],
  ['Station View', '/stations/:station'],
  ['Schedule', '/schedule'],
  ['Routings', '/routings'],
  ['Department View', '/departments/:dept'],
  ['Department TV', '/departments/:dept/tv'],
  ['Capacity Planning', '/capacity'],
  ['Dashboards', '/dashboards'],
  ['Production Reports', '/reports/production'],
  ['Quality Reports', '/reports/quality'],
  ['Inventory', '/inventory'],
  ['BOMs', '/inventory/boms'],
  ['Kitting', '/inventory/kitting'],
  ['Receiving Portal', '/receiving'],
  ['Materials Required', '/requirements'],
  ['Shipment Tracker', '/shipments'],
  ['Purchasing', '/purchasing'],
  ['Quality', '/quality'],
  ['CAPA', '/capa'],
  ['Training', '/training'],
  ['Training — Skills Matrix', '/training/matrix'],
  ['Leaderboard', '/leaderboard'],
  ['Leaderboard TV', '/leaderboard?tv=1'],
  ['Facilities', '/facilities'],
  ['Audit Log', '/audit-log'],
  ['Settings', '/settings'],
  ['Andon', '/andon'],
  ['Maintenance', '/maintenance'],
  ['Maintenance — PM Schedules', '/maintenance/pm_schedules'],
  ['Maintenance — Assets', '/maintenance/assets'],
  ['Shift Notes', '/shift-notes'],
  ['Kaizen', '/kaizen'],
  ['CI Projects', '/ci-projects'],
  ['Admin', '/admin'],
  ['Operator Portal', '/operator'],
  ['App Player', '/play/:app'],
  ['Not Found', '/nope-this-route-does-not-exist'],
];

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch { /* not a project dependency — fall through to a global install */ }
  const require_ = createRequire(import.meta.url);
  for (const root of [process.env.NODE_PATH, '/opt/node22/lib/node_modules', '/usr/lib/node_modules', '/usr/local/lib/node_modules']) {
    if (!root) continue;
    const entry = path.join(root, 'playwright', 'index.mjs');
    if (fs.existsSync(entry)) return (await import(entry)).chromium;
    void require_;
  }
  throw new Error(
    'Playwright is not installed. This check drives a real browser — install it ' +
    '(npm i -D playwright && npx playwright install chromium) or point NODE_PATH at a global install.'
  );
}

let server;
let serverDied = '';
let browser;
/** name -> [{ combo, doc, main }] */
const measured = new Map();

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('node', [path.join(REPO, 'backend', 'src', 'index.js')], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(PORT),
        DATABASE_PATH: DB_PATH,
        SEED_DEMO_DATA: 'false',
        EARLY_ACCESS: 'false',
        BACKUP_DIR: '',
        JWT_SECRET: 'viewport-fit-check',
      },
      // stdout is discarded rather than piped: the server logs every request,
      // and a pipe nobody drains fills after 64KB and blocks the writer — which
      // over a crawl of hundreds of pages takes the server down mid-run.
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    server.stderr.on('data', d => { stderr += d; });
    server.on('error', reject);
    server.on('exit', (code, signal) => {
      serverDied = `the backend under test exited (code ${code}, signal ${signal})`
        + (stderr.trim() ? `: ${stderr.trim().slice(-500)}` : '');
    });
    const deadline = Date.now() + 20000;
    (async function poll() {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) return resolve();
      } catch { /* not up yet */ }
      if (Date.now() > deadline) return reject(new Error(`server did not start on ${PORT}`));
      setTimeout(poll, 250);
    })();
  });
}

// This box is shared with other checkouts, and more than one of them starts a
// backend from the same path. A stray `pkill -f backend/src/index.js` next door
// takes this one down mid-crawl, which has nothing to do with whether a page
// fits. Bring it back and carry on; a page that overflows still fails.
async function ensureServer() {
  if (!serverDied) return false;
  serverDied = '';
  try { server.kill(); } catch { /* already gone */ }
  await startServer();
  return true;
}

async function signIn(kind) {
  if (kind === 'demo') {
    const r = await fetch(`${BASE}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json' } });
    if (!r.ok) throw new Error(`demo sandbox failed: ${r.status}`);
    return r.json();
  }
  const r = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `fit-${Date.now()}@example.test`,
      password: 'ViewportFit123!',
      company_name: 'Viewport Fit Metalworks',
      display_name: 'Fit Owner',
    }),
  });
  if (!r.ok) throw new Error(`signup failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function entityIds(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const get = async p => {
    try {
      const r = await fetch(BASE + p, { headers });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };
  const [apps, departments, stations] = await Promise.all([
    get('/api/apps'), get('/api/departments'), get('/api/stations'),
  ]);
  return {
    app: apps?.[0]?.id ?? 'no-app',
    dept: departments?.[0]?.id ?? 'no-department',
    station: stations?.[0]?.id ?? 'no-station',
  };
}

// Measured inside the page. Both numbers matter: the document is what a phone
// drags, and <main> is where the app shell parks the page.
function measure() {
  const de = document.documentElement;
  const main = document.querySelector('main');
  return {
    doc: de.scrollWidth - de.clientWidth,
    main: main ? main.scrollWidth - main.clientWidth : 0,
  };
}

before(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`No production build at ${DIST}. Run: npm run build --workspace=frontend`);
  }
  const chromium = await loadChromium();
  await startServer();
  browser = await chromium.launch();

  for (const account of ACCOUNTS) {
    await ensureServer();
    const session = await signIn(account.trim());
    const ids = await entityIds(session.token);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        await ensureServer();
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          hasTouch: true,
          isMobile: vp.width < 500,
        });
        await ctx.addCookies([{ name: 'hm_token', value: session.token, domain: 'localhost', path: '/' }]);
        const page = await ctx.newPage();
        // Seed the signed-in user and the theme the same way the app does, then
        // stand the guided tours down — a modal covering the page would hide the
        // very layout this check is here to measure.
        await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(([user, dark]) => {
          localStorage.setItem('hm_user', JSON.stringify(user));
          localStorage.setItem('hm_dark_mode', String(dark));
          localStorage.setItem(`setup_dismissed_${user.id}`, '1');
          localStorage.setItem(`hm_app_training_${user.id}`, JSON.stringify({ dismissed: true, collapsed: true, dataSeen: true }));
          sessionStorage.setItem('hm_first_run_landing_checked', '1');
          for (const m of ['analytics', 'dashboard', 'dashboards', 'departments', 'inventory', 'routings', 'schedule', 'sqdc', 'stations']) {
            localStorage.setItem(`hm_onboarding_seen_${m}`, '1');
          }
        }, [session.user, theme.trim() === 'dark']);

        for (const [name, template] of ROUTES) {
          const route = template
            .replace(':app', ids.app)
            .replace(':dept', ids.dept)
            .replace(':station', ids.station);
          const combo = `${account.trim()} · ${vp.name} · ${theme.trim()}`;
          let reading;
          try {
            await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(700);
            reading = await page.evaluate(measure);
          } catch (err) {
            if (await ensureServer()) {
              try {
                await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(700);
                reading = await page.evaluate(measure);
              } catch (retryErr) {
                reading = { error: String(retryErr).split('\n')[0] };
              }
            } else {
              reading = { error: String(err).split('\n')[0] };
            }
          }
          if (!measured.has(name)) measured.set(name, []);
          measured.get(name).push({ combo, route, ...reading });
        }
        await ctx.close();
      }
    }
  }
});

after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch { /* nothing to clean up */ }
  }
});

for (const [name] of ROUTES) {
  test(`${name} fits the screen`, () => {
    const readings = measured.get(name) ?? [];
    assert.ok(readings.length > 0, `${name} was never measured`);
    const failures = readings
      .filter(r => r.error || r.doc > 0 || r.main > 0)
      .map(r => r.error
        ? `${r.combo}: could not load ${r.route} — ${r.error}`
        : `${r.combo}: ${r.route} overflows by ${Math.max(r.doc, r.main)}px`
          + ` (document ${r.doc}px, main ${r.main}px)`);
    assert.deepStrictEqual(failures, [], `\n  ${failures.join('\n  ')}\n`);
  });
}
