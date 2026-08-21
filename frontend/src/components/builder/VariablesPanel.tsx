// ─── Variables panel (spec §4.1) ──────────────────────────────────────────────
// Table of AppVariables: name (validated ^[a-z][a-z0-9_]*$, unique), type,
// default, description, "used by" count. Create / rename (cascades through
// widget configs + triggers in builder state) / delete (blocked while
// referenced). Also exports the pure helpers the builder uses to activate the
// dormant apps.variables column on v1 apps.

import { useMemo, useState } from 'react';
import { Plus, Trash2, Variable as VariableIcon, X, Pencil, Check, AlertTriangle } from 'lucide-react';
import type {
  App, AppVariable, Step, Trigger, TriggerAction, TriggerCondition, ValueRef, Widget, WidgetType,
} from '../../types';
import { v4 as uuidv4 } from '../../utils/uuid';

export const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** Infer a registry type from the widget that first used a legacy name. */
export function inferVariableType(widgetType: WidgetType): AppVariable['type'] {
  if (widgetType === 'number-input' || widgetType === 'counter') return 'number';
  if (widgetType === 'checkbox') return 'boolean';
  return 'text';
}

/** Auto-register legacy free-text variableNames that match no registered
 *  variable (spec §4.1) — this is what activates apps.variables on v1 apps.
 *  Idempotent; names that fail the pattern are registered as-is so the
 *  dropdowns can still show them. */
export function autoRegisterVariables(app: App): App {
  const known = new Set((app.variables ?? []).map(v => v.name));
  const added: AppVariable[] = [];
  for (const step of app.steps) {
    for (const w of step.widgets) {
      const name = w.config.variableName;
      if (name && !known.has(name)) {
        known.add(name);
        added.push({ id: uuidv4(), name, type: inferVariableType(w.type) });
      }
    }
  }
  if (added.length === 0) return app;
  return { ...app, variables: [...(app.variables ?? []), ...added] };
}

// ── Reference scanning ────────────────────────────────────────────────────────

function refUses(ref: ValueRef | undefined, name: string): number {
  return ref?.kind === 'variable' && ref.name === name ? 1 : 0;
}

function textUses(text: string | undefined, name: string): number {
  if (!text) return 0;
  const m = text.match(new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g'));
  return m ? m.length : 0;
}

function triggerUses(t: Trigger, name: string): number {
  let n = 0;
  for (const c of t.conditions) n += refUses(c.left, name) + refUses(c.right, name);
  for (const a of t.actions) {
    switch (a.type) {
      case 'set_variable':
        if (a.name === name) n += 1;
        n += refUses(a.value, name);
        break;
      case 'save_record':
        for (const v of Object.values(a.fields)) n += refUses(v, name);
        break;
      case 'show_message': n += textUses(a.text, name); break;
      case 'block_with_error': n += textUses(a.text, name); break;
      case 'require_photo': n += textUses(a.message, name); break;
      case 'create_ncr': n += textUses(a.title, name) + textUses(a.description, name); break;
      default: break;
    }
  }
  return n;
}

/** How many widgets/triggers reference a variable name. */
export function countVariableUses(app: App, name: string): number {
  let n = 0;
  for (const step of app.steps) {
    for (const t of step.triggers ?? []) n += triggerUses(t, name);
    for (const w of step.widgets) {
      if (w.config.variableName === name) n += 1;
      if (w.config.variableRef === name) n += 1;
      if (w.config.matchVariable === name) n += 1;
      n += textUses(w.config.text, name) + textUses(w.config.content, name);
      for (const t of w.triggers ?? []) n += triggerUses(t, name);
    }
  }
  return n;
}

// ── Rename cascade ────────────────────────────────────────────────────────────

function renameRef(ref: ValueRef | undefined, from: string, to: string): ValueRef | undefined {
  if (ref?.kind === 'variable' && ref.name === from) return { ...ref, name: to };
  return ref;
}

function renameText(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`\\{\\{\\s*${from}\\s*\\}\\}`, 'g'), `{{${to}}}`);
}

