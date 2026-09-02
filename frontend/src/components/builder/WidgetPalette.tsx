// ─── Widget palette — ribbon-style tabbed toolbar above the canvas (spec §4.1) ─
// Excel-ribbon category tabs (Display / Inputs / Actions / Production) across
// the top; the row below shows only the active category's widget buttons.
// Also the shared registry of widget metadata (icon/label/group) and the
// defaultWidget() factory, imported by AppBuilder / StepList / ContextPanel.

import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Type, AlignLeft, Image, Video, Box, Minus, Variable, Shapes,
  TextCursor, Hash, List, CheckSquare, ScanLine, Camera, PenTool,
  MousePointer, PackageCheck, Table2, Timer, TrendingUp, CheckCheck,
} from 'lucide-react';
import type { Widget, WidgetType } from '../../types';
import { v4 as uuidv4 } from '../../utils/uuid';

export interface WidgetMeta { icon: LucideIcon; label: string; group: string; }

/** Every placeable widget type — 15 legacy + 5 v2 (§4.2). */
export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  // Display
  'text':             { icon: Type,        label: 'Text',          group: 'Display' },
  'instruction':      { icon: AlignLeft,   label: 'Instruction',   group: 'Display' },
  'image':            { icon: Image,       label: 'Image',         group: 'Display' },
  'video':            { icon: Video,       label: 'Video',         group: 'Display' },
  'model-viewer':     { icon: Box,         label: '3D Model',      group: 'Display' },
  'separator':        { icon: Minus,       label: 'Separator',     group: 'Display' },
  'variable-display': { icon: Variable,    label: 'Variable',      group: 'Display' },
  'shape':            { icon: Shapes,      label: 'Shape',         group: 'Display' },
  // Inputs
  'text-input':       { icon: TextCursor,  label: 'Text Input',    group: 'Inputs' },
  'number-input':     { icon: Hash,        label: 'Number',        group: 'Inputs' },
  'select-input':     { icon: List,        label: 'Dropdown',      group: 'Inputs' },
  'checkbox':         { icon: CheckSquare, label: 'Checkbox',      group: 'Inputs' },
  'scan-input':       { icon: ScanLine,    label: 'Scan',          group: 'Inputs' },
  'photo-capture':    { icon: Camera,      label: 'Photo',         group: 'Inputs' },
  'signature':        { icon: PenTool,     label: 'Signature',     group: 'Inputs' },
  // Actions
  'button':           { icon: MousePointer, label: 'Button',       group: 'Actions' },
  // Production
  'kit-checklist':    { icon: PackageCheck, label: 'Kit Checklist', group: 'Production' },
  'table-lookup':     { icon: Table2,      label: 'Table Lookup',  group: 'Production' },
  'timer':            { icon: Timer,       label: 'Timer',         group: 'Production' },
  'counter':          { icon: TrendingUp,  label: 'Counter',       group: 'Production' },
  'pass-fail':        { icon: CheckCheck,  label: 'Pass / Fail',   group: 'Production' },
};

export const PALETTE_GROUPS = ['Display', 'Inputs', 'Actions', 'Production'] as const;

/** Input-like widget types — they capture values, carry variableName, can fire
 *  input_change triggers, and are offered a "Required field" switch here.
 *  The list LIVES in the player runtime (the leaf module) so the one place that
 *  enforces "required" and the one place that offers it cannot drift apart;
 *  re-exported here because the builder surfaces import it from the palette.
 *  The dependency only runs one way: the player never imports the builder. */
export { INPUT_WIDGET_TYPES } from '../player/runtime';

