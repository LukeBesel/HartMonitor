import { describe, it, expect } from 'vitest';
import type { Trigger, TriggerAction, TriggerCondition, TriggerEvent, ValueRef } from '../../types';
import {
  runTrigger, runTriggers, evaluateCondition, conditionsPass, resolveValueRef,
  type TriggerRuntimeState, type TriggerEffect,
} from '../triggers';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<TriggerRuntimeState> = {}): TriggerRuntimeState {
  return {
    variables: {},
    widgetValues: {},
    currentStepId: 's1',
    steps: [{ id: 's1', order: 0 }, { id: 's2', order: 1 }, { id: 's3', order: 2 }],
    kit: null,
    appInfo: {},
    ...overrides,
  };
}

let seq = 0;
function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: `t${++seq}`,
    event: 'button_press',
    match: 'all',
    conditions: [],
    actions: [],
    ...overrides,
  };
}

const sref = (value: string | number | boolean): ValueRef => ({ kind: 'static', value });
const vref = (name: string): ValueRef => ({ kind: 'variable', name });
const wref = (name: string): ValueRef => ({ kind: 'widget', name });
const iref = (key: NonNullable<ValueRef['key']>): ValueRef => ({ kind: 'app_info', key });

// ─── resolveValueRef ──────────────────────────────────────────────────────────

describe('resolveValueRef', () => {
  const state = makeState({
    variables: { qty: 5, name: 'alice', flag: true },
    widgetValues: { w1: 'hello', w2: 42 },
    appInfo: { operator: 'Bob', quantity: 10, elapsed_seconds: 33 },
    scannedCode: 'SCAN-1',
  });

  it('resolves each ValueRef kind', () => {
    expect(resolveValueRef(sref('x'), state)).toBe('x');
    expect(resolveValueRef(sref(0), state)).toBe(0);
    expect(resolveValueRef(sref(false), state)).toBe(false);
    expect(resolveValueRef(vref('qty'), state)).toBe(5);
    expect(resolveValueRef(wref('w2'), state)).toBe(42);
    expect(resolveValueRef(iref('operator'), state)).toBe('Bob');
  });

  it('resolves scanned_code from state.scannedCode first', () => {
    expect(resolveValueRef(iref('scanned_code'), state)).toBe('SCAN-1');
    const noScan = makeState({ appInfo: { scanned_code: 'from-info' } });
    expect(resolveValueRef(iref('scanned_code'), noScan)).toBe('from-info');
  });

  it('yields undefined for unknown or malformed refs', () => {
    expect(resolveValueRef(undefined, state)).toBeUndefined();
    expect(resolveValueRef(vref('nope'), state)).toBeUndefined();
    expect(resolveValueRef(wref('nope'), state)).toBeUndefined();
    expect(resolveValueRef({ kind: 'variable' }, state)).toBeUndefined();
    expect(resolveValueRef({ kind: 'app_info' }, state)).toBeUndefined();
  });
});

// ─── operators ────────────────────────────────────────────────────────────────

