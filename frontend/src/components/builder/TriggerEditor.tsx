// ─── Trigger editor — When / If / Then (spec §3.3) ────────────────────────────
// Modal panel (--shadow-pop, --r-card) with three stacked clause sections.
// Left-to-right dropdown composition, Tulip style. Round-trips every §3.1
// trigger shape without loss.

import { useEffect, useMemo, useState } from 'react';
import {
  Zap, X, Plus, Trash2, GripVertical, AlertCircle,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  App, MESTable, NCRSeverity, Step, Trigger, TriggerAction, TriggerCondition,
  TriggerEvent, TriggerOp, ValueRef, Widget,
} from '../../types';
import { api } from '../../api/client';
import { v4 as uuidv4 } from '../../utils/uuid';
import { INPUT_WIDGET_TYPES, WIDGET_META } from './WidgetPalette';

// ── Attachment point ──────────────────────────────────────────────────────────

export type TriggerAttachment =
  | { kind: 'widget'; widget: Widget; step: Step }
  | { kind: 'step'; step: Step };

/** Events legal for an attachment point (spec §3.3 WHEN filtering). */
export function eventsFor(att: TriggerAttachment): TriggerEvent[] {
  if (att.kind === 'step') return ['step_enter', 'step_exit', 'timer_done', 'scan'];
  const t = att.widget.type;
  if (t === 'button') return ['button_press'];
  if (t === 'timer') return ['timer_done'];
  if (t === 'scan-input') return ['scan', 'input_change'];
  if (INPUT_WIDGET_TYPES.includes(t)) return ['input_change'];
  return [];
}

const EVENT_LABEL: Record<TriggerEvent, string> = {
  button_press: 'this button is pressed',
  step_enter: 'the step is entered',
  step_exit: 'the step is exited',
  input_change: 'this input changes',
  timer_done: 'the timer completes',
  scan: 'a code is scanned',
};

const APP_INFO_KEYS: { key: NonNullable<ValueRef['key']>; label: string }[] = [
  { key: 'operator', label: 'Operator' },
  { key: 'work_order_number', label: 'Work order #' },
  { key: 'part_number', label: 'Part number' },
  { key: 'quantity', label: 'WO quantity' },
  { key: 'quantity_completed', label: 'WO qty completed' },
  { key: 'product_type', label: 'Product type' },
  { key: 'station', label: 'Station' },
  { key: 'elapsed_seconds', label: 'Elapsed (s)' },
  { key: 'step_elapsed_seconds', label: 'Step elapsed (s)' },
  { key: 'scanned_code', label: 'Scanned code' },
];

const COMPARE_OPS: { op: TriggerOp; label: string }[] = [
  { op: 'eq', label: '=' }, { op: 'neq', label: '≠' },
  { op: 'gt', label: '>' }, { op: 'gte', label: '≥' },
  { op: 'lt', label: '<' }, { op: 'lte', label: '≤' },
  { op: 'contains', label: 'contains' },
  { op: 'is_blank', label: 'is blank' }, { op: 'not_blank', label: 'is not blank' },
];
const KIT_OPS: { op: TriggerOp; label: string }[] = [
  { op: 'kit_complete', label: 'kit is complete' },
  { op: 'kit_has_short', label: 'kit has a short line' },
];
const NO_OPERAND_OPS: TriggerOp[] = ['is_blank', 'not_blank', 'kit_complete', 'kit_has_short'];

type ConditionSource = 'variable' | 'widget' | 'app_info' | 'kit';

