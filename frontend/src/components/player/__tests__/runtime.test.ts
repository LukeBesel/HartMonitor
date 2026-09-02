// ─── Player runtime helper tests (spec §5.3–§5.5) ────────────────────────────

import { describe, it, expect } from 'vitest';
import type { Step, Widget, KitLine } from '../../../types';
import {
  getStepBlocks, summarizeBlocks, kitProgress, evaluateKitScan,
  scopedKitLines, valueInputFor, legacyKey, stepShowsKit, collectStepTriggers,
  INPUT_WIDGET_TYPES, REQUIRED_WIDGET_TYPES, requiredMissing, requiredMessage,
} from '../runtime';

function widget(partial: Partial<Widget> & { id: string; type: Widget['type'] }): Widget {
  return { label: '', order: 0, config: {}, ...partial } as Widget;
}

function step(widgets: Widget[], partial: Partial<Step> = {}): Step {
  return { id: 's1', name: 'Step 1', order: 0, widgets, ...partial };
}

function kitLine(partial: Partial<KitLine> & { id: string }): KitLine {
  return {
    kit_id: 'k1', bom_line_id: null, item_id: 'i1', item_name: 'Widget bracket',
    sku: 'SKU-1', qty_required: 2, qty_picked: 0, unit: 'ea', scan_code: '',
    reference: '', step_id: '', status: 'pending', picked_by: '', picked_at: null,
    verified_by: '', verified_at: null, short_reason: '', sort_order: 0, notes: '',
    ...partial,
  };
}