describe('evaluateCondition — every operator', () => {
  const state = makeState({
    variables: { n: 5, s: 'hello world', empty: '', zero: 0, no: false },
    kit: null,
  });
  const cond = (op: TriggerCondition['op'], left?: ValueRef, right?: ValueRef): TriggerCondition =>
    ({ left, op, right });

  it('eq — same type, cross type, and mismatch', () => {
    expect(evaluateCondition(cond('eq', vref('n'), sref(5)), state)).toBe(true);
    expect(evaluateCondition(cond('eq', vref('n'), sref('5')), state)).toBe(true); // '5' vs 5
    expect(evaluateCondition(cond('eq', vref('s'), sref('hello world')), state)).toBe(true);
    expect(evaluateCondition(cond('eq', vref('n'), sref(6)), state)).toBe(false);
    expect(evaluateCondition(cond('eq', vref('no'), sref(false)), state)).toBe(true);
    expect(evaluateCondition(cond('eq', vref('missing'), sref('x')), state)).toBe(false);
  });

  it('neq', () => {
    expect(evaluateCondition(cond('neq', vref('n'), sref(6)), state)).toBe(true);
    expect(evaluateCondition(cond('neq', vref('n'), sref(5)), state)).toBe(false);
  });

  it('gt / gte / lt / lte with numeric coercion', () => {
    expect(evaluateCondition(cond('gt', vref('n'), sref(4)), state)).toBe(true);
    expect(evaluateCondition(cond('gt', vref('n'), sref(5)), state)).toBe(false);
    expect(evaluateCondition(cond('gte', vref('n'), sref(5)), state)).toBe(true);
    expect(evaluateCondition(cond('lt', vref('n'), sref(6)), state)).toBe(true);
    expect(evaluateCondition(cond('lt', vref('n'), sref(5)), state)).toBe(false);
    expect(evaluateCondition(cond('lte', vref('n'), sref(5)), state)).toBe(true);
    // string numbers coerce
    expect(evaluateCondition(cond('gt', sref('10'), sref('9')), state)).toBe(true);
  });

  it('numeric operators are false on non-numeric operands', () => {
    expect(evaluateCondition(cond('gt', vref('s'), sref(1)), state)).toBe(false);
    expect(evaluateCondition(cond('lte', vref('missing'), sref(1)), state)).toBe(false);
  });

  it('contains', () => {
    expect(evaluateCondition(cond('contains', vref('s'), sref('world')), state)).toBe(true);
    expect(evaluateCondition(cond('contains', vref('s'), sref('mars')), state)).toBe(false);
    expect(evaluateCondition(cond('contains', vref('missing'), sref('x')), state)).toBe(false);
    // numeric haystack coerces to string
    expect(evaluateCondition(cond('contains', sref(12345), sref('234')), state)).toBe(true);
  });

  it('is_blank / not_blank', () => {
    expect(evaluateCondition(cond('is_blank', vref('empty')), state)).toBe(true);
    expect(evaluateCondition(cond('is_blank', vref('missing')), state)).toBe(true);
    expect(evaluateCondition(cond('is_blank', vref('s')), state)).toBe(false);
    // 0 and false are values, not blanks
    expect(evaluateCondition(cond('is_blank', vref('zero')), state)).toBe(false);
    expect(evaluateCondition(cond('is_blank', vref('no')), state)).toBe(false);
    expect(evaluateCondition(cond('not_blank', vref('s')), state)).toBe(true);
    expect(evaluateCondition(cond('not_blank', vref('empty')), state)).toBe(false);
  });

  it('kit_complete — no operands needed', () => {
    const c = cond('kit_complete');
    expect(evaluateCondition(c, makeState({ kit: null }))).toBe(false);
    expect(evaluateCondition(c, makeState({
      kit: { status: 'picking', lines: [{ status: 'verified', step_id: '' }, { status: 'verified', step_id: '' }] },
    }))).toBe(true);
    // picked counts toward completion (requireScan false path)
    expect(evaluateCondition(c, makeState({
      kit: { status: 'picking', lines: [{ status: 'picked', step_id: '' }, { status: 'verified', step_id: '' }] },
    }))).toBe(true);
    // any pending line fails it
    expect(evaluateCondition(c, makeState({
      kit: { status: 'picking', lines: [{ status: 'pending', step_id: '' }, { status: 'verified', step_id: '' }] },
    }))).toBe(false);
    // short lines fail it
    expect(evaluateCondition(c, makeState({
      kit: { status: 'short', lines: [{ status: 'short', step_id: '' }, { status: 'verified', step_id: '' }] },
    }))).toBe(false);
  });

  it('kit_has_short', () => {
    const c = cond('kit_has_short');
    expect(evaluateCondition(c, makeState({ kit: null }))).toBe(false);
    expect(evaluateCondition(c, makeState({
      kit: { status: 'picking', lines: [{ status: 'verified', step_id: '' }] },
    }))).toBe(false);
    expect(evaluateCondition(c, makeState({
      kit: { status: 'short', lines: [{ status: 'verified', step_id: '' }, { status: 'short', step_id: '' }] },
    }))).toBe(true);
  });
});

// ─── match all / any ──────────────────────────────────────────────────────────

