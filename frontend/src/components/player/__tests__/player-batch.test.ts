// ─── Player batch helper tests: footer-hiding, takt bar, run-context, ink ────

import { describe, it, expect } from 'vitest';
import type { Step, Trigger, Widget } from '../../../types';
import {
  stepHidesFooterNav, taktBarState, runContextRequired, runContextGate,
  relativeLuminance, isLightColor, instructionInk, playerTextColor, stepTaktSeconds,
  claimSideEffect, sideEffectKey, stepValueSignature,
} from '../runtime';

function widget(partial: Partial<Widget> & { id: string; type: Widget['type'] }): Widget {
  return { label: '', order: 0, config: {}, ...partial } as Widget;
}

function step(widgets: Widget[], partial: Partial<Step> = {}): Step {
  return { id: 's1', name: 'Step 1', order: 0, widgets, ...partial };
}

function trigger(partial: Partial<Trigger>): Trigger {
  return { id: 't1', event: 'button_press', match: 'all', conditions: [], actions: [], ...partial };
}

describe('footer-hiding rule (exactly one way to advance)', () => {
  it('hides for legacy buttonType next and complete', () => {
    expect(stepHidesFooterNav(step([widget({ id: 'b', type: 'button', config: { buttonType: 'next' } })]))).toBe(true);
    expect(stepHidesFooterNav(step([widget({ id: 'b', type: 'button', config: { buttonType: 'complete' } })]))).toBe(true);
  });

  it('treats an absent legacy buttonType as next (v1 default)', () => {
    expect(stepHidesFooterNav(step([widget({ id: 'b', type: 'button', config: { buttonText: 'Go' } })]))).toBe(true);
  });

  it('does not hide for prev or custom buttons', () => {
    expect(stepHidesFooterNav(step([widget({ id: 'b', type: 'button', config: { buttonType: 'prev' } })]))).toBe(false);
    expect(stepHidesFooterNav(step([widget({ id: 'b', type: 'button', config: { buttonType: 'custom' } })]))).toBe(false);
  });

  it('hides when a button trigger carries a navigation action', () => {
    const nav = widget({
      id: 'b', type: 'button', config: { buttonType: 'custom' },
      triggers: [trigger({ actions: [{ type: 'set_variable', name: 'x', value: { kind: 'static', value: 1 } }, { type: 'go_to_step', stepId: 's9' }] })],
    });
    expect(stepHidesFooterNav(step([nav]))).toBe(true);

    const complete = widget({
      id: 'b', type: 'button',
      triggers: [trigger({ actions: [{ type: 'complete_app' }] })],
    });
    expect(stepHidesFooterNav(step([complete]))).toBe(true);
  });

  it('authored triggers replace legacy semantics: a non-nav trigger does not hide', () => {
    const toastOnly = widget({
      id: 'b', type: 'button', config: { buttonType: 'next' }, // stale legacy field
      triggers: [trigger({ actions: [{ type: 'show_message', level: 'info', text: 'hi' }] })],
    });
    expect(stepHidesFooterNav(step([toastOnly]))).toBe(false);
  });

  it('ignores disabled triggers, prev_step-only triggers and non-button widgets', () => {
    const disabled = widget({
      id: 'b', type: 'button', config: { buttonType: 'custom' },
      triggers: [trigger({ enabled: false, actions: [{ type: 'next_step' }] })],
    });
    expect(stepHidesFooterNav(step([disabled]))).toBe(false);

    const backOnly = widget({
      id: 'b', type: 'button',
      triggers: [trigger({ actions: [{ type: 'prev_step' }] })],
    });
    expect(stepHidesFooterNav(step([backOnly]))).toBe(false);

    const input = widget({
      id: 'i', type: 'text-input',
      triggers: [trigger({ event: 'input_change', actions: [{ type: 'next_step' }] })],
    });
    expect(stepHidesFooterNav(step([input]))).toBe(false);
    expect(stepHidesFooterNav(undefined)).toBe(false);
    expect(stepHidesFooterNav(step([]))).toBe(false);
  });
});