describe('required means required (every type the builder offers it on)', () => {
  it('gates the text/number/select/checkbox core exactly as v1 did', () => {
    const s = step([
      widget({ id: 'w1', type: 'text-input', label: 'Serial', config: { required: true } }),
      widget({ id: 'w2', type: 'checkbox', label: 'Confirmed', config: { required: true } }),
    ]);
    let blocks = getStepBlocks(s, {}, null, null);
    expect(blocks.map(b => b.widgetId)).toEqual(['w1', 'w2']);

    blocks = getStepBlocks(s, { w1: 'ABC', w2: true }, null, null);
    expect(blocks).toHaveLength(0);

    // checkbox false (not just missing) still blocks — v1 semantics
    blocks = getStepBlocks(s, { w1: 'ABC', w2: false }, null, null);
    expect(blocks.map(b => b.widgetId)).toEqual(['w2']);
  });

  // The bug this table closes: the builder offered "Required field" on nine
  // widget types and the player enforced six, so a required pass-fail,
  // signature or counter was decoration. The seeded QC app completed with
  // `qc_result` absent — the plant's final quality gate booking a unit as good
  // with no inspection result in it.
  const EMPTY_AND_SATISFIED: Record<string, { empty: unknown; filled: unknown }> = {
    'text-input':    { empty: '',        filled: 'ABC' },
    'number-input':  { empty: '',        filled: '12' },
    'select-input':  { empty: undefined, filled: 'Option 1' },
    'checkbox':      { empty: false,     filled: true },
    'counter':       { empty: undefined, filled: 0 },   // a committed zero counts
    'pass-fail':     { empty: undefined, filled: 'Pass' },
    'signature':     { empty: '',        filled: 'M. Lopez' },
    'scan-input':    { empty: '',        filled: 'LOT-0001' },
    'photo-capture': { empty: undefined, filled: '/uploads/a.jpg' },
  };

  it.each(INPUT_WIDGET_TYPES)('blocks a required, empty %s', type => {
    const fixture = EMPTY_AND_SATISFIED[type];
    expect(fixture, `no fixture for input type ${type} — add one and make it gate`).toBeDefined();
    const w = widget({ id: 'w', type, label: 'Ships as-is?', config: { required: true } });
    const blocks = getStepBlocks(step([w]), { w: fixture.empty }, null, null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ widgetId: 'w', kind: 'required' });
    expect(blocks[0].message).toContain('Ships as-is?');   // named, always

    expect(getStepBlocks(step([w]), { w: fixture.filled }, null, null)).toHaveLength(0);
  });

  it.each(INPUT_WIDGET_TYPES)('leaves an OPTIONAL %s alone', type => {
    const w = widget({ id: 'w', type, config: {} });
    expect(getStepBlocks(step([w]), {}, null, null)).toHaveLength(0);
  });

  it('gates every type the builder offers "Required" on — no drift', () => {
    // Adding a tenth input type without gating it fails here.
    for (const t of INPUT_WIDGET_TYPES) {
      expect(REQUIRED_WIDGET_TYPES).toContain(t);
    }
    expect(INPUT_WIDGET_TYPES).toHaveLength(9);
    // ... and nothing gates that the builder never offered it on.
    for (const t of REQUIRED_WIDGET_TYPES) {
      expect(INPUT_WIDGET_TYPES).toContain(t);
    }
  });

  // An honest zero is an answer. "Defects found" on a counter that starts at 0
  // and cannot go below it has 0 as its most common true value; requiring the
  // number to have MOVED stranded that run with no way out at all — the minus
  // button was disabled and the plus button was a lie. Touching the counter is
  // the test, and CounterWidget commits on every tap, including at the ends of
  // the range, so confirming a zero is one tap.
  it('a required counter is satisfied by an honest zero, once it is confirmed', () => {
    const w = widget({ id: 'c', type: 'counter', label: 'Defects found', config: { required: true, initialValue: 0, min: 0 } });
    expect(requiredMissing(w, undefined)).toBe(true);     // untouched — nothing recorded
    expect(requiredMissing(w, 0)).toBe(false);            // confirmed zero — an answer
    expect(requiredMissing(w, 4)).toBe(false);
    expect(requiredMessage(w)).toBe('Defects found needs a count — tap + or − to confirm');
    // Blocks the step while untouched, clears the moment a zero is committed.
    expect(getStepBlocks(step([w]), {}, null, null)).toHaveLength(1);
    expect(getStepBlocks(step([w]), { c: 0 }, null, null)).toHaveLength(0);

    const fromFive = widget({ id: 'c', type: 'counter', label: 'Cores', config: { required: true, initialValue: 5 } });
    expect(requiredMissing(fromFive, 5)).toBe(false);
    expect(requiredMissing(fromFive, undefined)).toBe(true);
  });

  it('a required signature needs a captured stroke', () => {
    const w = widget({ id: 'sg', type: 'signature', label: 'Inspector', config: { required: true } });
    expect(getStepBlocks(step([w]), { sg: '' }, null, null)[0].message).toBe('Inspector needs a signature');
    expect(getStepBlocks(step([w]), { sg: 'M. Lopez' }, null, null)).toHaveLength(0);
  });

  it('names the widget in the operator\'s words, per type', () => {
    const msg = (type: Parameters<typeof widget>[0]['type'], config = {}) =>
      requiredMessage(widget({ id: 'w', type, label: 'Ships as-is?', config }));
    expect(msg('pass-fail')).toBe('Ships as-is? needs a result');
    expect(msg('photo-capture')).toBe('Ships as-is? needs a photo');
    expect(msg('scan-input')).toBe('Ships as-is? needs a scan');
    expect(msg('select-input')).toBe('Ships as-is? needs a choice');
    expect(msg('checkbox')).toBe('Ships as-is? needs to be checked');
    expect(msg('text-input')).toBe('Ships as-is? is required');
    // Hand-authored apps put the label in config; the message still names it.
    expect(requiredMessage(widget({ id: 'w', type: 'pass-fail', config: { label: 'Ships as-is?' } })))
      .toBe('Ships as-is? needs a result');
    expect(requiredMessage(widget({ id: 'w', type: 'text-input', config: {} })))
      .toBe('This field is required');
  });

  it('uses variableName as the formData key (legacy key parity)', () => {
    const w = widget({ id: 'w1', type: 'text-input', config: { required: true, variableName: 'serial' } });
    expect(legacyKey(w)).toBe('serial');
    expect(getStepBlocks(step([w]), { serial: 'X' }, null, null)).toHaveLength(0);
    expect(getStepBlocks(step([w]), { w1: 'X' }, null, null)).toHaveLength(1);
  });

  it('blocks number-input out of range only when enforceRange is set', () => {
    const enforced = widget({ id: 'n1', type: 'number-input', label: 'Torque', config: { min: 10, max: 20, enforceRange: true } });
    const soft = widget({ id: 'n2', type: 'number-input', label: 'Loose', config: { min: 10, max: 20 } });
    const s = step([enforced, soft]);
    const blocks = getStepBlocks(s, { n1: '25', n2: '25' }, null, null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].widgetId).toBe('n1');
    expect(blocks[0].kind).toBe('range');
    expect(getStepBlocks(s, { n1: '15', n2: '99' }, null, null)).toHaveLength(0);
  });

  it('blocks scan-input on expectedPattern mismatch', () => {
    const w = widget({ id: 'sc1', type: 'scan-input', label: 'Lot', config: { expectedPattern: '^LOT-\\d{4}$' } });
    expect(getStepBlocks(step([w]), { sc1: 'LOT-1234' }, null, null)).toHaveLength(0);
    const blocks = getStepBlocks(step([w]), { sc1: 'nope' }, null, null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('pattern');
  });

  it('an invalid authored regex never traps the operator', () => {
    const w = widget({ id: 'sc1', type: 'scan-input', config: { expectedPattern: '([' } });
    expect(getStepBlocks(step([w]), { sc1: 'anything' }, null, null)).toHaveLength(0);
  });

  it('require_photo gate blocks until a photo-capture widget has a photo', () => {
    const w = widget({ id: 'p1', type: 'photo-capture', label: 'Evidence' });
    const s = step([w]);
    let blocks = getStepBlocks(s, {}, 'Photo of the weld required', null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('photo');
    blocks = getStepBlocks(s, { p1: '/uploads/x.jpg' }, 'Photo of the weld required', null);
    expect(blocks).toHaveLength(0);
  });

  it('kit gate blocks until every line is done; picked counts unless requireScan', () => {
    const lines = [
      kitLine({ id: 'l1', status: 'verified' }),
      kitLine({ id: 'l2', status: 'picked' }),
    ];
    expect(getStepBlocks(step([]), {}, null, { gated: true, lines, requireScan: false })).toHaveLength(0);
    const strict = getStepBlocks(step([]), {}, null, { gated: true, lines, requireScan: true });
    expect(strict).toHaveLength(1);
    expect(strict[0].kind).toBe('kit');
  });

  it('short lines keep the kit gate blocked and are named in the reason', () => {
    const lines = [kitLine({ id: 'l1', status: 'verified' }), kitLine({ id: 'l2', status: 'short' })];
    const blocks = getStepBlocks(step([]), {}, null, { gated: true, lines, requireScan: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].message).toContain('1 short');
    expect(summarizeBlocks(blocks)).toContain('Kit incomplete');
  });

  it('summarizes multiple required fields compactly', () => {
    const s = step([
      widget({ id: 'a', type: 'text-input', config: { required: true } }),
      widget({ id: 'b', type: 'select-input', config: { required: true, options: ['x'] } }),
    ]);
    expect(summarizeBlocks(getStepBlocks(s, {}, null, null))).toBe('2 required fields');
  });
});