describe('conditionsPass — match semantics', () => {
  const state = makeState({ variables: { a: 1, b: 2 } });
  const isTrue: TriggerCondition = { left: vref('a'), op: 'eq', right: sref(1) };
  const isFalse: TriggerCondition = { left: vref('b'), op: 'eq', right: sref(99) };

  it('empty conditions always pass (both matchers)', () => {
    expect(conditionsPass(makeTrigger({ match: 'all', conditions: [] }), state)).toBe(true);
    expect(conditionsPass(makeTrigger({ match: 'any', conditions: [] }), state)).toBe(true);
  });

  it("match: 'all' requires every condition", () => {
    expect(conditionsPass(makeTrigger({ match: 'all', conditions: [isTrue, isTrue] }), state)).toBe(true);
    expect(conditionsPass(makeTrigger({ match: 'all', conditions: [isTrue, isFalse] }), state)).toBe(false);
  });

  it("match: 'any' requires at least one condition", () => {
    expect(conditionsPass(makeTrigger({ match: 'any', conditions: [isFalse, isTrue] }), state)).toBe(true);
    expect(conditionsPass(makeTrigger({ match: 'any', conditions: [isFalse, isFalse] }), state)).toBe(false);
  });
});

// ─── every action type ────────────────────────────────────────────────────────

