// ─── Context panel — right region of the four-region builder (spec §4.1) ──────
// Consolidates the scattered property editors into four gold-underline tabs:
//   Widget   — per-type config forms (moved from AppBuilder, not rewritten),
//              the 5 new v2 widget forms (§4.2), and the validation section
//   Step     — name/takt/layout/step_type/group + legacy parts_list editor
//   App      — name/description, publish targeting, takt warnings, product
//              types manager (relocated modal content, with "BOM →" links)
//   Triggers — trigger list for the current selection → opens TriggerEditor

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, AlignCenter, AlignLeft as AlignLeftIcon, AlignRight,
  Box, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, ExternalLink,
  Image, LayoutGrid, Loader2,
  MousePointerClick, MoveDown, MoveUp, Package, Plus, PlusCircle, Rows3,
  Settings, Tag, Trash2, Upload, Video, X, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  App, AppVariable, Department, ProductType, Station, Step, Trigger,
  Widget, WidgetLayout,
} from '../../types';
import { api } from '../../api/client';
import TableImportModal from '../shared/TableImportModal';
import { BUTTON_ICONS, buttonLabelContrast, defaultLayout, WIDGET_GROUND } from '../app/WidgetView';
import { contrastRatio, readableInk, LIGHT_INK } from '../../utils/contrast';
import { WIDGET_META, INPUT_WIDGET_TYPES } from './WidgetPalette';
import { inferVariableType, VARIABLE_NAME_RE } from './VariablesPanel';
import { eventsFor, TriggerAttachment } from './TriggerEditor';
import { v4 as uuidv4 } from '../../utils/uuid';

export type ContextTab = 'widget' | 'step' | 'app' | 'triggers';

// ── Run requirements (app-level require_run_context) ──────────────────────────
// Player contract: app.require_run_context, boolean, absent = legacy behavior.
// Not yet a typed App field (the backend column belongs to another slice), so
// reads/writes go through these narrowing helpers.

export type AppWithRunContext = App & { require_run_context?: boolean | number };

/** The explicit stored value, or undefined when the app has never set one.
 *  Accepts SQLite-style 0/1 as well as booleans. */
export function requireRunContextValue(app: App): boolean | undefined {
  const v = (app as AppWithRunContext).require_run_context;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

/** Effective state: explicit value if present; otherwise ON for v2 apps
 *  (schema_version >= 2) and OFF (legacy behavior) for v1 blobs. */
export function effectiveRequireRunContext(app: App): boolean {
  const explicit = requireRunContextValue(app);
  if (explicit !== undefined) return explicit;
  return (app.schema_version ?? 1) >= 2;
}

// ── Collapsed-panel preference ────────────────────────────────────────────────

/** localStorage key for the collapsed-panel preference ('1' = collapsed). */
export const PANEL_COLLAPSE_STORAGE_KEY = 'hm.builder.contextCollapsed';

function loadPanelCollapsed(): boolean {
  try { return localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY) === '1'; }
  catch { return false; }
}