function renameInTrigger(t: Trigger, from: string, to: string): Trigger {
  const conditions: TriggerCondition[] = t.conditions.map(c => ({
    ...c, left: renameRef(c.left, from, to), right: renameRef(c.right, from, to),
  }));
  const actions: TriggerAction[] = t.actions.map((a): TriggerAction => {
    switch (a.type) {
      case 'set_variable':
        return { ...a, name: a.name === from ? to : a.name, value: renameRef(a.value, from, to) ?? a.value };
      case 'save_record': {
        const fields: Record<string, ValueRef> = {};
        for (const [k, v] of Object.entries(a.fields)) fields[k] = renameRef(v, from, to) ?? v;
        return { ...a, fields };
      }
      case 'show_message': return { ...a, text: renameText(a.text, from, to) };
      case 'block_with_error': return { ...a, text: renameText(a.text, from, to) };
      case 'require_photo': return a.message ? { ...a, message: renameText(a.message, from, to) } : a;
      case 'create_ncr': return {
        ...a,
        title: renameText(a.title, from, to),
        description: a.description ? renameText(a.description, from, to) : a.description,
      };
      default: return a;
    }
  });
  return { ...t, conditions, actions };
}

function renameInWidget(w: Widget, from: string, to: string): Widget {
  const config = { ...w.config };
  if (config.variableName === from) config.variableName = to;
  if (config.variableRef === from) config.variableRef = to;
  if (config.matchVariable === from) config.matchVariable = to;
  if (config.text) config.text = renameText(config.text, from, to);
  if (config.content) config.content = renameText(config.content, from, to);
  return { ...w, config, triggers: (w.triggers ?? []).map(t => renameInTrigger(t, from, to)) };
}

/** Rename a variable everywhere in builder state: registry, widget configs,
 *  triggers (refs + set_variable + {{interpolation}} in texts). */
export function renameVariableEverywhere(app: App, from: string, to: string): App {
  const steps: Step[] = app.steps.map(s => ({
    ...s,
    triggers: (s.triggers ?? []).map(t => renameInTrigger(t, from, to)),
    widgets: s.widgets.map(w => renameInWidget(w, from, to)),
  }));
  return {
    ...app,
    steps,
    variables: (app.variables ?? []).map(v => v.name === from ? { ...v, name: to } : v),
  };
}

// ─── Panel UI ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS: AppVariable['type'][] = ['text', 'number', 'boolean'];

