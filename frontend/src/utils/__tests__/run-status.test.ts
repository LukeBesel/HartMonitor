import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runStatusLabel } from '../runStatus';

// ─── No column value reaches a person's eyes ─────────────────────────────────
//
// The Recent Runs card on a dashboard rendered `{r.status}` straight into its
// pill, so a manager read `in_progress` — underscore included — on the one
// screen the whole plant looks at. Facilities did the softer version of the
// same thing, `(op.status || 'unknown').replace('_', ' ')`: a label derived
// from the token, plus a made-up state called "unknown" for a run whose status
// simply had not arrived.

describe('runStatusLabel says the word, never the token', () => {
  it('gives each known status its one on-screen word', () => {
    expect(runStatusLabel('in_progress')).toBe('Running');
    expect(runStatusLabel('completed')).toBe('Completed');
    expect(runStatusLabel('abandoned')).toBe('Abandoned');
  });

  it('never lets an underscore or a raw token through', () => {
    for (const status of ['in_progress', 'completed', 'abandoned', 'on_hold', '']) {
      const label = runStatusLabel(status);
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe(status);
    }
  });

  it('states a status it does not know as “—”, not as “unknown”', () => {
    // A value the frontend has not been taught is a fact we do not have. The
    // old Facilities fallback printed the English word "unknown", which reads
    // like a real state a run can be in.
    expect(runStatusLabel(undefined)).toBe('—');
    expect(runStatusLabel(null)).toBe('—');
    expect(runStatusLabel('')).toBe('—');
    expect(runStatusLabel('some_new_status')).toBe('—');
  });
});

describe('the run screens print the label, not the column', () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf-8');

  it('the dashboard’s Recent Runs pill goes through the helper', () => {
    const src = read('src/pages/DashboardView.tsx');
    // The exact shape that shipped it: the status interpolated on its own.
    expect(src).not.toMatch(/\{\s*r\.status\s*\}/);
    expect(src).toMatch(/runStatusLabel\(r\.status\)/);
  });

  it('the Facilities drill-down derives no label from the token', () => {
    const src = read('src/pages/Facilities.tsx');
    expect(src).not.toMatch(/status[^\n]*\.replace\(\s*'_'/);
    expect(src).not.toMatch(/'unknown'/);
    expect(src).toMatch(/runStatusLabel\(op\.status\)/);
  });
});