describe('runTrigger — every action type', () => {
  it('go_to_step', () => {
    const t = makeTrigger({ actions: [{ type: 'go_to_step', stepId: 's3' }] });
    expect(runTrigger(t, makeState())).toEqual([{ kind: 'navigate', to: 'step', stepId: 's3' }]);
  });

  it('next_step / prev_step / complete_app', () => {
    expect(runTrigger(makeTrigger({ actions: [{ type: 'next_step' }] }), makeState()))
      .toEqual([{ kind: 'navigate', to: 'next' }]);
    expect(runTrigger(makeTrigger({ actions: [{ type: 'prev_step' }] }), makeState()))
      .toEqual([{ kind: 'navigate', to: 'prev' }]);
    expect(runTrigger(makeTrigger({ actions: [{ type: 'complete_app' }] }), makeState()))
      .toEqual([{ kind: 'navigate', to: 'complete' }]);
  });

  it('set_variable from static, variable, widget, and app_info refs', () => {
    const state = makeState({
      variables: { src: 'copied' },
      widgetValues: { w1: 7 },
      appInfo: { operator: 'Ann' },
    });
    const t = makeTrigger({ actions: [
      { type: 'set_variable', name: 'a', value: sref('lit') },
      { type: 'set_variable', name: 'b', value: vref('src') },
      { type: 'set_variable', name: 'c', value: wref('w1') },
      { type: 'set_variable', name: 'd', value: iref('operator') },
    ] });
    expect(runTrigger(t, state)).toEqual([
      { kind: 'set_variable', name: 'a', value: 'lit' },
      { kind: 'set_variable', name: 'b', value: 'copied' },
      { kind: 'set_variable', name: 'c', value: 7 },
      { kind: 'set_variable', name: 'd', value: 'Ann' },
    ]);
  });

  it('set_variable coerces unresolvable refs to empty string', () => {
    const t = makeTrigger({ actions: [{ type: 'set_variable', name: 'x', value: vref('missing') }] });
    expect(runTrigger(t, makeState())).toEqual([{ kind: 'set_variable', name: 'x', value: '' }]);
  });

  it('show_message interpolates {{variables}} and app_info', () => {
    const state = makeState({ variables: { part: 'X-100' }, appInfo: { operator: 'Ann' } });
    const t = makeTrigger({ actions: [
      { type: 'show_message', level: 'warning', text: '{{part}} by {{operator}} — {{unknown}}' },
    ] });
    expect(runTrigger(t, state)).toEqual([
      { kind: 'toast', level: 'warning', text: 'X-100 by Ann — —' },
    ]);
  });

  it('block_with_error interpolates and halts remaining actions', () => {
    const state = makeState({ variables: { why: 'torque out of range' } });
    const t = makeTrigger({ actions: [
      { type: 'show_message', level: 'info', text: 'before' },
      { type: 'block_with_error', text: 'Stopped: {{why}}' },
      { type: 'show_message', level: 'info', text: 'after (must not run)' },
      { type: 'next_step' },
    ] });
    expect(runTrigger(t, state)).toEqual([
      { kind: 'toast', level: 'info', text: 'before' },
      { kind: 'block', text: 'Stopped: torque out of range' },
    ]);
  });

  it('require_photo with default and custom (interpolated) message', () => {
    expect(runTrigger(makeTrigger({ actions: [{ type: 'require_photo' }] }), makeState()))
      .toEqual([{ kind: 'require_photo', message: 'Photo required' }]);
    const state = makeState({ variables: { sn: 'SN-9' } });
    expect(runTrigger(makeTrigger({ actions: [{ type: 'require_photo', message: 'Photo of {{sn}}' }] }), state))
      .toEqual([{ kind: 'require_photo', message: 'Photo of SN-9' }]);
  });

  it('save_record enqueues resolved field values', () => {
    const state = makeState({ variables: { serial: 'SN-1' }, widgetValues: { torque: 15 } });
    const t = makeTrigger({ actions: [{
      type: 'save_record', tableId: 'tbl1',
      fields: { f1: vref('serial'), f2: wref('torque'), f3: sref(true) },
    }] });
    expect(runTrigger(t, state)).toEqual([{
      kind: 'enqueue', op: 'save_record',
      payload: { tableId: 'tbl1', fields: { f1: 'SN-1', f2: 15, f3: true } },
    }]);
  });

  it('create_ncr enqueues with interpolated title/description', () => {
    const state = makeState({ variables: { sn: 'SN-2' }, appInfo: { work_order_number: 'WO-7' } });
    const t = makeTrigger({ actions: [{
      type: 'create_ncr', severity: 'major',
      title: 'Failed test on {{sn}}', description: 'WO {{work_order_number}}',
    }] });
    expect(runTrigger(t, state)).toEqual([{
      kind: 'enqueue', op: 'create_ncr',
      payload: { severity: 'major', title: 'Failed test on SN-2', description: 'WO WO-7' },
    }]);
  });

  it('create_ncr with no description enqueues an empty description', () => {
    const t = makeTrigger({ actions: [{ type: 'create_ncr', severity: 'minor', title: 'T' }] });
    expect(runTrigger(t, makeState())).toEqual([{
      kind: 'enqueue', op: 'create_ncr',
      payload: { severity: 'minor', title: 'T', description: '' },
    }]);
  });

  it('set_variable is visible to later actions within the same trigger', () => {
    const t = makeTrigger({ actions: [
      { type: 'set_variable', name: 'msg', value: sref('updated') },
      { type: 'show_message', level: 'info', text: 'value: {{msg}}' },
    ] });
    const state = makeState({ variables: { msg: 'original' } });
    expect(runTrigger(t, state)).toEqual([
      { kind: 'set_variable', name: 'msg', value: 'updated' },
      { kind: 'toast', level: 'info', text: 'value: updated' },
    ]);
    // and the input state was not mutated
    expect(state.variables.msg).toBe('original');
  });

  it('returns [] when disabled or when conditions fail', () => {
    const nav: TriggerAction[] = [{ type: 'next_step' }];
    expect(runTrigger(makeTrigger({ enabled: false, actions: nav }), makeState())).toEqual([]);
    const gated = makeTrigger({
      conditions: [{ left: vref('x'), op: 'eq', right: sref(1) }],
      actions: nav,
    });
    expect(runTrigger(gated, makeState({ variables: { x: 2 } }))).toEqual([]);
    expect(runTrigger(gated, makeState({ variables: { x: 1 } }))).toEqual([{ kind: 'navigate', to: 'next' }]);
  });
});

// ─── every event type ─────────────────────────────────────────────────────────