export default function VariablesPanel({ app, onChangeApp, onClose, canEdit }: {
  app: App;
  onChangeApp: (updater: (prev: App) => App) => void;
  onClose: () => void;
  canEdit: boolean;
}) {
  const variables = app.variables ?? [];
  const useCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of variables) m.set(v.name, countVariableUses(app, v.name));
    return m;
  }, [app, variables]);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AppVariable['type']>('text');
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const validate = (name: string, exceptId?: string): string => {
    if (!VARIABLE_NAME_RE.test(name)) return 'Lowercase letters, digits and _ only; must start with a letter (e.g. torque_nm).';
    if (variables.some(v => v.name === name && v.id !== exceptId)) return `"${name}" is already registered.`;
    return '';
  };

  const create = () => {
    const name = newName.trim();
    const err = validate(name);
    if (err) { setError(err); return; }
    onChangeApp(prev => ({
      ...prev,
      variables: [...(prev.variables ?? []), { id: uuidv4(), name, type: newType }],
    }));
    setNewName(''); setError('');
  };

  const commitRename = (v: AppVariable) => {
    const name = renameDraft.trim();
    if (name === v.name) { setRenamingId(null); return; }
    const err = validate(name, v.id);
    if (err) { setError(err); return; }
    onChangeApp(prev => renameVariableEverywhere(prev, v.name, name));
    setRenamingId(null); setError('');
  };

  const remove = (v: AppVariable) => {
    onChangeApp(prev => ({ ...prev, variables: (prev.variables ?? []).filter(x => x.id !== v.id) }));
  };

  const updateVar = (id: string, patch: Partial<AppVariable>) => {
    onChangeApp(prev => ({
      ...prev,
      variables: (prev.variables ?? []).map(v => v.id === id ? { ...v, ...patch } : v),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22, 35, 61, 0.45)' }}>
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col bg-surface-1 rounded-card shadow-pop border border-border-subtle">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-grid flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-ctrl flex items-center justify-center bg-accent-tint text-accent"><VariableIcon size={16} /></span>
            <div>
              <h2 className="text-ink" style={{ fontSize: 16, fontWeight: 750 }}>Variables</h2>
              <p className="text-muted" style={{ fontSize: 12 }}>The app&rsquo;s registered data fields — inputs write them, triggers and displays read them.</p>
            </div>
          </div>
          <button onClick={onClose} className="wb-btn-ghost !min-h-0 p-1.5" aria-label="Close"><X size={16} /></button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {variables.length === 0 ? (
            <div className="py-12 text-center text-muted" style={{ fontSize: 13 }}>
              No variables yet. Create one below, or add an input widget — its variable registers automatically.
            </div>
          ) : (
            <table className="w-full" style={{ fontSize: 13.5 }}>
              <thead>
                <tr className="text-left" style={{ borderBottom: '1.5px solid var(--baseline)' }}>
                  <th className="wb-label px-5 py-2 font-[650]">Name</th>
                  <th className="wb-label px-3 py-2 font-[650]">Type</th>
                  <th className="wb-label px-3 py-2 font-[650]">Default</th>
                  <th className="wb-label px-3 py-2 font-[650]">Description</th>
                  <th className="wb-label px-3 py-2 font-[650] text-right">Used by</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {variables.map(v => {
                  const uses = useCounts.get(v.name) ?? 0;
                  const renaming = renamingId === v.id;
                  return (
                    <tr key={v.id} className="border-b border-grid last:border-b-0 hover:bg-surface-2/50">
                      <td className="px-5 py-2">
                        {renaming ? (
                          <span className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              className="wb-input !min-h-0 !py-1 font-mono"
                              style={{ fontSize: 12.5, width: 160 }}
                              value={renameDraft}
                              onChange={e => setRenameDraft(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitRename(v); if (e.key === 'Escape') { setRenamingId(null); setError(''); } }}
                            />
                            <button className="wb-btn-ghost !min-h-0 p-1 text-good" onClick={() => commitRename(v)} aria-label="Confirm rename"><Check size={14} /></button>
                          </span>
                        ) : (
                          <span className="font-mono text-ink" style={{ fontSize: 12.5, fontWeight: 550 }}>{v.name}</span>
                        )}
                        {!VARIABLE_NAME_RE.test(v.name) && !renaming && (
                          <span className="ml-2 inline-flex items-center gap-1 text-warn-ink" style={{ fontSize: 10.5 }} title="Legacy name — rename to lowercase_with_underscores">
                            <AlertTriangle size={10} /> legacy
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="wb-input !min-h-0 !py-1 !w-auto"
                          style={{ fontSize: 12.5 }}
                          value={v.type}
                          disabled={!canEdit}
                          onChange={e => updateVar(v.id, { type: e.target.value as AppVariable['type'] })}
                        >
                          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="wb-input !min-h-0 !py-1"
                          style={{ fontSize: 12.5, width: 110 }}
                          placeholder="—"
                          disabled={!canEdit}
                          value={v.defaultValue === undefined ? '' : String(v.defaultValue)}
                          onChange={e => {
                            const raw = e.target.value;
                            let val: string | number | boolean | undefined = raw === '' ? undefined : raw;
                            if (raw !== '' && v.type === 'number' && !Number.isNaN(Number(raw))) val = Number(raw);
                            if (raw !== '' && v.type === 'boolean') val = raw === 'true' || raw === '1';
                            updateVar(v.id, { defaultValue: val });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="wb-input !min-h-0 !py-1 w-full"
                          style={{ fontSize: 12.5 }}
                          placeholder="—"
                          disabled={!canEdit}
                          value={v.description ?? ''}
                          onChange={e => updateVar(v.id, { description: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`tnum ${uses > 0 ? 'text-ink-2' : 'text-muted'}`} style={{ fontSize: 12.5, fontWeight: 650 }}>{uses}</span>
                      </td>
                      <td className="px-3 py-2">
                        {canEdit && (
                          <span className="flex items-center justify-end gap-0.5">
                            <button
                              className="wb-btn-ghost !min-h-0 p-1"
                              title="Rename (updates every widget and trigger that uses it)"
                              onClick={() => { setRenamingId(v.id); setRenameDraft(v.name); setError(''); }}
                            ><Pencil size={13} /></button>
                            <button
                              className="wb-btn-ghost !min-h-0 p-1 disabled:opacity-30"
                              disabled={uses > 0}
                              title={uses > 0 ? `In use by ${uses} reference${uses !== 1 ? 's' : ''} — remove those first` : 'Delete variable'}
                              onClick={() => remove(v)}
                            ><Trash2 size={13} className={uses > 0 ? '' : 'text-bad'} /></button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Create row */}
        {canEdit && (
          <div className="px-5 py-3.5 border-t border-grid flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                className="wb-input font-mono flex-1"
                style={{ fontSize: 12.5 }}
                placeholder="new_variable_name"
                value={newName}
                onChange={e => { setNewName(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') create(); }}
              />
              <select className="wb-input !w-auto" style={{ fontSize: 12.5 }} value={newType} onChange={e => setNewType(e.target.value as AppVariable['type'])}>
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="wb-btn-primary" onClick={create} disabled={!newName.trim()}>
                <Plus size={14} /> Add
              </button>
            </div>
            {error && <p className="mt-1.5 text-bad" style={{ fontSize: 12 }}>{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