describe('takt countdown bar (green → amber at 20% → red)', () => {
  it('returns null for untimed steps', () => {
    expect(taktBarState(0, 10)).toBeNull();
    expect(taktBarState(-5, 10)).toBeNull();
  });

  it('is green (ok) while more than 20% of the window remains', () => {
    expect(taktBarState(100, 0)).toEqual({ fraction: 1, level: 'ok' });
    expect(taktBarState(100, 79)).toMatchObject({ level: 'ok' });
  });

  it('turns amber (warn) at 20% remaining', () => {
    expect(taktBarState(100, 80)).toEqual({ fraction: 0.2, level: 'warn' });
    expect(taktBarState(100, 99)).toMatchObject({ level: 'warn' });
  });

  it('turns red (over) once takt hits zero and clamps the fill', () => {
    expect(taktBarState(100, 100)).toEqual({ fraction: 0, level: 'over' });
    expect(taktBarState(100, 250)).toEqual({ fraction: 0, level: 'over' });
  });

  it('drains linearly with remaining time', () => {
    expect(taktBarState(60, 30)?.fraction).toBeCloseTo(0.5);
    expect(taktBarState(60, 45)?.fraction).toBeCloseTo(0.25);
  });
});

describe('step takt (legacy takt_time fallback)', () => {
  it('reads the v2 key, then the v1 key, then reports zero', () => {
    expect(stepTaktSeconds({ takt_time_seconds: 240 })).toBe(240);
    // Apps built before the v2 builder — and the demo sandbox seed — use this.
    expect(stepTaktSeconds({ takt_time: 240 })).toBe(240);
    // v2 key wins when both exist.
    expect(stepTaktSeconds({ takt_time_seconds: 200, takt_time: 240 })).toBe(200);
    expect(stepTaktSeconds({})).toBe(0);
    expect(stepTaktSeconds(null)).toBe(0);
    expect(stepTaktSeconds({ takt_time_seconds: 0, takt_time: 240 })).toBe(240);
  });
});

describe('run-context gating (work order OR part number)', () => {
  it('respects require_run_context: true always, false never, absent → schema v2+', () => {
    expect(runContextRequired({ require_run_context: true, schema_version: 1 })).toBe(true);
    expect(runContextRequired({ require_run_context: false, schema_version: 2 })).toBe(false);
    expect(runContextRequired({ schema_version: 2 })).toBe(true);
    expect(runContextRequired({ schema_version: 1 })).toBe(false);
    expect(runContextRequired({})).toBe(false); // no schema_version = legacy v1
    expect(runContextRequired(null)).toBe(false);
  });

  it('accepts the SQLite 0/1 integers the API actually returns', () => {
    // require_run_context is a nullable INTEGER column, so the wire value is a
    // number. Strict boolean comparison sent both settings down the
    // schema_version fallback and the builder toggle did nothing.
    expect(runContextRequired({ require_run_context: 1, schema_version: 1 })).toBe(true);
    expect(runContextRequired({ require_run_context: 0, schema_version: 2 })).toBe(false);
    // null (column never set) still means "fall back to schema_version".
    expect(runContextRequired({ require_run_context: null, schema_version: 2 })).toBe(true);
    expect(runContextRequired({ require_run_context: null, schema_version: 1 })).toBe(false);
  });

  it('passes with a work order OR a typed part number', () => {
    expect(runContextGate(true, 'wo-1', '')).toEqual({ ok: true, reason: '' });
    expect(runContextGate(true, '', 'PN-100')).toEqual({ ok: true, reason: '' });
    expect(runContextGate(true, 'wo-1', 'PN-100').ok).toBe(true);
  });

  it('blocks with a short reason when required and no context exists', () => {
    const gate = runContextGate(true, '', '   ');
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/work order|part number/i);
  });

  it('never blocks when the app does not require context', () => {
    expect(runContextGate(false, '', '')).toEqual({ ok: true, reason: '' });
  });
});

