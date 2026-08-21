import { describe, it, expect } from 'vitest';
import type { App, PartItem, Step, Trigger, Widget } from '../../types';
import { normalizeApp } from '../normalize';

// ─── Real v1 seed blob ────────────────────────────────────────────────────────
// Extracted verbatim from backend/src/db.js seedAppData() ("Widget Assembly
// Process", the app every fresh install boots with). Only the uuidv4() calls
// are replaced with deterministic ids so assertions can reference them. Note
// the v1-era `takt_time` key (not `takt_time_seconds`) — a real legacy quirk
// the shim must pass through untouched.

function makeSeedV1App(): App {
  const raw = {
    id: 'app-widget-assembly',
    name: 'Widget Assembly Process',
    description: 'Standard assembly process for widget production line',
    status: 'published',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    variables: [],
    steps: [
      {
        id: 'step-safety', name: 'Safety Check', order: 0, takt_time: 60,
        widgets: [
          { id: 'w-safety-instruction', type: 'instruction', order: 0, label: 'Safety Instructions', config: { content: 'Ensure all safety equipment is in place before starting. Wear PPE including gloves and safety glasses.', backgroundColor: '#fef3c7' } },
          { id: 'w-ppe', type: 'checkbox', order: 1, label: 'PPE Worn', config: { required: true, variableName: 'ppe_worn' } },
          { id: 'w-area', type: 'checkbox', order: 2, label: 'Work Area Clear', config: { required: true, variableName: 'area_clear' } },
          { id: 'w-btn-safety', type: 'button', order: 3, label: '', config: { buttonText: 'Proceed to Assembly', buttonType: 'next', buttonColor: '#22c55e' } },
        ],
      },
      {
        id: 'step-inspection', name: 'Part Inspection', order: 1, takt_time: 120,
        widgets: [
          { id: 'w-inspect-text', type: 'text', order: 0, label: '', config: { text: 'Inspect incoming parts for defects before assembly.', fontSize: 16, color: '#374151' } },
          { id: 'w-condition', type: 'select-input', order: 1, label: 'Part Condition', config: { required: true, variableName: 'part_condition', options: ['Good', 'Minor Defect', 'Major Defect', 'Reject'] } },
          { id: 'w-serial', type: 'text-input', order: 2, label: 'Part Serial Number', config: { required: true, variableName: 'serial_number', placeholder: 'Scan or enter serial number' } },
          { id: 'w-visual', type: 'pass-fail', order: 3, label: 'Visual Inspection', config: { variableName: 'visual_inspection' } },
          { id: 'w-btn-inspection', type: 'button', order: 4, label: '', config: { buttonText: 'Next Step', buttonType: 'next', buttonColor: '#3b82f6' } },
        ],
      },
      {
        id: 'step-assembly', name: 'Assembly', order: 2, takt_time: 300,
        widgets: [
          { id: 'w-assembly-instruction', type: 'instruction', order: 0, label: 'Assembly Instructions', config: { content: '1. Place base component on fixture\n2. Apply torque to 15 Nm\n3. Attach side panels using M6 bolts\n4. Verify alignment before final tightening', backgroundColor: '#eff6ff' } },
          { id: 'w-bolt-count', type: 'counter', order: 1, label: 'Bolt Count', config: { variableName: 'bolt_count', min: 0, max: 8, step: 1, initialValue: 0 } },
          { id: 'w-torque', type: 'number-input', order: 2, label: 'Torque Value (Nm)', config: { required: true, variableName: 'torque_value', placeholder: '15' } },
          { id: 'w-btn-assembly', type: 'button', order: 3, label: '', config: { buttonText: 'Assembly Complete', buttonType: 'next', buttonColor: '#3b82f6' } },
        ],
      },
      {
        id: 'step-quality', name: 'Quality Check', order: 3, takt_time: 180,
        widgets: [
          { id: 'w-qc-text', type: 'text', order: 0, label: '', config: { text: 'Perform final quality inspection', fontSize: 18, fontWeight: 'bold', color: '#111827' } },
          { id: 'w-dim-check', type: 'pass-fail', order: 1, label: 'Dimensional Check', config: { variableName: 'dim_check' } },
          { id: 'w-func-test', type: 'pass-fail', order: 2, label: 'Functional Test', config: { variableName: 'func_test' } },
          { id: 'w-notes', type: 'text-input', order: 3, label: 'Inspector Notes', config: { variableName: 'inspector_notes', placeholder: 'Enter any observations...' } },
          { id: 'w-btn-complete', type: 'button', order: 4, label: '', config: { buttonText: 'Complete Process', buttonType: 'complete', buttonColor: '#22c55e' } },
        ],
      },
    ],
  };
  // The v1 blob carries legacy keys (takt_time) not present on the v2 Step
  // type — exactly what arrives from the API for a legacy app.
  return raw as unknown as App;
}