// ── Shared field chrome ───────────────────────────────────────────────────────

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block mb-1 text-ink-2" style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-muted" style={{ fontSize: 11 }}>{hint}</p>}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block mb-1 text-ink-2" style={{ fontSize: 12, fontWeight: 600 }}>{label}</label>
      <input type="number" className="wb-input tnum" value={value}
        onChange={e => onChange(e.target.value === '' ? 0 : parseInt(e.target.value))} />
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={() => onChange(!checked)}
        className={`wb-toggle mt-0.5 ${checked ? 'is-on' : ''}`}
      />
      <span className="flex-1">
        <span className="block text-ink-2" style={{ fontSize: 12.5, fontWeight: 550 }}>{label}</span>
        {hint && <span className="block text-muted mt-0.5" style={{ fontSize: 11 }}>{hint}</span>}
      </span>
    </label>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <input type="color" className="w-10 h-[38px] rounded-ctrl border border-baseline p-0.5 cursor-pointer bg-surface-1" value={value || fallback} onChange={e => onChange(e.target.value)} />
        <input className="wb-input flex-1 font-mono" style={{ fontSize: 12 }} value={value || fallback} onChange={e => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

/** What the picked button color will actually look like on the floor.
 *
 *  The label color is chosen from the fill rather than left to the author, so
 *  this states which ink won and at what ratio instead of asking anyone to
 *  guess. The one thing auto-ink cannot rescue is a fill that disappears into
 *  the player's near-black shell, so that gets a warning of its own — WCAG 2.2
 *  wants 3:1 for a control's own boundary. */
function ButtonColorReadout({ color }: { color: string }) {
  const label = buttonLabelContrast(color);
  const onShell = contrastRatio(color, WIDGET_GROUND);
  if (label === null) return null;
  const inkName = readableInk(color) === LIGHT_INK ? 'White' : 'Dark';
  return (
    <div className="-mt-1 space-y-1">
      <p className="text-muted" style={{ fontSize: 11.5 }}>
        {inkName} label, <span className="tnum">{label.toFixed(1)}:1</span> — picked automatically so the
        text stays readable on the floor.
      </p>
      {onShell !== null && onShell < 3 && (
        <p className="flex items-start gap-1.5 text-warn-ink" style={{ fontSize: 11.5 }}>
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            This color nearly matches the player background (<span className="tnum">{onShell.toFixed(1)}:1</span>),
            so the button itself is hard to find. Pick a brighter one.
          </span>
        </p>
      )}
    </div>
  );
}

/** Variable picker replacing free-text variableName (spec §4.1): dropdown of
 *  registered variables + "Create variable…". Unregistered legacy values stay
 *  selectable so v1 apps round-trip untouched. */
function VariableNameSelect({ value, variables, widgetTypeHint, onChange, onRegister }: {
  value: string;
  variables: AppVariable[];
  widgetTypeHint: Widget['type'];
  onChange: (name: string) => void;
  onRegister: (v: AppVariable) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const isUnregistered = !!value && !variables.some(v => v.name === value);

  const create = () => {
    const name = draft.trim();
    if (!VARIABLE_NAME_RE.test(name)) { setError('Use lowercase_with_underscores, starting with a letter.'); return; }
    if (variables.some(v => v.name === name)) { setError(`"${name}" already exists — pick it from the list.`); return; }
    onRegister({ id: uuidv4(), name, type: inferVariableType(widgetTypeHint) });
    onChange(name);
    setCreating(false); setDraft(''); setError('');
  };

  return (
    <Field label="Variable">
      {!creating ? (
        <select
          className="wb-input font-mono"
          style={{ fontSize: 12 }}
          value={value}
          onChange={e => {
            if (e.target.value === '__create__') { setCreating(true); return; }
            onChange(e.target.value);
          }}
        >
          <option value="">— none —</option>
          {isUnregistered && <option value={value}>{value} (unregistered)</option>}
          {variables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
          <option value="__create__">＋ Create variable…</option>
        </select>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            className="wb-input font-mono flex-1"
            style={{ fontSize: 12 }}
            placeholder="new_variable"
            value={draft}
            onChange={e => { setDraft(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') create(); if (e.key === 'Escape') { setCreating(false); setError(''); } }}
          />
          <button className="wb-btn-primary !min-h-[34px] !px-3" onClick={create}>Add</button>
          <button className="wb-btn-ghost !min-h-0 p-1" aria-label="Cancel" onClick={() => { setCreating(false); setError(''); }}><X size={13} /></button>
        </div>
      )}
      {error && <p className="mt-1 text-bad" style={{ fontSize: 11 }}>{error}</p>}
    </Field>
  );
}

// ─── The panel ────────────────────────────────────────────────────────────────

export default function ContextPanel(props: {
  tab: ContextTab;
  onTab: (t: ContextTab) => void;
  app: App;
  activeStepIdx: number;
  selectedWidget: Widget | null;
  canEdit: boolean;
  productTypes: ProductType[];
  departments: Department[];
  stations: Station[];
  onUpdateApp: (updater: (prev: App) => App) => void;
  onUpdateStep: (updater: (s: Step) => Step) => void;
  onUpdateWidget: (id: string, updates: Partial<Widget>) => void;
  onUpdateWidgetConfig: (id: string, cfg: Partial<Widget['config']>) => void;
  onUpdateWidgetLayout: (id: string, l: WidgetLayout) => void;
  onRestack: (id: string, dir: 'front' | 'back') => void;
  onRemoveWidget: (id: string) => void;
  onSetMode: (m: 'flow' | 'canvas') => void;
  onUpdateProductTypes: (pts: ProductType[]) => void;
  onEditTrigger: (attachment: TriggerAttachment, trigger: Trigger | null) => void;
}) {
  const { tab, onTab, app, activeStepIdx, selectedWidget } = props;
  const step = app.steps[activeStepIdx];
  const [collapsed, setCollapsed] = useState<boolean>(loadPanelCollapsed);

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, v ? '1' : '0'); } catch { /* noop */ }
  };

  const TABS: { id: ContextTab; label: string; icon: LucideIcon }[] = [
    { id: 'widget', label: 'Widget', icon: MousePointerClick },
    { id: 'step', label: 'Step', icon: Rows3 },
    { id: 'app', label: 'App', icon: Settings },
    { id: 'triggers', label: 'Triggers', icon: Zap },
  ];

  // ── Collapsed: slim icon rail — the canvas reclaims the width ──
  if (collapsed) {
    return (
      <div className="flex flex-row lg:flex-col items-center w-full lg:w-11 lg:h-full flex-shrink-0 bg-surface-1 border-t lg:border-t-0 lg:border-l border-border-subtle px-2 lg:px-0 py-2 gap-1 overflow-x-auto">
        <button
          onClick={() => setCollapsedPersist(false)}
          aria-label="Expand panel"
          title="Expand panel"
          className="wb-btn-ghost !min-h-0 p-1.5"
        >
          <ChevronsLeft size={15} />
        </button>
        <div className="h-5 border-l lg:h-auto lg:w-5 lg:border-l-0 lg:border-t border-grid mx-1 lg:mx-0 lg:my-1" />
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              aria-label={t.label}
              title={t.label}
              onClick={() => { setCollapsedPersist(false); onTab(t.id); }}
              className={`shrink-0 p-2 rounded-ctrl transition-colors ${tab === t.id ? 'bg-gold-wash text-ink' : 'text-muted hover:text-ink hover:bg-surface-2'}`}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>
    );
  }

  // Below lg the four builder regions are stacked in one column, so a fixed
  // 320px inspector left seventy dead pixels beside it on a 390px phone. Full
  // width there, fixed column from lg up.
  return (
    <div className="flex flex-col w-full lg:w-[320px] flex-shrink-0 bg-surface-1 border-t lg:border-t-0 lg:border-l border-border-subtle h-[38vh] max-h-[400px] lg:h-full lg:max-h-none">
      <div className="flex items-stretch border-b border-grid flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            className={`gold-tab flex-1 whitespace-nowrap py-2.5 ${tab === t.id ? 'is-active' : ''}`}
            style={{ fontSize: 12.5 }}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setCollapsedPersist(true)}
          aria-label="Collapse panel"
          title="Collapse panel"
          className="wb-btn-ghost !min-h-0 px-1.5 self-center mr-1"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'widget' && (selectedWidget
          ? <WidgetTab {...props} widget={selectedWidget} />
          : (
            <div className="text-center py-10 text-muted">
              <MousePointerClick size={22} className="mx-auto mb-2 opacity-50" />
              <p style={{ fontSize: 12.5 }}>Select a widget on the canvas to edit it</p>
            </div>
          ))}
        {tab === 'step' && step && <StepTab {...props} step={step} />}
        {tab === 'app' && <AppTab {...props} />}
        {tab === 'triggers' && step && <TriggersTab {...props} step={step} />}
      </div>
    </div>
  );
}

// ─── Widget tab ───────────────────────────────────────────────────────────────

const UPLOAD_LIMITS_MB: Record<string, number> = { image: 15, video: 200, model: 50 };

/** Compact THEN-clause labels for the button "Actions" summary. */
const ACTION_LABELS: Record<string, string> = {
  next_step: 'Next step',
  prev_step: 'Previous step',
  complete_app: 'Complete app',
  go_to_step: 'Go to step',
  set_variable: 'Set variable',
  save_record: 'Save record',
  require_photo: 'Require photo',
  show_message: 'Show message',
  block_with_error: 'Block with error',
  create_ncr: 'Create NCR',
};

function WidgetTab({ app, widget, activeStepIdx, canEdit, onTab, onUpdateWidget, onUpdateWidgetConfig, onUpdateWidgetLayout, onRestack, onRemoveWidget, onUpdateApp, onEditTrigger }: {
  app: App;
  widget: Widget;
  activeStepIdx: number;
  canEdit: boolean;
  onTab: (t: ContextTab) => void;
  onUpdateWidget: (id: string, updates: Partial<Widget>) => void;
  onUpdateWidgetConfig: (id: string, cfg: Partial<Widget['config']>) => void;
  onUpdateWidgetLayout: (id: string, l: WidgetLayout) => void;
  onRestack: (id: string, dir: 'front' | 'back') => void;
  onRemoveWidget: (id: string) => void;
  onUpdateApp: (updater: (prev: App) => App) => void;
  onEditTrigger: (attachment: TriggerAttachment, trigger: Trigger | null) => void;
}) {
  const step = app.steps[activeStepIdx];
  const isCanvas = step?.layoutMode === 'canvas';
  const { config } = widget;
  const layout = widget.layout ?? defaultLayout(widget.type);
  const setLayout = (patch: Partial<WidgetLayout>) => onUpdateWidgetLayout(widget.id, { ...layout, ...patch });
  const setConfig = (cfg: Partial<Widget['config']>) => onUpdateWidgetConfig(widget.id, cfg);
  const variables = app.variables ?? [];
  const registerVariable = (v: AppVariable) =>
    onUpdateApp(prev => ({ ...prev, variables: [...(prev.variables ?? []), v] }));

  // Shared file-upload pipeline (moved from AppBuilder — behavior unchanged).
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadFile = (file: File, kind: 'image' | 'video' | 'model', onDone: (url: string) => void) => {
    setUploadError('');
    const maxMB = UPLOAD_LIMITS_MB[kind];
    if (file.size > maxMB * 1024 * 1024) {
      setUploadError(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the ${kind} limit is ${maxMB} MB.`);
      return;
    }
    if (kind === 'image' && (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type))) {
      setUploadError('HEIC photos can\'t be shown in web browsers. Export as JPG or PNG and upload that instead.');
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setUploading(false);
      setUploadError('Could not read the file from your device — please try again.');
    };
    reader.onload = async (ev) => {
      try {
        const base64 = (ev.target?.result as string).split(',')[1];
        const result = await api.uploadImage(base64, file.type || 'application/octet-stream', file.name);
        onDone(result.url);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed — check your connection and try again.');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadStatus = (
    <>
      {uploading && (
        <p className="flex items-center gap-1.5 mt-1 text-accent" style={{ fontSize: 11 }}>
          <Loader2 size={11} className="animate-spin" /> Uploading…
        </p>
      )}
      {uploadError && (
        <p className="flex items-start gap-1.5 mt-1 text-bad" style={{ fontSize: 11 }}>
          <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {uploadError}
        </p>
      )}
    </>
  );

  const uploadLabelCls = (busy: boolean) =>
    `flex items-center gap-2 w-full px-3 py-2 rounded-ctrl border border-dashed transition-colors ${busy
      ? 'border-accent/40 bg-accent-tint text-accent cursor-wait'
      : 'cursor-pointer border-baseline hover:border-accent/60 hover:bg-accent-tint text-muted hover:text-accent'}`;

  const authoredTriggers = (widget.triggers ?? []).filter(t => !t.id.startsWith('legacy_'));
  const meta = WIDGET_META[widget.type];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="wb-label">{meta?.label ?? widget.type}</span>
          {authoredTriggers.length > 0 && (
            <span className="trigger-pill" title={`${authoredTriggers.length} trigger${authoredTriggers.length !== 1 ? 's' : ''}`}>⚡ {authoredTriggers.length}</span>
          )}
        </div>
        {canEdit && (
          <button onClick={() => onRemoveWidget(widget.id)} title="Delete widget" className="wb-btn-ghost !min-h-0 p-1 hover:!text-bad">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Position / size / rotation — canvas mode only */}
      {isCanvas && (
        <div className="space-y-2.5 pb-3.5 border-b border-grid">
          <div className="wb-label flex items-center gap-1" style={{ fontSize: 10.5 }}>
            <LayoutGrid size={11} /> Layout
          </div>
          {/* Four one-character numeric fields, not a form: two abreast is
              readable at any width, so this one keeps its fixed pair. */}
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={Math.round(layout.x)} onChange={v => setLayout({ x: v })} />
            <NumField label="Y" value={Math.round(layout.y)} onChange={v => setLayout({ y: v })} />
            <NumField label="Width" value={Math.round(layout.width)} onChange={v => setLayout({ width: Math.max(8, v) })} />
            <NumField label="Height" value={Math.round(layout.height)} onChange={v => setLayout({ height: Math.max(8, v) })} />
          </div>
          <NumField label="Rotation (°)" value={Math.round(layout.rotation ?? 0)} onChange={v => setLayout({ rotation: v })} />
          <div>
            <label className="block mb-1 text-ink-2" style={{ fontSize: 12, fontWeight: 600 }}>Opacity ({Math.round((config.opacity ?? 1) * 100)}%)</label>
            <input type="range" min={0} max={100} value={Math.round((config.opacity ?? 1) * 100)} onChange={e => setConfig({ opacity: Number(e.target.value) / 100 })} className="w-full accent-[rgb(var(--accent-rgb))]" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => onRestack(widget.id, 'front')} className="wb-btn flex-1 justify-center !min-h-[32px] !text-[12px]"><MoveUp size={12} /> Front</button>
            <button onClick={() => onRestack(widget.id, 'back')} className="wb-btn flex-1 justify-center !min-h-[32px] !text-[12px]"><MoveDown size={12} /> Back</button>
          </div>
        </div>
      )}

      {/* Label (for most widgets) */}
      {!['text', 'button', 'separator', 'image', 'shape'].includes(widget.type) && (
        <Field label="Label">
          <input className="wb-input" value={widget.label} onChange={e => onUpdateWidget(widget.id, { label: e.target.value })} />
        </Field>
      )}

      {/* ── Per-type forms (moved from AppBuilder, token-restyled) ── */}

      {widget.type === 'text' && (
        <>
          <Field label="Text Content">
            <textarea className="wb-input resize-none" rows={3} value={config.text || ''} onChange={e => setConfig({ text: e.target.value })} />
          </Field>
          <Field label="Font Size">
            <input type="number" className="wb-input tnum" value={config.fontSize || 16} onChange={e => setConfig({ fontSize: parseInt(e.target.value) })} />
          </Field>
          <ColorField label="Color" value={config.color} fallback="#374151" onChange={v => setConfig({ color: v })} />
          <Field label="Font Weight">
            <select className="wb-input" value={config.fontWeight || 'normal'} onChange={e => setConfig({ fontWeight: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="semibold">Semibold</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
          <Field label="Alignment">
            <div className="seg w-full">
              {([['left', AlignLeftIcon], ['center', AlignCenter], ['right', AlignRight]] as const).map(([val, Ico]) => (
                <button key={val} onClick={() => setConfig({ textAlign: val })} className={`flex-1 ${(config.textAlign || 'left') === val ? 'is-active' : ''}`} aria-label={`Align ${val}`}>
                  <Ico size={13} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Vertical Align">
            <select className="wb-input" value={config.verticalAlign || 'top'} onChange={e => setConfig({ verticalAlign: e.target.value as 'top' | 'center' | 'bottom' })}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </Field>
          <Toggle checked={config.fontStyle === 'italic'} onChange={v => setConfig({ fontStyle: v ? 'italic' : 'normal' })} label="Italic" />
          {isCanvas && (
            <p className="text-muted" style={{ fontSize: 11 }}>Tip: use the rotation handle on the canvas (or the Rotation field above) for diagonal text.</p>
          )}
        </>
      )}

      {widget.type === 'instruction' && (
        <>
          <Field label="Content">
            <textarea className="wb-input resize-none" rows={5} value={config.content || ''} onChange={e => setConfig({ content: e.target.value })} />
          </Field>
          <ColorField label="Background Color" value={config.backgroundColor} fallback="#eff6ff" onChange={v => setConfig({ backgroundColor: v })} />
        </>
      )}

      {widget.type === 'button' && (
        <>
          <Field label="Button Text">
            <input className="wb-input" value={config.buttonText || ''} onChange={e => setConfig({ buttonText: e.target.value })} />
          </Field>
          <Field label="Button Action" hint={authoredTriggers.length > 0 ? 'This button also runs its triggers (Triggers tab).' : undefined}>
            <select
              className="wb-input"
              value={config.buttonType || 'next'}
              onChange={e => {
                const bt = e.target.value as 'next' | 'prev' | 'complete';
                setConfig({ buttonType: bt });
                // Keep the synthesized legacy trigger in step with buttonType.
                const legacy = (widget.triggers ?? []).find(t => t.id.startsWith('legacy_'));
                if (legacy) {
                  const map = { next: { type: 'next_step' as const }, prev: { type: 'prev_step' as const }, complete: { type: 'complete_app' as const } };
                  onUpdateWidget(widget.id, {
                    triggers: (widget.triggers ?? []).map(t => t.id === legacy.id ? { ...t, actions: [map[bt]] } : t),
                  });
                }
              }}
            >
              <option value="next">Go to Next Step</option>
              <option value="prev">Go to Previous Step</option>
              <option value="complete">Complete App</option>
            </select>
          </Field>
          {/* Prominent Actions summary — the button's triggers inline, with a
              jump to the Triggers tab (pre-filtered to this widget, which is
              already the selection driving that tab). */}
          <div className="wb-well px-2.5 py-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="wb-label flex items-center gap-1" style={{ fontSize: 10.5 }}>
                <Zap size={11} className="text-warn" /> Actions
              </span>
              <button
                type="button"
                onClick={() => onTab('triggers')}
                className="wb-btn-ghost !min-h-0 !px-1.5 py-0.5 text-accent"
                style={{ fontSize: 11.5, fontWeight: 600 }}
              >
                Edit actions
              </button>
            </div>
            {(() => {
              const all = widget.triggers ?? [];
              const labels = all.flatMap(t => t.actions.map(a => ACTION_LABELS[a.type] ?? a.type));
              if (all.length === 0) {
                return <p className="text-muted" style={{ fontSize: 11.5 }}>No actions yet — this button does nothing when pressed.</p>;
              }
              const shown = labels.slice(0, 3);
              const more = labels.length - shown.length;
              return (
                <p className="text-ink-2" style={{ fontSize: 11.5 }}>
                  <span className="tnum" style={{ fontWeight: 650 }}>{all.length} trigger{all.length !== 1 ? 's' : ''}</span>
                  {shown.length > 0 && <> · {shown.join(' · ')}{more > 0 ? ` · +${more} more` : ''}</>}
                </p>
              );
            })()}
          </div>
          <ColorField label="Color" value={config.buttonColor} fallback="#60a5fa" onChange={v => setConfig({ buttonColor: v })} />
          <ButtonColorReadout color={config.buttonColor || '#60a5fa'} />
          <Field label="Style">
            <div className="seg w-full">
              {(['solid', 'outline', 'ghost'] as const).map(v => (
                <button key={v} className={`flex-1 capitalize ${(config.buttonVariant ?? 'solid') === v ? 'is-active' : ''}`} onClick={() => setConfig({ buttonVariant: v })}>
                  {v}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Size">
            <select className="wb-input" value={config.buttonSize || 'md'} onChange={e => setConfig({ buttonSize: e.target.value as 'sm' | 'md' | 'lg' | 'xl' })}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
            </select>
          </Field>
          <Field label="Shape">
            <div className="seg w-full">
              {(['rounded', 'pill', 'square'] as const).map(s => (
                <button key={s} className={`flex-1 capitalize ${(config.buttonShape ?? 'rounded') === s ? 'is-active' : ''}`} onClick={() => setConfig({ buttonShape: s })}>
                  {s}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Icon">
            <div className="grid grid-cols-8 gap-1">
              <button
                type="button"
                title="No icon"
                aria-label="No icon"
                onClick={() => setConfig({ buttonIcon: undefined })}
                className={`h-8 rounded-ctrl border flex items-center justify-center text-muted transition-colors ${!config.buttonIcon ? 'border-accent bg-accent-tint text-accent' : 'border-baseline hover:border-accent/60'}`}
                style={{ fontSize: 12 }}
              >
                —
              </button>
              {Object.entries(BUTTON_ICONS).map(([name, IconCmp]) => (
                <button
                  key={name}
                  type="button"
                  title={name}
                  aria-label={`Icon ${name}`}
                  onClick={() => setConfig({ buttonIcon: name })}
                  className={`h-8 rounded-ctrl border flex items-center justify-center transition-colors ${config.buttonIcon === name ? 'border-accent bg-accent-tint text-accent' : 'border-baseline text-muted hover:border-accent/60 hover:text-accent'}`}
                >
                  <IconCmp size={14} />
                </button>
              ))}
            </div>
          </Field>
          <Toggle
            checked={config.fullWidth !== false}
            onChange={v => setConfig({ fullWidth: v })}
            label="Full width"
            hint="Only affects stacked-flow steps — on the canvas the button fills its box."
          />
        </>
      )}

      {widget.type === 'shape' && (
        <>
          <Field label="Shape">
            <div className="seg w-full">
              {([['rect', 'Rect'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow']] as const).map(([k, lbl]) => (
                <button key={k} className={`flex-1 ${(config.shapeKind ?? 'rect') === k ? 'is-active' : ''}`} onClick={() => setConfig({ shapeKind: k })}>
                  {lbl}
                </button>
              ))}
            </div>
          </Field>
          {((config.shapeKind ?? 'rect') === 'rect' || config.shapeKind === 'ellipse') && (
            <ColorField label="Fill" value={config.fill} fallback="#e0e7ff" onChange={v => setConfig({ fill: v })} />
          )}
          <ColorField label="Stroke" value={config.stroke} fallback="#6366f1" onChange={v => setConfig({ stroke: v })} />
          <Field label="Stroke width">
            <input
              type="number" className="wb-input tnum" min={0} step={0.5}
              value={config.strokeWidth ?? 1.5}
              onChange={e => setConfig({ strokeWidth: Math.max(0, parseFloat(e.target.value) || 0) })}
            />
          </Field>
          {(config.shapeKind ?? 'rect') === 'rect' && (
            <NumField label="Corner radius" value={config.cornerRadius ?? 0} onChange={v => setConfig({ cornerRadius: Math.max(0, v) })} />
          )}
          {!isCanvas && (
            <div>
              <label className="block mb-1 text-ink-2" style={{ fontSize: 12, fontWeight: 600 }}>Opacity ({Math.round((config.opacity ?? 1) * 100)}%)</label>
              <input type="range" min={0} max={100} value={Math.round((config.opacity ?? 1) * 100)} onChange={e => setConfig({ opacity: Number(e.target.value) / 100 })} className="w-full accent-[rgb(var(--accent-rgb))]" />
            </div>
          )}
          <p className="wb-well px-2.5 py-2 text-muted" style={{ fontSize: 11 }}>
            Decoration only — shapes capture no data and never appear in completion values. Rotate on the canvas for diagonal lines and arrows.
          </p>
        </>
      )}

      {(widget.type === 'text-input' || widget.type === 'number-input') && (
        <>
          <Field label="Placeholder">
            <input className="wb-input" value={config.placeholder || ''} onChange={e => setConfig({ placeholder: e.target.value })} />
          </Field>
          <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
        </>
      )}

      {widget.type === 'select-input' && (
        <>
          <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
          <Field label="Options (one per line)">
            <textarea className="wb-input resize-none font-mono" style={{ fontSize: 12 }} rows={5}
              value={(config.options || []).join('\n')}
              onChange={e => setConfig({ options: e.target.value.split('\n').filter(Boolean) })} />
          </Field>
        </>
      )}

      {widget.type === 'checkbox' && (
        <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
      )}

      {widget.type === 'timer' && (
        <>
          <Field label="Duration (seconds)">
            <input type="number" className="wb-input tnum" value={config.duration || 60} onChange={e => setConfig({ duration: parseInt(e.target.value) })} />
          </Field>
          <Toggle checked={!!config.autoStart} onChange={v => setConfig({ autoStart: v })} label="Start automatically" />
        </>
      )}

      {widget.type === 'counter' && (
        <>
          <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Initial" value={config.initialValue ?? 0} onChange={v => setConfig({ initialValue: v })} />
            <NumField label="Step" value={config.step ?? 1} onChange={v => setConfig({ step: v })} />
            <NumField label="Min" value={config.min ?? 0} onChange={v => setConfig({ min: v })} />
            <NumField label="Max" value={config.max ?? 100} onChange={v => setConfig({ max: v })} />
          </div>
        </>
      )}

      {widget.type === 'pass-fail' && (
        <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
      )}

      {widget.type === 'signature' && (
        <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
      )}

      {widget.type === 'image' && (
        <>
          <Field label="Image URL">
            <input className="wb-input" style={{ fontSize: 12 }} value={config.imageUrl || ''} onChange={e => setConfig({ imageUrl: e.target.value })} placeholder="https://example.com/image.png" />
          </Field>
          <Field label="Upload from Device">
            <label className={uploadLabelCls(uploading)} style={{ fontSize: 12 }}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Image size={13} />}
              {uploading ? 'Uploading…' : config.imageUrl ? 'Replace image…' : 'Choose image file…'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  uploadFile(file, 'image', url => setConfig({ imageUrl: url }));
                }}
              />
            </label>
            {uploadStatus}
            {config.imageUrl && (
              <div className="mt-1.5">
                <img src={config.imageUrl} alt="" className="max-h-16 rounded-ctrl border border-border-subtle object-contain" />
              </div>
            )}
          </Field>
          <Field label="Alt Text">
            <input className="wb-input" value={config.imageAlt || ''} onChange={e => setConfig({ imageAlt: e.target.value })} />
          </Field>
          <Field label="Fit">
            <select className="wb-input" value={config.imageFit || 'contain'} onChange={e => setConfig({ imageFit: e.target.value as 'contain' | 'cover' })}>
              <option value="contain">Contain (show whole image)</option>
              <option value="cover">Cover (fill, may crop)</option>
            </select>
          </Field>
        </>
      )}

      {widget.type === 'video' && (
        <>
          <Field label="Video Type">
            <select className="wb-input" value={config.videoType || 'youtube'} onChange={e => setConfig({ videoType: e.target.value as 'youtube' | 'upload', videoUrl: '' })}>
              <option value="youtube">YouTube / URL</option>
              <option value="upload">Upload Video File</option>
            </select>
          </Field>
          {config.videoType === 'upload' ? (
            <Field label="Upload Video">
              <label className={uploadLabelCls(uploading)} style={{ fontSize: 12 }}>
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}
                {uploading ? 'Uploading…' : config.videoUrl ? 'Replace video…' : 'Choose video file (.mp4, .webm, .mov)'}
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mov"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    uploadFile(file, 'video', url => setConfig({ videoUrl: url, videoType: 'upload' }));
                  }}
                />
              </label>
              {uploadStatus}
              {config.videoUrl && !uploading && <p className="mt-1 text-good" style={{ fontSize: 11 }}>✓ Video uploaded</p>}
            </Field>
          ) : (
            <Field label="YouTube URL or Video Link" hint="Paste a YouTube watch link, embed link, or any public video URL">
              <input
                className="wb-input"
                style={{ fontSize: 12 }}
                value={config.videoUrl || ''}
                onChange={e => setConfig({ videoUrl: e.target.value })}
                placeholder="https://youtube.com/watch?v=... or https://..."
              />
            </Field>
          )}
          <Toggle checked={!!config.videoControls} onChange={v => setConfig({ videoControls: v })} label="Show controls" />
          <Toggle checked={!!config.videoAutoplay} onChange={v => setConfig({ videoAutoplay: v })} label="Autoplay" />
        </>
      )}

      {widget.type === 'model-viewer' && (
        <>
          <Field label="Upload 3D Model">
            <label className={uploadLabelCls(uploading)} style={{ fontSize: 12 }}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Box size={13} />}
              {uploading ? 'Uploading…' : config.modelUrl ? 'Replace model…' : 'Choose file (.glb, .gltf, .obj, .stl)'}
              <input
                type="file"
                accept=".glb,.gltf,.obj,.stl,.3mf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  uploadFile(file, 'model', url => setConfig({ modelUrl: url }));
                }}
              />
            </label>
            {uploadStatus}
            {config.modelUrl && !uploading && (
              <p className="mt-1 text-good" style={{ fontSize: 11 }}>✓ Model uploaded: {config.modelUrl.split('/').pop()}</p>
            )}
          </Field>
          <Field label="Model URL (alternative)">
            <input className="wb-input" style={{ fontSize: 12 }} value={config.modelUrl || ''} onChange={e => setConfig({ modelUrl: e.target.value })} placeholder="https://... or /uploads/model.glb" />
          </Field>
          <Field label="Alt Text / Description">
            <input className="wb-input" value={config.modelAlt || ''} onChange={e => setConfig({ modelAlt: e.target.value })} placeholder="e.g. Hydraulic pump assembly" />
          </Field>
          <Toggle checked={!!config.modelAutoRotate} onChange={v => setConfig({ modelAutoRotate: v })} label="Auto-rotate" />
          <div className="wb-well px-2.5 py-1.5 text-muted" style={{ fontSize: 11 }}>
            Drag to rotate · Scroll to zoom · Supports .glb, .gltf, .obj, .stl
          </div>
        </>
      )}

      {/* ── v2 widget forms (spec §4.2) ── */}

      {widget.type === 'variable-display' && (
        <>
          <Field label="Variable to display">
            <select className="wb-input font-mono" style={{ fontSize: 12 }} value={config.variableRef || ''} onChange={e => setConfig({ variableRef: e.target.value })}>
              <option value="">— pick a variable —</option>
              {variables.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Format">
            <div className="seg w-full">
              <button className={`flex-1 ${(config.displayFormat || 'plain') === 'plain' ? 'is-active' : ''}`} onClick={() => setConfig({ displayFormat: 'plain' })}>Plain</button>
              <button className={`flex-1 ${config.displayFormat === 'stat' ? 'is-active' : ''}`} onClick={() => setConfig({ displayFormat: 'stat' })}>Stat tile</button>
            </div>
          </Field>
          {(config.displayFormat || 'plain') === 'plain' && (
            <>
              <Field label="Font Size">
                <input type="number" className="wb-input tnum" value={config.fontSize || 16} onChange={e => setConfig({ fontSize: parseInt(e.target.value) })} />
              </Field>
              <ColorField label="Color" value={config.color} fallback="#16233d" onChange={v => setConfig({ color: v })} />
            </>
          )}
        </>
      )}

      {widget.type === 'table-lookup' && (
        <TableLookupForm config={config} setConfig={setConfig} />
      )}

      {widget.type === 'kit-checklist' && (
        <>
          <Field label="Lines shown" hint="'This step' shows only kit lines whose point of use is the current step.">
            <div className="seg w-full">
              <button className={`flex-1 ${(config.kitScope || 'all') === 'all' ? 'is-active' : ''}`} onClick={() => setConfig({ kitScope: 'all' })}>Whole kit</button>
              <button className={`flex-1 ${config.kitScope === 'step' ? 'is-active' : ''}`} onClick={() => setConfig({ kitScope: 'step' })}>This step</button>
            </div>
          </Field>
          <Toggle checked={config.allowShort !== false} onChange={v => setConfig({ allowShort: v })} label="Allow marking lines short" hint="Operators can flag a missing part with a reason." />
          <Toggle checked={!!config.requireScan} onChange={v => setConfig({ requireScan: v })} label="Scan to verify only" hint="Disables tap-to-verify — every line must be scanned." />
        </>
      )}

      {widget.type === 'scan-input' && (
        <>
          <Field label="Scan writes to">
            <div className="seg w-full">
              <button className={`flex-1 ${(config.scanTarget || 'variable') === 'variable' ? 'is-active' : ''}`} onClick={() => setConfig({ scanTarget: 'variable' })}>Variable</button>
              <button className={`flex-1 ${config.scanTarget === 'kit' ? 'is-active' : ''}`} onClick={() => setConfig({ scanTarget: 'kit' })}>Kit line</button>
            </div>
          </Field>
          {(config.scanTarget || 'variable') === 'variable' && (
            <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
          )}
          {config.scanTarget === 'kit' && (
            <p className="wb-well px-2.5 py-2 text-muted" style={{ fontSize: 11.5 }}>
              Scans attempt kit-line verification — a code matching a line&rsquo;s scan code or SKU marks it verified.
            </p>
          )}
        </>
      )}

      {widget.type === 'photo-capture' && (
        <>
          <VariableNameSelect value={config.variableName || ''} variables={variables} widgetTypeHint={widget.type} onChange={name => setConfig({ variableName: name })} onRegister={registerVariable} />
          <NumField label="Max photos" value={config.maxPhotos ?? 1} onChange={v => setConfig({ maxPhotos: Math.max(1, v) })} />
        </>
      )}

      {/* ── Validation section (spec §4.1) ── */}
      {INPUT_WIDGET_TYPES.includes(widget.type) && (
        <div className="space-y-3 pt-3.5 border-t border-grid">
          <div className="wb-label" style={{ fontSize: 10.5 }}>Validation</div>
          <Toggle
            checked={!!config.required}
            onChange={v => setConfig({ required: v })}
            label={widget.type === 'checkbox' ? 'Must be checked to proceed' : 'Required field'}
            hint="Blocks Next / Complete while empty."
          />
          {widget.type === 'number-input' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Min" value={config.min ?? 0} onChange={v => setConfig({ min: v })} />
                <NumField label="Max" value={config.max ?? 100} onChange={v => setConfig({ max: v })} />
                <NumField label="Decimals" value={config.decimals ?? 0} onChange={v => setConfig({ decimals: Math.max(0, v) })} />
              </div>
              <Toggle
                checked={!!config.enforceRange}
                onChange={v => setConfig({ enforceRange: v })}
                label="Enforce range"
                hint="Out-of-range values show an error and block navigation."
              />
            </>
          )}
          {widget.type === 'scan-input' && (
            <Field label="Expected pattern (regex)" hint="Scans that don't match are rejected.">
              <input className="wb-input font-mono" style={{ fontSize: 12 }} placeholder="e.g. ^SN-\d{6}$" value={config.expectedPattern || ''} onChange={e => setConfig({ expectedPattern: e.target.value })} />
            </Field>
          )}
        </div>
      )}

      {/* Trigger shortcut */}
      {step && eventsFor({ kind: 'widget', widget, step }).length > 0 && (
        <div className="pt-3.5 border-t border-grid">
          <button
            onClick={() => onEditTrigger({ kind: 'widget', widget, step }, null)}
            disabled={!canEdit}
            className="wb-btn w-full justify-center !text-[12.5px]"
          >
            <Zap size={13} className="text-warn" /> Add trigger
            {authoredTriggers.length > 0 && <span className="trigger-pill ml-1">⚡ {authoredTriggers.length}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

function TableLookupForm({ config, setConfig }: {
  config: Widget['config'];
  setConfig: (cfg: Partial<Widget['config']>) => void;
}) {
  interface TableLite { id: string; name: string; fields?: { id: string; name: string }[]; }
  const [tables, setTables] = useState<TableLite[] | null>(null);
  const [fields, setFields] = useState<{ id: string; name: string }[]>([]);
  const [showImport, setShowImport] = useState(false);
  useEffect(() => {
    api.getTables().then((ts: TableLite[]) => setTables(ts)).catch(() => setTables([]));
  }, []);
  useEffect(() => {
    if (config.tableId) {
      api.getTable(config.tableId)
        .then((t: TableLite) => setFields(t.fields ?? []))
        .catch(() => setFields([]));
    } else {
      setFields([]);
    }
  }, [config.tableId]);

  const handleImported = (t: { id: string; name: string; fields?: { id: string; name: string }[] }) => {
    setShowImport(false);
    setTables(prev => [...(prev ?? []), t]);
    // Auto-select the freshly imported table on the widget.
    setConfig({ tableId: t.id, lookupFieldId: '', displayFieldIds: [] });
  };

  return (
    <>
      <Field label="Table">
        <select className="wb-input" value={config.tableId || ''} onChange={e => setConfig({ tableId: e.target.value, lookupFieldId: '', displayFieldIds: [] })}>
          <option value="">— pick a table —</option>
          {(tables ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {tables !== null && tables.length === 0 && (
          <p className="mt-1 text-muted" style={{ fontSize: 11 }}>No tables yet — import a spreadsheet to create one.</p>
        )}
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="mt-1.5 inline-flex items-center gap-1 text-accent hover:underline"
          style={{ fontSize: 12, fontWeight: 600 }}
        >
          <Upload size={12} /> Import a spreadsheet…
        </button>
      </Field>
      {showImport && (
        <TableImportModal onClose={() => setShowImport(false)} onImported={handleImported} />
      )}
      {config.tableId && (
        <>
          <Field label="Match field" hint="The table field compared against the variable.">
            <select className="wb-input" value={config.lookupFieldId || ''} onChange={e => setConfig({ lookupFieldId: e.target.value })}>
              <option value="">— field —</option>
              {fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="Match variable">
            <input className="wb-input font-mono" style={{ fontSize: 12 }} placeholder="variable_name" value={config.matchVariable || ''} onChange={e => setConfig({ matchVariable: e.target.value })} />
          </Field>
          <Field label="Fields to display">
            <div className="space-y-1">
              {fields.map(f => {
                const on = (config.displayFieldIds ?? []).includes(f.id);
                return (
                  <label key={f.id} className="flex items-center gap-2 cursor-pointer text-ink-2" style={{ fontSize: 12.5 }}>
                    <input
                      type="checkbox"
                      className="rounded accent-[rgb(var(--accent-rgb))]"
                      checked={on}
                      onChange={() => {
                        const cur = config.displayFieldIds ?? [];
                        setConfig({ displayFieldIds: on ? cur.filter(id => id !== f.id) : [...cur, f.id] });
                      }}
                    />
                    {f.name}
                  </label>
                );
              })}
              {fields.length === 0 && <p className="text-muted" style={{ fontSize: 11.5 }}>No fields in this table.</p>}
            </div>
          </Field>
        </>
      )}
    </>
  );
}

// ─── Step tab ─────────────────────────────────────────────────────────────────

function StepTab({ app, step, canEdit, onUpdateStep, onSetMode }: {
  app: App;
  step: Step;
  canEdit: boolean;
  onUpdateStep: (updater: (s: Step) => Step) => void;
  onSetMode: (m: 'flow' | 'canvas') => void;
}) {
  const isCanvas = step.layoutMode === 'canvas';
  const groups = app.step_groups ?? [];
  const [partsOpen, setPartsOpen] = useState(false);
  const fieldsetDisabled = !canEdit;

  return (
    <fieldset disabled={fieldsetDisabled} className="space-y-4 border-0 p-0 m-0 min-w-0">
      <div className="wb-label">Step</div>
      <Field label="Step Name">
        <input className="wb-input" value={step.name} onChange={e => onUpdateStep(s => ({ ...s, name: e.target.value }))} />
      </Field>

      <Field label="Layout" hint={isCanvas ? 'Drag, resize, and rotate widgets anywhere — like a slide.' : 'Widgets stack top-to-bottom automatically.'}>
        <div className="seg w-full">
          <button onClick={() => onSetMode('flow')} className={`flex-1 ${!isCanvas ? 'is-active' : ''}`}>
            <Rows3 size={13} /> Stacked
          </button>
          <button onClick={() => onSetMode('canvas')} className={`flex-1 ${isCanvas ? 'is-active' : ''}`}>
            <LayoutGrid size={13} /> Free-form
          </button>
        </div>
      </Field>

      {isCanvas && (
        <>
          <Field label="Canvas Height (px)">
            <input type="number" className="wb-input tnum" min={200} step={20}
              value={step.canvasHeight ?? 560}
              onChange={e => onUpdateStep(s => ({ ...s, canvasHeight: Math.max(200, parseInt(e.target.value) || 560) }))} />
          </Field>
          <ColorField label="Background" value={step.canvasBackground} fallback="#ffffff" onChange={v => onUpdateStep(s => ({ ...s, canvasBackground: v }))} />
        </>
      )}

      <Field label="Step Type" hint={step.step_type === 'kit' ? 'Forward navigation gates on the kit being complete.' : undefined}>
        <div className="seg w-full">
          <button onClick={() => onUpdateStep(s => ({ ...s, step_type: 'standard' }))} className={`flex-1 ${(step.step_type ?? 'standard') === 'standard' ? 'is-active' : ''}`}>Standard</button>
          <button onClick={() => onUpdateStep(s => ({ ...s, step_type: 'kit' }))} className={`flex-1 ${step.step_type === 'kit' ? 'is-active' : ''}`}>
            <Package size={12} /> Kit
          </button>
        </div>
      </Field>

      {groups.length > 0 && (
        <Field label="Group">
          <select
            className="wb-input"
            value={step.group_id ?? ''}
            onChange={e => onUpdateStep(s => ({ ...s, group_id: e.target.value || undefined }))}
          >
            <option value="">— none —</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Takt Time (seconds)">
        <div className="space-y-1">
          <input
            type="number"
            className="wb-input tnum"
            placeholder="0 = no limit"
            value={step.takt_time_seconds || ''}
            onChange={e => onUpdateStep(s => ({ ...s, takt_time_seconds: e.target.value ? parseInt(e.target.value) : undefined }))}
            min={0}
          />
          {step.takt_time_seconds ? (
            <div className="tnum text-accent" style={{ fontSize: 11.5, fontWeight: 550 }}>
              ⏱ {Math.floor(step.takt_time_seconds / 60)}m {step.takt_time_seconds % 60}s — operator sees alert if exceeded
            </div>
          ) : (
            <div className="text-muted" style={{ fontSize: 11 }}>Set a takt time to show operators a flashing alert when exceeded</div>
          )}
        </div>
      </Field>

      <Field label="Step Description">
        <textarea className="wb-input resize-none" style={{ fontSize: 12 }} rows={2}
          value={step.description || ''}
          placeholder="Optional notes for this step..."
          onChange={e => onUpdateStep(s => ({ ...s, description: e.target.value }))} />
      </Field>

      {/* Legacy parts list — kept, collapsed by default (spec §4.1) */}
      <div className="wb-well overflow-hidden">
        <button
          type="button"
          onClick={() => setPartsOpen(o => !o)}
          className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left"
        >
          {partsOpen ? <ChevronDown size={13} className="text-muted" /> : <ChevronRight size={13} className="text-muted" />}
          <Package size={12} className="text-muted" />
          <span className="text-ink-2" style={{ fontSize: 12, fontWeight: 600 }}>Legacy parts list</span>
          <span className="tnum ml-auto text-muted" style={{ fontSize: 11 }}>{step.parts_list?.length ?? 0}</span>
        </button>
        {partsOpen && (
          <div className="px-2.5 pb-2.5 space-y-2">
            <p className="text-muted" style={{ fontSize: 10.5 }}>Superseded by BOMs — kept for apps that still use it.</p>
            {(step.parts_list ?? []).map((part, idx) => (
              <div key={idx} className="bg-surface-1 rounded-ctrl border border-border-subtle p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    className="wb-input !min-h-0 !py-1 flex-1" style={{ fontSize: 12 }}
                    placeholder="Part name"
                    value={part.name}
                    onChange={e => onUpdateStep(s => ({
                      ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, name: e.target.value } : p)
                    }))}
                  />
                  <button
                    onClick={() => onUpdateStep(s => ({ ...s, parts_list: s.parts_list!.filter((_, i) => i !== idx) }))}
                    className="wb-btn-ghost !min-h-0 p-1 hover:!text-bad flex-shrink-0"
                    aria-label="Remove part"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <input className="wb-input !min-h-0 !py-1 font-mono" style={{ fontSize: 11.5 }} placeholder="SKU" value={part.sku || ''}
                    onChange={e => onUpdateStep(s => ({ ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, sku: e.target.value } : p) }))} />
                  <input type="number" className="wb-input !min-h-0 !py-1 tnum" style={{ fontSize: 11.5 }} placeholder="Qty" min={0.001} step={0.001} value={part.quantity}
                    onChange={e => onUpdateStep(s => ({ ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, quantity: Number(e.target.value) } : p) }))} />
                  <input className="wb-input !min-h-0 !py-1" style={{ fontSize: 11.5 }} placeholder="Unit" value={part.unit || ''}
                    onChange={e => onUpdateStep(s => ({ ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, unit: e.target.value } : p) }))} />
                </div>
              </div>
            ))}
            <button
              onClick={() => onUpdateStep(s => ({ ...s, parts_list: [...(s.parts_list || []), { name: '', quantity: 1, unit: 'ea' }] }))}
              className="wb-btn-ghost !min-h-0 !px-1 text-accent" style={{ fontSize: 11.5 }}
            >
              <PlusCircle size={11} /> Add part
            </button>
          </div>
        )}
      </div>

      <div className="wb-well px-2.5 py-2 text-muted tnum" style={{ fontSize: 11.5 }}>
        {step.widgets.length} widget{step.widgets.length !== 1 ? 's' : ''}
        {(step.parts_list?.length ?? 0) > 0 && ` · ${step.parts_list!.length} part${step.parts_list!.length !== 1 ? 's' : ''}`}
      </div>
    </fieldset>
  );
}

// ─── App tab ──────────────────────────────────────────────────────────────────

/** Accordion section chrome for the long App-tab forms. */
function Section({ title, icon: Icon, defaultOpen = true, children }: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-3.5 border-t border-grid">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-left"
      >
        {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
        <span className="wb-label flex items-center gap-1" style={{ fontSize: 10.5 }}>
          {Icon && <Icon size={11} />} {title}
        </span>
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

function AppTab({ app, canEdit, departments, stations, productTypes, onUpdateApp, onUpdateProductTypes }: {
  app: App;
  canEdit: boolean;
  departments: Department[];
  stations: Station[];
  productTypes: ProductType[];
  onUpdateApp: (updater: (prev: App) => App) => void;
  onUpdateProductTypes: (pts: ProductType[]) => void;
}) {
  const showTakt = app.show_takt_warnings === undefined ? true : !!app.show_takt_warnings;
  const explicitRunCtx = requireRunContextValue(app);
  const effectiveRunCtx = effectiveRequireRunContext(app);
  const availableStations = app.department_id
    ? stations.filter(s => s.department_id === app.department_id)
    : stations;

  return (
    <fieldset disabled={!canEdit} className="space-y-4 border-0 p-0 m-0 min-w-0">
      <div className="wb-label flex items-center gap-1"><Settings size={11} /> App</div>
      <Field label="App Name">
        <input className="wb-input" value={app.name} onChange={e => onUpdateApp(prev => ({ ...prev, name: e.target.value }))} />
      </Field>
      <Field label="Description">
        <textarea className="wb-input resize-none" style={{ fontSize: 12 }} rows={2} value={app.description || ''}
          onChange={e => onUpdateApp(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description..." />
      </Field>
      <Toggle
        checked={showTakt}
        onChange={v => onUpdateApp(prev => ({ ...prev, show_takt_warnings: v ? 1 : 0 }))}
        label="Show takt-time warnings to operators"
        hint="Operators see a flashing alert when a step exceeds its takt time."
      />

      {/* Run requirements (app.require_run_context — player contract) */}
      <div className="space-y-2.5 pt-3.5 border-t border-grid">
        <div className="wb-label" style={{ fontSize: 10.5 }}>Run requirements</div>
        <Toggle
          checked={effectiveRunCtx}
          onChange={v => onUpdateApp(prev => {
            const next: AppWithRunContext = { ...prev, require_run_context: v };
            return next;
          })}
          label="Require a work order or part number to run"
          hint="Operators must attach a work order or part number before the app will start."
        />
        <p className="wb-well px-2.5 py-1.5 text-muted" style={{ fontSize: 11 }}>
          Effective: <span className="text-ink-2" style={{ fontWeight: 650 }}>{effectiveRunCtx ? 'required' : 'not required'}</span>
          {explicitRunCtx === undefined && ' — default for v2 apps; saving stores it explicitly.'}
        </p>
      </div>

      {/* Publish targeting (relocated modal content) */}
      <Section title="Publish target">
        <Field label="Department">
          <select
            className="wb-input"
            value={app.department_id || ''}
            onChange={e => {
              const deptId = e.target.value || null;
              onUpdateApp(prev => ({
                ...prev,
                department_id: deptId,
                station_id: deptId && prev.station_id && !stations.some(s => s.id === prev.station_id && s.department_id === deptId)
                  ? null : prev.station_id,
              }));
            }}
          >
            <option value="">— No department —</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Workstation">
          <select className="wb-input" value={app.station_id || ''} onChange={e => onUpdateApp(prev => ({ ...prev, station_id: e.target.value || null }))}>
            <option value="">— No workstation —</option>
            {availableStations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {app.department_id && availableStations.length === 0 && (
            <p className="mt-1 text-warn-ink" style={{ fontSize: 11 }}>No workstations in this department yet.</p>
          )}
        </Field>
      </Section>

      {/* Product types manager (relocated modal content) */}
      <Section title="Product types" icon={Tag}>
        <ProductTypesManager app={app} productTypes={productTypes} onUpdate={onUpdateProductTypes} canEdit={canEdit} />
      </Section>

      <div className="wb-well px-2.5 py-2 text-muted" style={{ fontSize: 11 }}>
        Canvas resolution is a fixed 720px logical width — steps scale uniformly to any screen.
      </div>
    </fieldset>
  );
}

function ProductTypesManager({ app, productTypes, onUpdate, canEdit }: {
  app: App;
  productTypes: ProductType[];
  onUpdate: (pts: ProductType[]) => void;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<ProductType | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => { setEditing(null); setAdding(false); setName(''); setDesc(''); setOverrides({}); };

  const startEdit = (pt: ProductType) => {
    setEditing(pt); setAdding(true);
    setName(pt.name); setDesc(pt.description);
    const ov: Record<string, string> = {};
    for (const [k, v] of Object.entries(pt.takt_overrides)) ov[k] = String(v);
    setOverrides(ov);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const takt: Record<string, number> = {};
      for (const [k, v] of Object.entries(overrides)) if (v.trim()) takt[k] = Number(v);
      if (editing) {
        const updated = await api.updateProductType(editing.id, { name: name.trim(), description: desc.trim(), takt_overrides: takt });
        onUpdate(productTypes.map(p => p.id === editing.id ? updated : p));
      } else {
        const created = await api.createProductType({ app_id: app.id, name: name.trim(), description: desc.trim(), takt_overrides: takt });
        onUpdate([...productTypes, created]);
      }
      reset();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save product type');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pt: ProductType) => {
    if (!confirm(`Delete product type "${pt.name}"?`)) return;
    try {
      await api.deleteProductType(pt.id);
      onUpdate(productTypes.filter(p => p.id !== pt.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete product type');
    }
  };

  return (
    <div className="space-y-2">
      {productTypes.map(pt => (
        <div key={pt.id} className="wb-well px-2.5 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="truncate text-ink" style={{ fontSize: 12.5, fontWeight: 650 }}>{pt.name}</div>
              {pt.description && <div className="truncate text-muted" style={{ fontSize: 11 }}>{pt.description}</div>}
              {Object.keys(pt.takt_overrides).length > 0 && (
                <div className="tnum text-muted mt-0.5" style={{ fontSize: 10.5 }}>
                  {Object.keys(pt.takt_overrides).length} takt override{Object.keys(pt.takt_overrides).length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {canEdit && <button onClick={() => startEdit(pt)} className="wb-btn-ghost !min-h-0 px-1.5 py-0.5" style={{ fontSize: 11 }}>Edit</button>}
              {canEdit && <button onClick={() => remove(pt)} className="wb-btn-ghost !min-h-0 p-1 hover:!text-bad" aria-label={`Delete ${pt.name}`}><Trash2 size={12} /></button>}
            </div>
          </div>
          <Link
            to={`/inventory/boms?product_type_id=${pt.id}`}
            className="mt-1 inline-flex items-center gap-1 text-accent hover:underline"
            style={{ fontSize: 11, fontWeight: 600 }}
          >
            BOM <ExternalLink size={10} />
          </Link>
        </div>
      ))}
      {productTypes.length === 0 && !adding && (
        <p className="text-muted" style={{ fontSize: 11.5 }}>No product types — operators run the app without one.</p>
      )}

      {adding ? (
        <div className="wb-well p-2.5 space-y-2">
          <div className="wb-label" style={{ fontSize: 10 }}>{editing ? `Editing: ${editing.name}` : 'New product type'}</div>
          <input className="wb-input !min-h-[34px]" style={{ fontSize: 12.5 }} placeholder="Name — e.g. Model A" value={name} onChange={e => setName(e.target.value)} />
          <input className="wb-input !min-h-[34px]" style={{ fontSize: 12.5 }} placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          {app.steps.length > 0 && (
            <div>
              <div className="text-ink-2 mb-1" style={{ fontSize: 11.5, fontWeight: 600 }}>Takt overrides (seconds; blank = step default)</div>
              <div className="space-y-1">
                {app.steps.map((s, idx) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span className="truncate text-muted flex-shrink-0" style={{ fontSize: 11, width: 100 }}>{idx + 1}. {s.name}</span>
                    <input
                      type="number"
                      className="wb-input !min-h-0 !py-1 tnum flex-1" style={{ fontSize: 11.5 }}
                      placeholder={s.takt_time_seconds ? `${s.takt_time_seconds}s` : '—'}
                      value={overrides[idx] ?? ''}
                      min={0}
                      onChange={e => setOverrides(prev => {
                        const next = { ...prev };
                        if (e.target.value) next[idx] = e.target.value;
                        else delete next[idx];
                        return next;
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={save} disabled={!name.trim() || saving} className="wb-btn-primary !min-h-[32px] !px-3" style={{ fontSize: 12 }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              {editing ? 'Update' : 'Add'}
            </button>
            <button onClick={reset} className="wb-btn !min-h-[32px] !px-3" style={{ fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      ) : canEdit ? (
        <button onClick={() => setAdding(true)} className="wb-btn-ghost !min-h-0 !px-1 text-accent" style={{ fontSize: 12 }}>
          <Plus size={12} /> Add product type
        </button>
      ) : null}
    </div>
  );
}

// ─── Triggers tab ─────────────────────────────────────────────────────────────

const EVENT_SUMMARY: Record<string, string> = {
  button_press: 'On button press',
  step_enter: 'On step enter',
  step_exit: 'On step exit',
  input_change: 'On input change',
  timer_done: 'On timer done',
  scan: 'On scan',
};

function TriggersTab({ app, step, selectedWidget, canEdit, onEditTrigger }: {
  app: App;
  step: Step;
  selectedWidget: Widget | null;
  canEdit: boolean;
  onEditTrigger: (attachment: TriggerAttachment, trigger: Trigger | null) => void;
}) {
  const attachment: TriggerAttachment = selectedWidget
    ? { kind: 'widget', widget: selectedWidget, step }
    : { kind: 'step', step };
  const triggers = selectedWidget ? (selectedWidget.triggers ?? []) : (step.triggers ?? []);
  const canAttach = eventsFor(attachment).length > 0;
  const targetLabel = selectedWidget
    ? (selectedWidget.label || WIDGET_META[selectedWidget.type]?.label || selectedWidget.type)
    : (step.name || 'Step');

  return (
    <div className="space-y-3">
      <div>
        <div className="wb-label">Triggers</div>
        <p className="text-muted mt-0.5" style={{ fontSize: 11.5 }}>
          {selectedWidget ? 'For the selected widget' : 'For the current step'} · <span className="font-mono">{targetLabel}</span>
        </p>
      </div>

      {triggers.length === 0 && (
        <div className="wb-well px-3 py-5 text-center">
          <Zap size={18} className="mx-auto mb-1.5 text-muted opacity-60" />
          <p className="text-muted" style={{ fontSize: 12 }}>
            {canAttach
              ? 'No triggers yet. Triggers run logic when things happen — navigate, set variables, save records, raise NCRs.'
              : 'This widget type can’t fire events. Select the step (click empty canvas) or an interactive widget.'}
          </p>
        </div>
      )}

      {triggers.map(t => {
        const isLegacy = t.id.startsWith('legacy_');
        return (
          <button
            key={t.id}
            onClick={() => onEditTrigger(attachment, t)}
            className="w-full text-left wb-well px-3 py-2.5 hover:border-accent/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Zap size={13} className={t.enabled === false ? 'text-baseline' : 'text-warn'} />
              <span className={`flex-1 truncate ${t.enabled === false ? 'text-muted line-through' : 'text-ink'}`} style={{ fontSize: 13, fontWeight: 650 }}>
                {t.name || EVENT_SUMMARY[t.event] || t.event}
              </span>
              {isLegacy && <span className="text-muted flex-shrink-0" style={{ fontSize: 10 }}>legacy button</span>}
            </div>
            <div className="mt-1 text-muted truncate" style={{ fontSize: 11.5 }}>
              {EVENT_SUMMARY[t.event] || t.event}
              {t.conditions.length > 0 && ` · ${t.conditions.length} condition${t.conditions.length !== 1 ? 's' : ''} (${t.match})`}
              {` · ${t.actions.length} action${t.actions.length !== 1 ? 's' : ''}`}
            </div>
          </button>
        );
      })}

      {canAttach && canEdit && (
        <button onClick={() => onEditTrigger(attachment, null)} className="wb-btn w-full justify-center !text-[12.5px]">
          <Plus size={13} /> Add trigger
        </button>
      )}
    </div>
  );
}