describe('kit progress + scan chain (spec §5.4)', () => {
  const lines = [
    kitLine({ id: 'l1', sku: 'SKU-1', status: 'pending' }),
    kitLine({ id: 'l2', sku: 'SKU-2', scan_code: 'CODE-2', status: 'verified' }),
    kitLine({ id: 'l3', sku: 'SKU-3', status: 'short', step_id: 'sA' }),
    kitLine({ id: 'l4', sku: 'SKU-4', status: 'picked', step_id: 'sB' }),
  ];

  it('rolls up progress with and without requireScan', () => {
    const loose = kitProgress(lines, false);
    expect(loose).toMatchObject({ total: 4, verified: 1, picked: 1, short: 1, done: 2, remaining: 1, complete: false });
    const strict = kitProgress(lines, true);
    expect(strict.done).toBe(1);
    expect(kitProgress([kitLine({ id: 'x', status: 'picked' })], false).complete).toBe(true);
    expect(kitProgress([], false).complete).toBe(false);
  });

  it('verifies by sku or scan_code, case-insensitive', () => {
    expect(evaluateKitScan(lines, 'sku-1', null)).toMatchObject({ type: 'verified', line: { id: 'l1' } });
    expect(evaluateKitScan(lines, 'CODE-2', null)).toMatchObject({ type: 'already' });
    expect(evaluateKitScan(lines, 'UNKNOWN', null)).toEqual({ type: 'unknown' });
  });

  it('reports wrong step for out-of-scope lines when step-scoped', () => {
    const res = evaluateKitScan(lines, 'SKU-4', 'sA');
    expect(res.type).toBe('wrong_step');
  });

  it('scopes checklist lines per step, keeping whole-process lines visible', () => {
    expect(scopedKitLines(lines, 'all', 'sA')).toHaveLength(4);
    const scoped = scopedKitLines(lines, 'step', 'sA');
    expect(scoped.map(l => l.id)).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('rich capture mapping (spec §5.3)', () => {
  const s = step([]);

  it('maps each widget type to its completion_values row', () => {
    expect(valueInputFor(s, widget({ id: 'w', type: 'text-input', config: { variableName: 'serial' } }), 'ABC'))
      .toEqual({ step_id: 's1', widget_id: 'w', variable_name: 'serial', value_type: 'text', value_text: 'ABC' });
    expect(valueInputFor(s, widget({ id: 'w', type: 'number-input' }), '12.5'))
      .toMatchObject({ value_type: 'number', value_number: 12.5 });
    expect(valueInputFor(s, widget({ id: 'w', type: 'checkbox' }), true))
      .toMatchObject({ value_type: 'boolean', value_number: 1 });
    expect(valueInputFor(s, widget({ id: 'w', type: 'pass-fail' }), 'Pass'))
      .toMatchObject({ value_type: 'pass_fail', value_text: 'pass' });
    expect(valueInputFor(s, widget({ id: 'w', type: 'pass-fail' }), 'Fail'))
      .toMatchObject({ value_type: 'pass_fail', value_text: 'fail' });
    expect(valueInputFor(s, widget({ id: 'w', type: 'scan-input' }), 'LOT-1'))
      .toMatchObject({ value_type: 'scan', value_text: 'LOT-1' });
    expect(valueInputFor(s, widget({ id: 'w', type: 'photo-capture' }), '/a.jpg,/b.jpg'))
      .toMatchObject({ value_type: 'photo', value_text: '/a.jpg,/b.jpg' });
    expect(valueInputFor(s, widget({ id: 'w', type: 'timer' }), 42))
      .toMatchObject({ value_type: 'timer', value_number: 42 });
    expect(valueInputFor(s, widget({ id: 'w', type: 'counter' }), 7))
      .toMatchObject({ value_type: 'number', value_number: 7 });
  });

  it('skips display widgets and empty values', () => {
    expect(valueInputFor(s, widget({ id: 'w', type: 'text' }), 'hi')).toBeNull();
    expect(valueInputFor(s, widget({ id: 'w', type: 'variable-display' }), 'x')).toBeNull();
    expect(valueInputFor(s, widget({ id: 'w', type: 'text-input' }), '')).toBeNull();
    expect(valueInputFor(s, widget({ id: 'w', type: 'number-input' }), 'abc')).toBeNull();
  });
});

describe('step helpers', () => {
  it('detects kit chrome from step_type or a kit-checklist widget', () => {
    expect(stepShowsKit(step([], { step_type: 'kit' }))).toBe(true);
    expect(stepShowsKit(step([widget({ id: 'k', type: 'kit-checklist' })]))).toBe(true);
    expect(stepShowsKit(step([]))).toBe(false);
  });

  it('collects widget triggers before step triggers', () => {
    const t1 = { id: 't1', event: 'button_press' as const, match: 'all' as const, conditions: [], actions: [] };
    const t2 = { id: 't2', event: 'step_exit' as const, match: 'all' as const, conditions: [], actions: [] };
    const s = step([widget({ id: 'w', type: 'button', triggers: [t1] })], { triggers: [t2] });
    expect(collectStepTriggers(s).map(t => t.id)).toEqual(['t1', 't2']);
  });
});