function widgetById(app: App, stepId: string, widgetId: string): Widget {
  const step = app.steps.find(s => s.id === stepId);
  if (!step) throw new Error(`step ${stepId} not found`);
  const widget = step.widgets.find(w => w.id === widgetId);
  if (!widget) throw new Error(`widget ${widgetId} not found`);
  return widget;
}

describe('normalizeApp — real v1 seed blob', () => {
  it('upgrades the blob to schema_version 2 with empty step_groups', () => {
    const out = normalizeApp(makeSeedV1App());
    expect(out.schema_version).toBe(2);
    expect(out.step_groups).toEqual([]);
    expect(out.variables).toEqual([]);
  });

  it('keeps all steps: ids, names, order, and count unchanged', () => {
    const out = normalizeApp(makeSeedV1App());
    expect(out.steps).toHaveLength(4);
    expect(out.steps.map(s => s.id)).toEqual(['step-safety', 'step-inspection', 'step-assembly', 'step-quality']);
    expect(out.steps.map(s => s.name)).toEqual(['Safety Check', 'Part Inspection', 'Assembly', 'Quality Check']);
    expect(out.steps.map(s => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('defaults every v1 step to flow layout and empty step triggers', () => {
    const out = normalizeApp(makeSeedV1App());
    for (const step of out.steps) {
      expect(step.layoutMode).toBe('flow');
      expect(step.triggers).toEqual([]);
    }
  });

  it('preserves legacy extra keys like takt_time via spread', () => {
    const out = normalizeApp(makeSeedV1App());
    const taktTimes = out.steps.map(s => (s as unknown as Record<string, unknown>).takt_time);
    expect(taktTimes).toEqual([60, 120, 300, 180]);
  });

  it("synthesizes a next_step trigger for every legacy buttonType:'next' button", () => {
    const out = normalizeApp(makeSeedV1App());
    for (const [stepId, widgetId] of [
      ['step-safety', 'w-btn-safety'],
      ['step-inspection', 'w-btn-inspection'],
      ['step-assembly', 'w-btn-assembly'],
    ] as const) {
      const btn = widgetById(out, stepId, widgetId);
      expect(btn.triggers).toEqual([{
        id: `legacy_${widgetId}`,
        event: 'button_press',
        conditions: [],
        match: 'all',
        actions: [{ type: 'next_step' }],
      }]);
    }
  });

  it("synthesizes a complete_app trigger for the legacy buttonType:'complete' button", () => {
    const out = normalizeApp(makeSeedV1App());
    const btn = widgetById(out, 'step-quality', 'w-btn-complete');
    expect(btn.triggers).toEqual([{
      id: 'legacy_w-btn-complete',
      event: 'button_press',
      conditions: [],
      match: 'all',
      actions: [{ type: 'complete_app' }],
    }]);
  });

  it('gives every non-button widget an empty triggers array', () => {
    const out = normalizeApp(makeSeedV1App());
    for (const step of out.steps) {
      for (const w of step.widgets) {
        if (w.type !== 'button') expect(w.triggers).toEqual([]);
      }
    }
  });

  it('leaves widget configs byte-identical (buttonType, colors, variableName, options…)', () => {
    const raw = makeSeedV1App();
    const out = normalizeApp(makeSeedV1App());
    for (const step of raw.steps) {
      for (const w of step.widgets) {
        const normalized = widgetById(out, step.id, w.id);
        expect(normalized.config).toEqual(w.config);
        expect(normalized.type).toBe(w.type);
        expect(normalized.label).toBe(w.label);
        expect(normalized.order).toBe(w.order);
      }
    }
    // spot checks on the fields v1 behavior depends on
    expect(widgetById(out, 'step-safety', 'w-btn-safety').config.buttonType).toBe('next');
    expect(widgetById(out, 'step-quality', 'w-btn-complete').config.buttonColor).toBe('#22c55e');
    expect(widgetById(out, 'step-inspection', 'w-condition').config.options)
      .toEqual(['Good', 'Minor Defect', 'Major Defect', 'Reject']);
  });

  it('does not mutate the input blob', () => {
    const input = makeSeedV1App();
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    normalizeApp(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it('is idempotent: normalizing the normalized output changes nothing', () => {
    const once = normalizeApp(makeSeedV1App());
    const twice = normalizeApp(once);
    expect(twice).toEqual(once);
    // and a third pass for good measure
    expect(normalizeApp(twice)).toEqual(once);
  });
});

describe('normalizeApp — legacy edge cases', () => {
  function v1Button(buttonType?: 'next' | 'prev' | 'complete' | 'custom'): App {
    const app = makeSeedV1App();
    const btn: Widget = {
      id: 'w-edge-btn', type: 'button', order: 0, label: '',
      config: buttonType === undefined ? { buttonText: 'Go' } : { buttonText: 'Go', buttonType },
    };
    app.steps[0].widgets = [btn];
    return app;
  }

  it("buttonType:'prev' synthesizes prev_step", () => {
    const out = normalizeApp(v1Button('prev'));
    expect(out.steps[0].widgets[0].triggers).toEqual([{
      id: 'legacy_w-edge-btn', event: 'button_press', conditions: [], match: 'all',
      actions: [{ type: 'prev_step' }],
    }]);
  });

  it("buttonType:'custom' synthesizes no trigger (empty array)", () => {
    const out = normalizeApp(v1Button('custom'));
    expect(out.steps[0].widgets[0].triggers).toEqual([]);
  });

  it("a button without buttonType defaults to 'next' (v1 behavior)", () => {
    const out = normalizeApp(v1Button(undefined));
    expect(out.steps[0].widgets[0].triggers).toEqual([{
      id: 'legacy_w-edge-btn', event: 'button_press', conditions: [], match: 'all',
      actions: [{ type: 'next_step' }],
    }]);
  });

  it('preserves parts_list on v1 steps untouched', () => {
    const app = makeSeedV1App();
    const parts: PartItem[] = [
      { name: 'M6 Bolt', sku: 'FAS-M6-012', quantity: 8, unit: 'ea', notes: 'zinc plated' },
      { name: 'Side Panel', quantity: 2 },
    ];
    app.steps[2].parts_list = parts;
    const out = normalizeApp(app);
    expect(out.steps[2].parts_list).toEqual(parts);
    // idempotent with parts_list present too
    expect(normalizeApp(out).steps[2].parts_list).toEqual(parts);
  });

  it('assigns order from the array index when a v1 step lacks one', () => {
    const app = makeSeedV1App();
    const steps = app.steps as unknown as Array<Record<string, unknown>>;
    for (const s of steps) delete s.order;
    const out = normalizeApp(app);
    expect(out.steps.map(s => s.order)).toEqual([0, 1, 2, 3]);
  });

  it('keeps an explicit canvas layoutMode instead of forcing flow', () => {
    const app = makeSeedV1App();
    app.steps[1].layoutMode = 'canvas';
    app.steps[1].canvasHeight = 900;
    const out = normalizeApp(app);
    expect(out.steps[1].layoutMode).toBe('canvas');
    expect(out.steps[1].canvasHeight).toBe(900);
    expect(out.steps[0].layoutMode).toBe('flow');
  });

  it('tolerates a blob with missing steps/widgets arrays', () => {
    const bare = { id: 'x', name: 'X', description: '', status: 'draft' } as unknown as App;
    const out = normalizeApp(bare);
    expect(out.steps).toEqual([]);
    expect(out.variables).toEqual([]);
    expect(out.step_groups).toEqual([]);
    expect(out.schema_version).toBe(2);

    const noWidgets = {
      ...makeSeedV1App(),
      steps: [{ id: 's', name: 'S', order: 0 }],
    } as unknown as App;
    expect(normalizeApp(noWidgets).steps[0].widgets).toEqual([]);
  });
});

describe('normalizeApp — already-v2 data', () => {
  function makeV2App(): App {
    const authored: Trigger = {
      id: 'trg-1', name: 'Fail routes to rework', event: 'input_change', match: 'any',
      conditions: [{ left: { kind: 'widget', name: 'w-visual' }, op: 'eq', right: { kind: 'static', value: 'fail' } }],
      actions: [
        { type: 'create_ncr', severity: 'major', title: 'Visual fail on {{serial_number}}' },
        { type: 'go_to_step', stepId: 'step-rework' },
      ],
    };
    const buttonTrigger: Trigger = {
      id: 'trg-2', event: 'button_press', match: 'all', conditions: [],
      actions: [{ type: 'complete_app' }],
    };
    const steps: Step[] = [
      {
        id: 'step-main', name: 'Main', order: 0, layoutMode: 'canvas', canvasHeight: 800,
        group_id: 'grp-1', step_type: 'kit',
        triggers: [{ id: 'trg-3', event: 'step_enter', match: 'all', conditions: [], actions: [{ type: 'show_message', level: 'info', text: 'hi' }] }],
        widgets: [
          { id: 'w-visual', type: 'pass-fail', order: 0, label: 'Visual', config: { variableName: 'visual' }, triggers: [authored] },
          { id: 'w-done', type: 'button', order: 1, label: '', config: { buttonText: 'Done', buttonType: 'complete' }, triggers: [buttonTrigger] },
        ],
      },
      { id: 'step-rework', name: 'Rework', order: 1, widgets: [], triggers: [], layoutMode: 'flow' },
    ];
    return {
      id: 'app-v2', name: 'V2 App', description: '', status: 'published',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      schema_version: 2,
      step_groups: [{ id: 'grp-1', name: 'Build', order: 0 }],
      variables: [{ id: 'v1', name: 'serial_number', type: 'text', defaultValue: '' }],
      steps,
    };
  }

  it('passes an already-v2 blob through unchanged (idempotent on v2 data)', () => {
    const v2 = makeV2App();
    const out = normalizeApp(v2);
    expect(out).toEqual({ ...v2, schema_version: 2 });
    expect(normalizeApp(out)).toEqual(out);
  });

  it('does not overwrite authored triggers on a button with a legacy synthesis', () => {
    const out = normalizeApp(makeV2App());
    const btn = out.steps[0].widgets[1];
    expect(btn.triggers).toHaveLength(1);
    expect(btn.triggers?.[0].id).toBe('trg-2');
  });

  it('preserves step groups, group_id, step_type, and app variables', () => {
    const out = normalizeApp(makeV2App());
    expect(out.step_groups).toEqual([{ id: 'grp-1', name: 'Build', order: 0 }]);
    expect(out.steps[0].group_id).toBe('grp-1');
    expect(out.steps[0].step_type).toBe('kit');
    expect(out.variables).toEqual([{ id: 'v1', name: 'serial_number', type: 'text', defaultValue: '' }]);
  });
});