type ActionCategory = 'navigate' | 'data' | 'quality' | 'feedback';
const CATEGORY_OF: Record<TriggerAction['type'], ActionCategory> = {
  go_to_step: 'navigate', next_step: 'navigate', prev_step: 'navigate', complete_app: 'navigate',
  set_variable: 'data', save_record: 'data',
  require_photo: 'quality', create_ncr: 'quality',
  show_message: 'feedback', block_with_error: 'feedback',
};
const CATEGORY_LABEL: Record<ActionCategory, string> = {
  navigate: 'Navigate', data: 'Data', quality: 'Quality', feedback: 'Feedback',
};
const ACTIONS_IN: Record<ActionCategory, { type: TriggerAction['type']; label: string }[]> = {
  navigate: [
    { type: 'next_step', label: 'Go to next step' },
    { type: 'prev_step', label: 'Go to previous step' },
    { type: 'go_to_step', label: 'Go to step…' },
    { type: 'complete_app', label: 'Complete app' },
  ],
  data: [
    { type: 'set_variable', label: 'Set variable' },
    { type: 'save_record', label: 'Save record to table' },
  ],
  quality: [
    { type: 'require_photo', label: 'Require photo' },
    { type: 'create_ncr', label: 'Create NCR' },
  ],
  feedback: [
    { type: 'show_message', label: 'Show message' },
    { type: 'block_with_error', label: 'Block with error' },
  ],
};

const isNav = (a: TriggerAction) => CATEGORY_OF[a.type] === 'navigate';

function defaultAction(type: TriggerAction['type'], app: App): TriggerAction {
  switch (type) {
    case 'go_to_step': return { type, stepId: app.steps[0]?.id ?? '' };
    case 'next_step': return { type };
    case 'prev_step': return { type };
    case 'complete_app': return { type };
    case 'set_variable': return { type, name: app.variables?.[0]?.name ?? '', value: { kind: 'static', value: '' } };
    case 'save_record': return { type, tableId: '', fields: {} };
    case 'require_photo': return { type, message: '' };
    case 'create_ncr': return { type, severity: 'minor', title: '' };
    case 'show_message': return { type, level: 'info', text: '' };
    case 'block_with_error': return { type, text: '' };
  }
}