describe('runTriggers — event filtering', () => {
  const EVENTS: TriggerEvent[] = ['button_press', 'step_enter', 'step_exit', 'input_change', 'timer_done', 'scan'];

  it('fires only triggers whose event matches, for every event type', () => {
    const triggers = EVENTS.map(event => makeTrigger({
      event,
      actions: [{ type: 'show_message', level: 'info', text: `fired:${event}` }],
    }));
    for (const event of EVENTS) {
      const effects = runTriggers(triggers, event, makeState());
      expect(effects).toEqual([{ kind: 'toast', level: 'info', text: `fired:${event}` }]);
    }
  });

  it('scan event can condition on the scanned code', () => {
    const t = makeTrigger({
      event: 'scan',
      conditions: [{ left: iref('scanned_code'), op: 'eq', right: sref('ABC-123') }],
      actions: [{ type: 'next_step' }],
    });
    expect(runTriggers([t], 'scan', makeState({ scannedCode: 'ABC-123' })))
      .toEqual([{ kind: 'navigate', to: 'next' }]);
    expect(runTriggers([t], 'scan', makeState({ scannedCode: 'WRONG' }))).toEqual([]);
  });

  it('skips disabled triggers but runs enabled ones after them', () => {
    const off = makeTrigger({ enabled: false, actions: [{ type: 'show_message', level: 'info', text: 'off' }] });
    const on = makeTrigger({ actions: [{ type: 'show_message', level: 'info', text: 'on' }] });
    expect(runTriggers([off, on], 'button_press', makeState()))
      .toEqual([{ kind: 'toast', level: 'info', text: 'on' }]);
  });
});

// ─── ordering semantics ───────────────────────────────────────────────────────

describe('runTriggers — first navigation wins', () => {
  it('stops processing further triggers after the first navigate effect', () => {
    const t1 = makeTrigger({ actions: [{ type: 'go_to_step', stepId: 's2' }] });
    const t2 = makeTrigger({ actions: [
      { type: 'show_message', level: 'info', text: 'never shown' },
      { type: 'go_to_step', stepId: 's3' },
    ] });
    expect(runTriggers([t1, t2], 'button_press', makeState()))
      .toEqual([{ kind: 'navigate', to: 'step', stepId: 's2' }]);
  });

  it('complete counts as navigation and wins over later triggers', () => {
    const t1 = makeTrigger({ actions: [{ type: 'complete_app' }] });
    const t2 = makeTrigger({ actions: [{ type: 'next_step' }] });
    expect(runTriggers([t1, t2], 'button_press', makeState()))
      .toEqual([{ kind: 'navigate', to: 'complete' }]);
  });

  it('non-navigation effects before the navigation are kept', () => {
    const t1 = makeTrigger({ actions: [
      { type: 'set_variable', name: 'x', value: sref(1) },
      { type: 'next_step' },
    ] });
    const t2 = makeTrigger({ actions: [{ type: 'show_message', level: 'info', text: 'skipped' }] });
    expect(runTriggers([t1, t2], 'button_press', makeState())).toEqual([
      { kind: 'set_variable', name: 'x', value: 1 },
      { kind: 'navigate', to: 'next' },
    ]);
  });
});

describe('runTriggers — block cancels navigation', () => {
  it('a block in an earlier trigger suppresses navigation from later triggers', () => {
    const blocker = makeTrigger({ actions: [{ type: 'block_with_error', text: 'stop' }] });
    const nav = makeTrigger({ actions: [
      { type: 'show_message', level: 'info', text: 'still runs' },
      { type: 'next_step' },
    ] });
    expect(runTriggers([blocker, nav], 'button_press', makeState())).toEqual([
      { kind: 'block', text: 'stop' },
      { kind: 'toast', level: 'info', text: 'still runs' },
      // no navigate effect
    ]);
  });

  it('a block cancels a navigation already queued in the same trigger (malformed order)', () => {
    // Builder pins navigation last, but the engine must still be safe if a blob
    // has navigate-then-block: pending navigation is cancelled.
    const t = makeTrigger({ actions: [
      { type: 'next_step' },
      { type: 'block_with_error', text: 'late block' },
    ] });
    expect(runTriggers([t], 'button_press', makeState()))
      .toEqual([{ kind: 'block', text: 'late block' }]);
  });

  it('block inside a single trigger prevents its own later navigation action', () => {
    const t = makeTrigger({ actions: [
      { type: 'block_with_error', text: 'nope' },
      { type: 'next_step' },
    ] });
    expect(runTriggers([t], 'step_exit', makeState({ }))).toEqual([]);
    // step_exit event vs button_press trigger: nothing fires. Use matching event:
    const t2 = makeTrigger({ event: 'step_exit', actions: [
      { type: 'block_with_error', text: 'nope' },
      { type: 'next_step' },
    ] });
    expect(runTriggers([t2], 'step_exit', makeState()))
      .toEqual([{ kind: 'block', text: 'nope' }]);
  });
});

