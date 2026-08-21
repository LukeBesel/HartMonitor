// ─── Player batch helper tests: footer-hiding, takt bar, run-context, ink ────

import { describe, it, expect } from 'vitest';
import type { Step, Trigger, Widget } from '../../../types';
import {
  stepHidesFooterNav, taktBarState, runContextRequired, runContextGate,
  relativeLuminance, isLightColor, instructionInk, playerTextColor,
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

describe('run-context gating (work order OR part number)', () => {
  it('respects require_run_context: true always, false never, absent → schema v2+', () => {
    expect(runContextRequired({ require_run_context: true, schema_version: 1 })).toBe(true);
    expect(runContextRequired({ require_run_context: false, schema_version: 2 })).toBe(false);
    expect(runContextRequired({ schema_version: 2 })).toBe(true);
    expect(runContextRequired({ schema_version: 1 })).toBe(false);
    expect(runContextRequired({})).toBe(false); // no schema_version = legacy v1
    expect(runContextRequired(null)).toBe(false);
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