/** Coerce a static input string: numeric → number, true/false → boolean. */
function coerceStatic(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

// ── Shared small controls ─────────────────────────────────────────────────────

const sel = 'wb-input !min-h-0 !py-1.5 !w-auto';
const inp = 'wb-input !min-h-0 !py-1.5';

interface WidgetOption { id: string; label: string; }

function collectInputWidgets(app: App): WidgetOption[] {
  const out: WidgetOption[] = [];
  app.steps.forEach((s, i) => {
    for (const w of s.widgets) {
      if (INPUT_WIDGET_TYPES.includes(w.type)) {
        out.push({ id: w.id, label: `S${i + 1} · ${w.label || WIDGET_META[w.type]?.label || w.type}` });
      }
    }
  });
  return out;
}

/** Compact editor for one ValueRef (the right side of conditions, set_variable
 *  values, save_record field mappings). */
function ValueRefEditor({ value, onChange, app, widgets, allowWidget = true }: {
  value: ValueRef | undefined;
  onChange: (v: ValueRef) => void;
  app: App;
  widgets: WidgetOption[];
  allowWidget?: boolean;
}) {
  const kind = value?.kind ?? 'static';
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        className={sel}
        style={{ fontSize: 12.5 }}
        value={kind}
        onChange={e => {
          const k = e.target.value as ValueRef['kind'];
          if (k === 'static') onChange({ kind: 'static', value: '' });
          else if (k === 'variable') onChange({ kind: 'variable', name: app.variables?.[0]?.name ?? '' });
          else if (k === 'widget') onChange({ kind: 'widget', name: widgets[0]?.id ?? '' });
          else onChange({ kind: 'app_info', key: 'operator' });
        }}
      >
        <option value="static">Value</option>
        <option value="variable">Variable</option>
        {allowWidget && <option value="widget">Input widget</option>}
        <option value="app_info">App info</option>
      </select>
      {kind === 'static' && (
        <input
          className={inp}
          style={{ fontSize: 12.5, width: 130 }}
          placeholder="value"
          value={value?.value === undefined ? '' : String(value.value)}
          onChange={e => onChange({ kind: 'static', value: coerceStatic(e.target.value) })}
        />
      )}
      {kind === 'variable' && (
        <select className={`${sel} font-mono`} style={{ fontSize: 12 }} value={value?.name ?? ''} onChange={e => onChange({ kind: 'variable', name: e.target.value })}>
          <option value="">— variable —</option>
          {(app.variables ?? []).map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
      )}
      {kind === 'widget' && (
        <select className={sel} style={{ fontSize: 12.5 }} value={value?.name ?? ''} onChange={e => onChange({ kind: 'widget', name: e.target.value })}>
          <option value="">— widget —</option>
          {widgets.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      )}
      {kind === 'app_info' && (
        <select className={sel} style={{ fontSize: 12.5 }} value={value?.key ?? 'operator'} onChange={e => onChange({ kind: 'app_info', key: e.target.value as ValueRef['key'] })}>
          {APP_INFO_KEYS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      )}
    </span>
  );
}

// ─── The editor ───────────────────────────────────────────────────────────────

export default function TriggerEditor({ app, attachment, initial, onSave, onDelete, onClose }: {
  app: App;
  attachment: TriggerAttachment;
  initial: Trigger | null;
  onSave: (trigger: Trigger) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const events = eventsFor(attachment);
  const [draft, setDraft] = useState<Trigger>(() => initial ? {
    ...initial,
    conditions: initial.conditions.map(c => ({ ...c })),
    actions: initial.actions.map(a => ({ ...a })),
  } : {
    id: uuidv4(), name: '', event: events[0] ?? 'button_press',
    match: 'all', conditions: [], actions: [], enabled: true,
  });
  const [navError, setNavError] = useState('');
  const widgets = useMemo(() => collectInputWidgets(app), [app]);

  // Tables for save_record — fetched lazily, once, when first needed.
  const [tables, setTables] = useState<MESTable[] | null>(null);
  const [tableFields, setTableFields] = useState<Record<string, MESTable>>({});
  const needsTables = draft.actions.some(a => a.type === 'save_record');
  useEffect(() => {
    if (needsTables && tables === null) {
      api.getTables().then((ts: MESTable[]) => setTables(ts)).catch(() => setTables([]));
    }
  }, [needsTables, tables]);
  useEffect(() => {
    for (const a of draft.actions) {
      if (a.type === 'save_record' && a.tableId && !tableFields[a.tableId]) {
        api.getTable(a.tableId)
          .then((t: MESTable) => setTableFields(prev => ({ ...prev, [a.tableId]: t })))
          .catch(() => {});
      }
    }
  }, [draft.actions, tableFields]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Non-navigation actions are sortable; the navigation action pins last.
  const bodyActions = draft.actions.filter(a => !isNav(a));
  const navAction = draft.actions.find(isNav) ?? null;
  const actionKey = (a: TriggerAction) => `${draft.actions.indexOf(a)}`;

  const setActions = (actions: TriggerAction[]) => setDraft(d => ({ ...d, actions }));

  const normalizedActions = (list: TriggerAction[]): TriggerAction[] => {
    const nav = list.filter(isNav);
    return [...list.filter(a => !isNav(a)), ...nav.slice(0, 1)];
  };

  const addAction = () => {
    setNavError('');
    setActions(normalizedActions([...draft.actions, defaultAction('show_message', app)]));
  };

  const replaceActionAt = (index: number, next: TriggerAction) => {
    setNavError('');
    if (isNav(next) && draft.actions.some((a, i) => i !== index && isNav(a))) {
      setNavError('A trigger can navigate only once — remove the existing navigation action first.');
      return;
    }
    setActions(normalizedActions(draft.actions.map((a, i) => i === index ? next : a)));
  };

  const removeActionAt = (index: number) => {
    setNavError('');
    setActions(draft.actions.filter((_, i) => i !== index));
  };

  const handleActionDrag = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    const body = draft.actions.filter(a => !isNav(a));
    const fromIdx = body.indexOf(draft.actions[from]);
    const toIdx = body.indexOf(draft.actions[to]);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = arrayMove(body, fromIdx, toIdx);
    setActions(normalizedActions(navAction ? [...reordered, navAction] : reordered));
  };

  // ── Conditions ──────────────────────────────────────────────────────────────

  const sourceOf = (c: TriggerCondition): ConditionSource => {
    if (c.op === 'kit_complete' || c.op === 'kit_has_short') return 'kit';
    return (c.left?.kind === 'widget' ? 'widget' : c.left?.kind === 'app_info' ? 'app_info' : 'variable');
  };

  const setCondition = (index: number, next: TriggerCondition) =>
    setDraft(d => ({ ...d, conditions: d.conditions.map((c, i) => i === index ? next : c) }));

  const addCondition = () => setDraft(d => ({
    ...d,
    conditions: [...d.conditions, {
      left: { kind: 'variable', name: app.variables?.[0]?.name ?? '' },
      op: 'eq',
      right: { kind: 'static', value: '' },
    }],
  }));

  const removeCondition = (index: number) =>
    setDraft(d => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }));

  const changeSource = (index: number, src: ConditionSource) => {
    if (src === 'kit') { setCondition(index, { op: 'kit_complete' }); return; }
    const left: ValueRef = src === 'variable'
      ? { kind: 'variable', name: app.variables?.[0]?.name ?? '' }
      : src === 'widget'
        ? { kind: 'widget', name: widgets[0]?.id ?? '' }
        : { kind: 'app_info', key: 'operator' };
    setCondition(index, { left, op: 'eq', right: { kind: 'static', value: '' } });
  };

  // ── Save ────────────────────────────────────────────────────────────────────

  const save = () => {
    onSave({ ...draft, actions: normalizedActions(draft.actions) });
  };

  const attLabel = attachment.kind === 'widget'
    ? (attachment.widget.label || WIDGET_META[attachment.widget.type]?.label || attachment.widget.type)
    : (attachment.step.name || 'Step');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22, 35, 61, 0.45)' }}>
      <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-surface-1 rounded-card shadow-pop border border-border-subtle">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-grid flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-ctrl flex items-center justify-center" style={{ background: 'var(--gold-wash)', color: 'var(--warn-ink)' }}>
              <Zap size={15} />
            </span>
            <div>
              <h2 className="text-ink" style={{ fontSize: 15, fontWeight: 750 }}>{initial ? 'Edit trigger' : 'New trigger'}</h2>
              <p className="text-muted" style={{ fontSize: 11.5 }}>on {attachment.kind === 'widget' ? 'widget' : 'step'} · <span className="font-mono">{attLabel}</span></p>
            </div>
          </div>
          <button onClick={onClose} className="wb-btn-ghost !min-h-0 p-1.5" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* WHEN */}
          <section>
            <div className="wb-label mb-1.5">When</div>
            <div className="wb-well px-3 py-2.5 flex items-center gap-2 flex-wrap">
              <span className="text-ink-2" style={{ fontSize: 13, fontWeight: 550 }}>When</span>
              <select
                className={sel}
                style={{ fontSize: 13 }}
                value={draft.event}
                onChange={e => setDraft(d => ({ ...d, event: e.target.value as TriggerEvent }))}
              >
                {/* Keep a foreign event selectable so existing triggers round-trip */}
                {(events.includes(draft.event) ? events : [draft.event, ...events]).map(ev => (
                  <option key={ev} value={ev}>{EVENT_LABEL[ev]}</option>
                ))}
              </select>
            </div>
          </section>

          {/* IF */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <span className="wb-label">If</span>
              {draft.conditions.length >= 2 && (
                <div className="seg">
                  <button className={draft.match === 'all' ? 'is-active' : ''} onClick={() => setDraft(d => ({ ...d, match: 'all' }))}>All match</button>
                  <button className={draft.match === 'any' ? 'is-active' : ''} onClick={() => setDraft(d => ({ ...d, match: 'any' }))}>Any match</button>
                </div>
              )}
            </div>
            <div className="wb-well px-3 py-2.5 space-y-2">
              {draft.conditions.length === 0 && (
                <p className="text-muted" style={{ fontSize: 12.5 }}>No conditions — the trigger always fires.</p>
              )}
              {draft.conditions.map((c, i) => {
                const src = sourceOf(c);
                const ops = src === 'kit' ? KIT_OPS : COMPARE_OPS;
                const noOperand = NO_OPERAND_OPS.includes(c.op);
                return (
                  <div key={i} className="flex items-center gap-1.5 flex-wrap">
                    {i > 0 && <span className="tnum text-muted uppercase" style={{ fontSize: 10.5, fontWeight: 650, width: 26 }}>{draft.match === 'any' ? 'or' : 'and'}</span>}
                    <select className={sel} style={{ fontSize: 12.5 }} value={src} onChange={e => changeSource(i, e.target.value as ConditionSource)}>
                      <option value="variable">Variable</option>
                      <option value="widget">Input widget</option>
                      <option value="app_info">App info</option>
                      <option value="kit">Kit</option>
                    </select>
                    {src === 'variable' && (
                      <select className={`${sel} font-mono`} style={{ fontSize: 12 }} value={c.left?.name ?? ''} onChange={e => setCondition(i, { ...c, left: { kind: 'variable', name: e.target.value } })}>
                        <option value="">— variable —</option>
                        {(app.variables ?? []).map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                      </select>
                    )}
                    {src === 'widget' && (
                      <select className={sel} style={{ fontSize: 12.5 }} value={c.left?.name ?? ''} onChange={e => setCondition(i, { ...c, left: { kind: 'widget', name: e.target.value } })}>
                        <option value="">— widget —</option>
                        {widgets.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
                      </select>
                    )}
                    {src === 'app_info' && (
                      <select className={sel} style={{ fontSize: 12.5 }} value={c.left?.key ?? 'operator'} onChange={e => setCondition(i, { ...c, left: { kind: 'app_info', key: e.target.value as ValueRef['key'] } })}>
                        {APP_INFO_KEYS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
                      </select>
                    )}
                    <select
                      className={sel}
                      style={{ fontSize: 12.5 }}
                      value={c.op}
                      onChange={e => {
                        const op = e.target.value as TriggerOp;
                        setCondition(i, NO_OPERAND_OPS.includes(op) ? { left: src === 'kit' ? undefined : c.left, op } : { ...c, op });
                      }}
                    >
                      {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                    </select>
                    {!noOperand && src !== 'kit' && (
                      <ValueRefEditor value={c.right} onChange={r => setCondition(i, { ...c, right: r })} app={app} widgets={widgets} />
                    )}
                    <button onClick={() => removeCondition(i)} className="wb-btn-ghost !min-h-0 p-1 ml-auto" aria-label="Remove condition"><X size={13} /></button>
                  </div>
                );
              })}
              <button onClick={addCondition} className="wb-btn-ghost !min-h-0 !px-1.5 text-accent" style={{ fontSize: 12.5 }}>
                <Plus size={13} /> Add condition
              </button>
            </div>
          </section>

          {/* THEN */}
          <section>
            <div className="wb-label mb-1.5">Then</div>
            <div className="wb-well px-3 py-2.5 space-y-2">
              {draft.actions.length === 0 && (
                <p className="text-muted" style={{ fontSize: 12.5 }}>No actions yet — add one below.</p>
              )}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleActionDrag}>
                <SortableContext items={bodyActions.map(a => actionKey(a))} strategy={verticalListSortingStrategy}>
                  {draft.actions.map((a, i) => (
                    <ActionRow
                      key={`${i}_${a.type}`}
                      id={actionKey(a)}
                      action={a}
                      app={app}
                      widgets={widgets}
                      tables={tables ?? []}
                      tableFields={tableFields}
                      pinned={isNav(a)}
                      onChange={next => replaceActionAt(i, next)}
                      onRemove={() => removeActionAt(i)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              {navError && (
                <p className="flex items-center gap-1.5 text-bad" style={{ fontSize: 12 }}>
                  <AlertCircle size={12} /> {navError}
                </p>
              )}
              <button onClick={addAction} className="wb-btn-ghost !min-h-0 !px-1.5 text-accent" style={{ fontSize: 12.5 }}>
                <Plus size={13} /> Add action
              </button>
            </div>
          </section>
        </div>

        {/* Footer — wraps on narrow screens so Save never clips off-screen */}
        <div className="flex items-center flex-wrap gap-2.5 px-5 py-3.5 border-t border-grid flex-shrink-0">
          <input
            className="wb-input flex-1 min-w-[150px]"
            style={{ fontSize: 13 }}
            placeholder="Trigger name (optional)"
            value={draft.name ?? ''}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
          />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={draft.enabled !== false}
              onClick={() => setDraft(d => ({ ...d, enabled: d.enabled === false ? true : false }))}
              className={`wb-toggle ${draft.enabled !== false ? 'is-on' : ''}`}
            />
            <span className="text-ink-2" style={{ fontSize: 12.5, fontWeight: 550 }}>Enabled</span>
          </label>
          {initial && onDelete && (
            <button onClick={onDelete} className="wb-btn hover:!bg-red-50" style={{ color: 'var(--bad)', borderColor: 'rgba(201,42,42,0.35)' }}><Trash2 size={13} /> Delete</button>
          )}
          <button onClick={onClose} className="wb-btn">Cancel</button>
          <button onClick={save} className="wb-btn-primary">Save trigger</button>
        </div>
      </div>
    </div>
  );
}

// ─── One THEN action row ──────────────────────────────────────────────────────

function ActionRow({ id, action, app, widgets, tables, tableFields, pinned, onChange, onRemove }: {
  id: string;
  action: TriggerAction;
  app: App;
  widgets: WidgetOption[];
  tables: MESTable[];
  tableFields: Record<string, MESTable>;
  pinned: boolean;
  onChange: (a: TriggerAction) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: pinned });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const category = CATEGORY_OF[action.type];

  return (
    <div ref={setNodeRef} style={style} className="rounded-ctrl bg-surface-1 border border-border-subtle px-2 py-1.5">
      <div className="flex items-start gap-1.5 flex-wrap">
        <button
          {...attributes}
          {...listeners}
          className={`mt-1.5 p-0.5 flex-shrink-0 ${pinned ? 'text-baseline cursor-default' : 'text-baseline hover:text-muted cursor-grab active:cursor-grabbing'}`}
          title={pinned ? 'Navigation runs last' : 'Drag to reorder'}
          aria-label="Reorder action"
        >
          <GripVertical size={13} />
        </button>
        <select
          className={sel}
          style={{ fontSize: 12.5 }}
          value={category}
          onChange={e => {
            const cat = e.target.value as ActionCategory;
            onChange(defaultAction(ACTIONS_IN[cat][0].type, app));
          }}
        >
          {(Object.keys(CATEGORY_LABEL) as ActionCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <select
          className={sel}
          style={{ fontSize: 12.5 }}
          value={action.type}
          onChange={e => onChange(defaultAction(e.target.value as TriggerAction['type'], app))}
        >
          {ACTIONS_IN[category].map(a => <option key={a.type} value={a.type}>{a.label}</option>)}
        </select>

        {/* Per-action config */}
        {action.type === 'go_to_step' && (
          <select className={sel} style={{ fontSize: 12.5 }} value={action.stepId} onChange={e => onChange({ ...action, stepId: e.target.value })}>
            <option value="">— step —</option>
            {app.steps.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}
          </select>
        )}
        {action.type === 'set_variable' && (
          <>
            <select className={`${sel} font-mono`} style={{ fontSize: 12 }} value={action.name} onChange={e => onChange({ ...action, name: e.target.value })}>
              <option value="">— variable —</option>
              {(app.variables ?? []).map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
            <span className="text-muted self-center" style={{ fontSize: 12 }}>to</span>
            <ValueRefEditor value={action.value} onChange={v => onChange({ ...action, value: v })} app={app} widgets={widgets} />
          </>
        )}
        {action.type === 'show_message' && (
          <>
            <select className={sel} style={{ fontSize: 12.5 }} value={action.level} onChange={e => onChange({ ...action, level: e.target.value as 'info' | 'warning' })}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
            </select>
            <input className={`${inp} flex-1 min-w-[140px]`} style={{ fontSize: 12.5 }} placeholder="Message — {{variable}} allowed" value={action.text} onChange={e => onChange({ ...action, text: e.target.value })} />
          </>
        )}
        {action.type === 'block_with_error' && (
          <input className={`${inp} flex-1 min-w-[140px]`} style={{ fontSize: 12.5 }} placeholder="Error text — halts actions, cancels navigation" value={action.text} onChange={e => onChange({ ...action, text: e.target.value })} />
        )}
        {action.type === 'require_photo' && (
          <input className={`${inp} flex-1 min-w-[140px]`} style={{ fontSize: 12.5 }} placeholder="Prompt (optional)" value={action.message ?? ''} onChange={e => onChange({ ...action, message: e.target.value })} />
        )}
        {action.type === 'create_ncr' && (
          <>
            <select className={sel} style={{ fontSize: 12.5 }} value={action.severity} onChange={e => onChange({ ...action, severity: e.target.value as NCRSeverity })}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
            <input className={`${inp} flex-1 min-w-[130px]`} style={{ fontSize: 12.5 }} placeholder="NCR title — {{variable}} allowed" value={action.title} onChange={e => onChange({ ...action, title: e.target.value })} />
          </>
        )}
        {action.type === 'save_record' && (
          <select
            className={sel}
            style={{ fontSize: 12.5 }}
            value={action.tableId}
            onChange={e => onChange({ ...action, tableId: e.target.value, fields: {} })}
          >
            <option value="">— table —</option>
            {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        <button onClick={onRemove} className="wb-btn-ghost !min-h-0 p-1 ml-auto" aria-label="Remove action"><X size={13} /></button>
      </div>

      {/* create_ncr description + save_record field mapping expand below */}
      {action.type === 'create_ncr' && (
        <input
          className={`${inp} mt-1.5 w-full`}
          style={{ fontSize: 12.5 }}
          placeholder="Description (optional) — {{variable}} allowed"
          value={action.description ?? ''}
          onChange={e => onChange({ ...action, description: e.target.value })}
        />
      )}
      {action.type === 'save_record' && action.tableId && (
        <div className="mt-1.5 pl-6 space-y-1.5">
          {(tableFields[action.tableId]?.fields ?? []).map(f => (
            <div key={f.id} className="flex items-center gap-2 flex-wrap">
              <span className="text-ink-2" style={{ fontSize: 12, fontWeight: 550, minWidth: 90 }}>{f.name}</span>
              <span className="text-muted" style={{ fontSize: 11 }}>←</span>
              <ValueRefEditor
                value={action.fields[f.id]}
                onChange={v => onChange({ ...action, fields: { ...action.fields, [f.id]: v } })}
                app={app}
                widgets={widgets}
              />
              {action.fields[f.id] && (
                <button
                  className="wb-btn-ghost !min-h-0 p-0.5"
                  aria-label={`Clear ${f.name} mapping`}
                  onClick={() => {
                    const fields = { ...action.fields };
                    delete fields[f.id];
                    onChange({ ...action, fields });
                  }}
                ><X size={11} /></button>
              )}
            </div>
          ))}
          {!tableFields[action.tableId] && <p className="text-muted" style={{ fontSize: 11.5 }}>Loading fields…</p>}
        </div>
      )}
    </div>
  );
}