describe('dark-player text contrast (luminance check)', () => {
  it('computes relative luminance for hex and rgb, null for unparseable', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(relativeLuminance('#000000')).toBeCloseTo(0);
    expect(relativeLuminance('#fff')).toBeCloseTo(1);
    expect(relativeLuminance('rgb(255, 255, 255)')).toBeCloseTo(1);
    expect(relativeLuminance('var(--p-ink)')).toBeNull();
    expect(relativeLuminance('')).toBeNull();
  });

  it('white cards and pastel washes count as light', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#eff6ff')).toBe(true);  // builder's default instruction wash
    expect(isLightColor('#1e3a5f')).toBe(false); // player's default dark card
  });

  it('a white-card instruction gets dark ink; dark cards keep light ink', () => {
    expect(instructionInk('#ffffff')).toBe('#1a2433');
    expect(instructionInk('#eff6ff')).toBe('#1a2433');
    expect(instructionInk('#1e3a5f')).toBe('#f1f5f9');
    expect(instructionInk(undefined)).toBe('#f1f5f9');
  });

  it('configured dark text with no background falls back to player ink', () => {
    expect(playerTextColor('#111827')).toBe('var(--p-ink-2)');
    expect(playerTextColor('#374151')).toBe('var(--p-ink-2)');
    expect(playerTextColor('#f8fafc')).toBe('#f8fafc');   // light configured ink passes through
    expect(playerTextColor(undefined)).toBe('var(--p-ink-2)');
    expect(playerTextColor('var(--custom)')).toBe('var(--custom)'); // unparseable untouched
  });
});

// ─── One filing per problem, not one per press ───────────────────────────────
// A step_exit trigger of [create_ncr, block_with_error] leaves the operator on
// the step with the forward button still live. Every press re-runs step_exit,
// and every re-run used to raise ANOTHER quality record for the same failure —
// so a Fail pressed four times filed four NCRs.

describe('side-effecting step_exit actions fire once per failure', () => {
  const failStep = step([
    widget({ id: 'w1', type: 'pass-fail', config: { variableName: 'qc_result' } }),
    widget({ id: 'w2', type: 'text-input', config: { variableName: 'note' } }),
  ]);
  const ncr = { severity: 'major', title: 'Visual inspection failed', description: 'Unit held' };
  const keyFor = (data: Record<string, unknown>, payload: unknown = ncr) =>
    sideEffectKey(failStep.id, stepValueSignature(failStep, data), 'create_ncr', payload);

  it('files on the first press and on no press after it', () => {
    const fired = new Set<string>();
    const data = { qc_result: 'Fail' };
    expect(claimSideEffect(fired, keyFor(data))).toBe(true);
    expect(claimSideEffect(fired, keyFor(data))).toBe(false);
    expect(claimSideEffect(fired, keyFor(data))).toBe(false);
    expect(fired.size).toBe(1);
  });

  it('files again when the answers changed — a different report', () => {
    const fired = new Set<string>();
    expect(claimSideEffect(fired, keyFor({ qc_result: 'Fail' }))).toBe(true);
    // The operator corrects the unit and fails it again for another reason.
    expect(claimSideEffect(fired, keyFor({ qc_result: 'Fail', note: 'second defect' }))).toBe(true);
    expect(fired.size).toBe(2);
  });

  it('keeps different actions and different steps apart', () => {
    const fired = new Set<string>();
    const data = { qc_result: 'Fail' };
    expect(claimSideEffect(fired, keyFor(data))).toBe(true);
    expect(claimSideEffect(fired, keyFor(data, { ...ncr, severity: 'critical' }))).toBe(true);
    expect(claimSideEffect(fired, sideEffectKey('other-step', stepValueSignature(failStep, data), 'create_ncr', ncr))).toBe(true);
    expect(claimSideEffect(fired, sideEffectKey(failStep.id, stepValueSignature(failStep, data), 'save_record', ncr))).toBe(true);
  });

  it('signs a step by its answers, whatever order the keys arrive in', () => {
    const a = stepValueSignature(failStep, { qc_result: 'Fail', note: 'x' });
    const b = stepValueSignature(failStep, { note: 'x', qc_result: 'Fail' });
    expect(a).toBe(b);
    expect(stepValueSignature(failStep, { qc_result: 'Pass' })).not.toBe(a);
    expect(stepValueSignature(undefined, {})).toBe('');
  });

  it('is stable across payload key order', () => {
    expect(sideEffectKey('s', 'v', 'create_ncr', { a: 1, b: { c: 2, d: 3 } }))
      .toBe(sideEffectKey('s', 'v', 'create_ncr', { b: { d: 3, c: 2 }, a: 1 }));
  });
});
