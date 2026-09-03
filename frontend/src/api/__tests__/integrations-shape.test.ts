import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ─── The type says what the route sends, and nothing else ────────────────────
//
// GET /config/integrations answers in two halves. Every manager gets the
// STATUS half — whether payments and SSO are live on this deployment, which is
// a fact about their own account. The SETUP half (the env var names, the Stripe
// webhook endpoint, each provider's OAuth redirect URI) is instructions to
// whoever runs the servers, and the route returns it to HartMonitor's own staff
// alone.
//
// `api.getIntegrations` declared the setup half as REQUIRED, so a manager's
// perfectly valid response did not match its own type and a screen reading
// `payments.env_vars.length` type-checked all the way to a crash. This test
// reads both sides and keeps them honest: a key the route only sets in its
// staff-only branch has to be optional in the client, a key it always sets has
// to be required, and a key it never sets at all must not be declared.

/** Walk up from the test until both halves of the repo are in reach. */
const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'frontend', 'src', 'api', 'client.ts'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate the repo root from ${process.cwd()}`);
})();

const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf-8');

/** Strip // and /* comments, so a field named in prose is not read as code. */
const uncommented = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** The declared response body of `api.getIntegrations`, field by field. */
function declaredFields(): Map<string, boolean> {
  const client = read('frontend', 'src', 'api', 'client.ts');
  const block = client.match(/getIntegrations:[\s\S]*?request<\{([\s\S]*?)\}>\('\/config\/integrations'\)/);
  expect(block, 'api.getIntegrations no longer declares an inline response type').toBeTruthy();
  const fields = new Map<string, boolean>();
  for (const m of uncommented(block![1]).matchAll(/([A-Za-z_]\w*)(\??)\s*:/g)) {
    fields.set(m[1], m[2] === '?');
  }
  return fields;
}

/** The route handler, split at the line where the manager's answer is sent. */
function routeHalves(): { always: string; staffOnly: string } {
  const config = uncommented(read('backend', 'src', 'routes', 'config.js'));
  const handler = config.match(/router\.get\('\/integrations'[\s\S]*?\n\}\);/);
  expect(handler, 'GET /integrations is no longer defined in routes/config.js').toBeTruthy();
  const source = handler![0];
  const split = source.indexOf('if (!staff)');
  expect(split, 'the route no longer answers a non-staff manager early').toBeGreaterThan(0);
  return { always: source.slice(0, split), staffOnly: source.slice(split) };
}

describe('api.getIntegrations matches GET /config/integrations', () => {
  const fields = declaredFields();
  const { always, staffOnly } = routeHalves();
  const mentions = (half: string, field: string) => new RegExp(`\\b${field}\\b`).test(half);

  it('declares the fields the route sends', () => {
    expect([...fields.keys()].sort()).toEqual([
      'app_url', 'app_url_explicit', 'configured', 'env_vars', 'events',
      'id', 'mode', 'name', 'payments', 'redirect_uri', 'sso', 'webhook_url',
    ]);
  });

  it('requires every field the route always sends', () => {
    const wrong = [...fields].filter(([f, optional]) => mentions(always, f) && optional);
    expect(wrong.map(([f]) => f)).toEqual([]);
  });

  it('marks every platform-staff-only field optional', () => {
    const wrong = [...fields].filter(
      ([f, optional]) => !mentions(always, f) && mentions(staffOnly, f) && !optional,
    );
    expect(wrong.map(([f]) => f)).toEqual([]);
  });

  it('promises no field the route never sends', () => {
    const invented = [...fields.keys()].filter(f => !mentions(always, f) && !mentions(staffOnly, f));
    expect(invented).toEqual([]);
  });
});