describe('runTriggers — set_variable visibility across triggers', () => {
  it('later triggers in the same event see values set by earlier triggers', () => {
    const setter = makeTrigger({ actions: [{ type: 'set_variable', name: 'count', value: sref(5) }] });
    const gated = makeTrigger({
      conditions: [{ left: vref('count'), op: 'eq', right: sref(5) }],
      actions: [{ type: 'show_message', level: 'info', text: 'count is {{count}}' }],
    });
    expect(runTriggers([setter, gated], 'button_press', makeState({ variables: { count: 0 } }))).toEqual([
      { kind: 'set_variable', name: 'count', value: 5 },
      { kind: 'toast', level: 'info', text: 'count is 5' },
    ]);
  });

  it('does not mutate the caller-provided state', () => {
    const state = makeState({ variables: { count: 0 } });
    const setter = makeTrigger({ actions: [{ type: 'set_variable', name: 'count', value: sref(9) }] });
    runTriggers([setter], 'button_press', state);
    expect(state.variables.count).toBe(0);
  });
});

// ─── kit conditions driving routing ───────────────────────────────────────────

describe('runTriggers — kit_complete / kit_has_short routing', () => {
  const kitShort: TriggerRuntimeState['kit'] = {
    status: 'short',
    lines: [
      { status: 'verified', step_id: 's1' },
      { status: 'short', step_id: 's1' },
    ],
  };
  const kitDone: TriggerRuntimeState['kit'] = {
    status: 'complete',
    lines: [
      { status: 'verified', step_id: 's1' },
      { status: 'picked', step_id: 's2' },
    ],
  };

  const shortagePath = makeTrigger({
    event: 'step_exit',
    conditions: [{ op: 'kit_has_short' }],
    actions: [{ type: 'go_to_step', stepId: 's3' }],
  });
  const completePath = makeTrigger({
    event: 'step_exit',
    conditions: [{ op: 'kit_complete' }],
    actions: [{ type: 'next_step' }],
  });

  it('routes to the shortage step when the kit has a short line', () => {
    expect(runTriggers([shortagePath, completePath], 'step_exit', makeState({ kit: kitShort })))
      .toEqual([{ kind: 'navigate', to: 'step', stepId: 's3' }]);
  });

  it('advances normally when the kit is complete', () => {
    expect(runTriggers([shortagePath, completePath], 'step_exit', makeState({ kit: kitDone })))
      .toEqual([{ kind: 'navigate', to: 'next' }]);
  });

  it('fires neither path when no kit is loaded', () => {
    expect(runTriggers([shortagePath, completePath], 'step_exit', makeState({ kit: null })))
      .toEqual([]);
  });
});

// ─── effect type exhaustiveness sanity ────────────────────────────────────────

describe('TriggerEffect shape', () => {
  it('covers every effect kind the spec defines', () => {
    const kinds = new Set<TriggerEffect['kind']>();
    const state = makeState({ variables: { v: 1 } });
    const t = makeTrigger({ actions: [
      { type: 'set_variable', name: 'v', value: sref(2) },
      { type: 'show_message', level: 'info', text: 'm' },
      { type: 'require_photo' },
      { type: 'save_record', tableId: 'tb', fields: {} },
      { type: 'create_ncr', severity: 'minor', title: 't' },
      { type: 'next_step' },
    ] });
    for (const e of runTriggers([t], 'button_press', state)) kinds.add(e.kind);
    const blocker = makeTrigger({ actions: [{ type: 'block_with_error', text: 'b' }] });
    for (const e of runTriggers([blocker], 'button_press', state)) kinds.add(e.kind);
    expect([...kinds].sort()).toEqual(
      ['block', 'enqueue', 'navigate', 'require_photo', 'set_variable', 'toast'],
    );
  });
});