export function defaultWidget(type: WidgetType): Widget {
  const base: Widget = { id: uuidv4(), type, label: '', order: 0, config: {} };
  switch (type) {
    case 'text': return { ...base, label: '', config: { text: 'Enter text here', fontSize: 16, color: '#374151' } };
    case 'instruction': return { ...base, label: 'Instructions', config: { content: 'Step instructions go here...', backgroundColor: '#eff6ff' } };
    case 'button': return { ...base, label: '', config: { buttonText: 'Next', buttonType: 'next', buttonColor: '#60a5fa', buttonSize: 'md', buttonVariant: 'solid', buttonShape: 'rounded', fullWidth: true } };
    case 'text-input': return { ...base, label: 'Text Field', config: { placeholder: 'Enter value...', required: false, variableName: `field_${Date.now()}` } };
    case 'number-input': return { ...base, label: 'Number Field', config: { placeholder: '0', required: false, variableName: `num_${Date.now()}` } };
    case 'select-input': return { ...base, label: 'Select Field', config: { options: ['Option 1', 'Option 2', 'Option 3'], variableName: `sel_${Date.now()}` } };
    case 'checkbox': return { ...base, label: 'Checkbox', config: { required: false, variableName: `check_${Date.now()}` } };
    case 'timer': return { ...base, label: 'Timer', config: { duration: 300, autoStart: false } };
    case 'counter': return { ...base, label: 'Counter', config: { min: 0, max: 100, step: 1, initialValue: 0, variableName: `counter_${Date.now()}` } };
    case 'pass-fail': return { ...base, label: 'Quality Check', config: { variableName: `qc_${Date.now()}` } };
    case 'separator': return { ...base, label: '', config: {} };
    case 'image': return { ...base, label: '', config: { imageUrl: '', imageAlt: '' } };
    case 'signature': return { ...base, label: 'Signature', config: { variableName: `sig_${Date.now()}` } };
    case 'video': return { ...base, label: 'Video', config: { videoType: 'youtube', videoUrl: '', videoControls: true, videoAutoplay: false } };
    case 'model-viewer': return { ...base, label: '3D Model', config: { modelUrl: '', modelAlt: '3D Model', modelAutoRotate: true, modelShadowIntensity: 0.8, modelExposure: 1 } };
    // ── v2 widgets (§4.2) ──
    case 'variable-display': return { ...base, label: '', config: { variableRef: '', displayFormat: 'stat' } };
    case 'table-lookup': return { ...base, label: 'Lookup', config: { tableId: '', lookupFieldId: '', matchVariable: '', displayFieldIds: [] } };
    case 'kit-checklist': return { ...base, label: 'Kit', config: { kitScope: 'all', allowShort: true, requireScan: false } };
    case 'scan-input': return { ...base, label: 'Scan Code', config: { variableName: `scan_${Date.now()}`, scanTarget: 'variable', required: false } };
    case 'photo-capture': return { ...base, label: 'Photo', config: { variableName: `photo_${Date.now()}`, maxPhotos: 1, required: false } };
    // Canvas decoration — a soft indigo rect by default; never captured.
    case 'shape': return { ...base, label: '', config: { shapeKind: 'rect', fill: '#e0e7ff', stroke: '#6366f1', strokeWidth: 1.5, cornerRadius: 12, opacity: 1 } };
    default: return base;
  }
}

// ─── The ribbon toolbar ───────────────────────────────────────────────────────

export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/** localStorage key for the active ribbon tab (persists per browser session). */
export const PALETTE_TAB_STORAGE_KEY = 'hm.builder.paletteTab';

function loadPaletteTab(): PaletteGroup {
  try {
    const v = localStorage.getItem(PALETTE_TAB_STORAGE_KEY);
    if (v && (PALETTE_GROUPS as readonly string[]).includes(v)) return v as PaletteGroup;
  } catch { /* storage unavailable (private mode, SSR) — fall through */ }
  return PALETTE_GROUPS[0];
}

export default function WidgetPalette({ onAdd, disabled }: {
  onAdd: (type: WidgetType) => void;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<PaletteGroup>(loadPaletteTab);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectTab = (g: PaletteGroup) => {
    setTab(g);
    try { localStorage.setItem(PALETTE_TAB_STORAGE_KEY, g); } catch { /* noop */ }
  };

  // Roving-tabindex arrow-key navigation between category tabs.
  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (idx + dir + PALETTE_GROUPS.length) % PALETTE_GROUPS.length;
    selectTab(PALETTE_GROUPS[next]);
    tabRefs.current[next]?.focus();
  };

  const types = (Object.keys(WIDGET_META) as WidgetType[]).filter(t => WIDGET_META[t].group === tab);

  return (
    <div className="flex-shrink-0 bg-surface-1 border-b border-border-subtle">
      {/* Category tabs */}
      {/* Four category names are wider than a phone, so the row carries its own
          scroller rather than widening the builder. */}
      <div role="tablist" aria-label="Widget categories" className="flex items-end gap-0.5 px-2 border-b border-grid overflow-x-auto">
        {PALETTE_GROUPS.map((g, i) => (
          <button
            key={g}
            ref={el => { tabRefs.current[i] = el; }}
            role="tab"
            id={`palette-tab-${g}`}
            aria-selected={tab === g}
            aria-controls="palette-tabpanel"
            tabIndex={tab === g ? 0 : -1}
            onClick={() => selectTab(g)}
            onKeyDown={e => handleTabKeyDown(e, i)}
            className={`gold-tab shrink-0 whitespace-nowrap px-3 py-1.5 ${tab === g ? 'is-active' : ''}`}
            style={{ fontSize: 12 }}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Active category's widget buttons */}
      <div
        id="palette-tabpanel"
        role="tabpanel"
        aria-labelledby={`palette-tab-${tab}`}
        className="flex items-center gap-0.5 px-2.5 py-1.5 overflow-x-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {types.map(t => {
          const { icon: Icon, label } = WIDGET_META[t];
          return (
            <button
              key={t}
              onClick={() => onAdd(t)}
              disabled={disabled}
              title={`Add ${label}`}
              className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-ctrl px-2 py-1 min-w-[52px] text-muted hover:text-accent hover:bg-accent-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Icon size={15} />
              <span className="whitespace-nowrap" style={{ fontSize: 10, fontWeight: 550 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
