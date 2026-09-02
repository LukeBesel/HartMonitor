// ─── Builder stage — the operator player's own renderer, made editable ───────
// What the author sees on the canvas IS what the player draws: the same
// PlayerWidget dispatcher, on the same dark [data-player] ground, with the same
// column width, typography and spacing as PlayerShell's step region. Editing
// affordances (click-to-select, drag grip, delete) are drawn on overlay layers
// around each real widget, never in place of it — and pointer/keyboard input is
// swallowed so typing in a preview field can't fight the builder.
//
// There is deliberately no second widget renderer here. Two renderers drift,
// and that drift is exactly what made preview a surprise.

import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { App, KitLine, Step, Widget } from '../../types';
import PlayerWidget from '../player/PlayerWidgets';
import KitPanel from '../player/KitPanel';
import { formatDur, stepShowsKit, stepTaktSeconds } from '../player/runtime';
import { WIDGET_META } from './WidgetPalette';
// The player's token set and .p-* component classes. AppPlayer imports the same
// file; the builder needs it because the stage renders the player's widgets and
// scopes [data-player] around them. Every rule inside is scoped to that
// attribute or a .p-*/.tnum class, so nothing here reaches the builder chrome.
import '../../player.css';

/** Variable values the canvas renders with. Seeded exactly the way AppPlayer
 *  seeds a fresh run (declared defaults only — a variable with no default stays
 *  unset), so an interpolated string or a variable-display reads on the canvas
 *  the way it reads on step entry. */
export function previewVariables(app: App): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const v of app.variables ?? []) {
    if (v.defaultValue !== undefined) out[v.name] = v.defaultValue;
  }
  return out;
}

/** The run-context facts the player interpolates into text. On the canvas there
 *  is no run, so these carry the same values a run started without a work order
 *  would carry — the author sees the honest fallback, not invented data. */
export const PREVIEW_APP_INFO: Record<string, string | number> = {
  operator: 'Operator',
  work_order_number: '',
  part_number: '',
  quantity: 0,
  quantity_completed: 0,
  product_type: '',
  station: '',
  elapsed_seconds: 0,
  step_elapsed_seconds: 0,
};

/** Representative kit lines so a kit-checklist widget shows the real checklist
 *  chrome at authoring time. Real lines come from the work order at run time. */
function sampleKitLines(stepId: string): KitLine[] {
  const base = {
    kit_id: 'preview', bom_line_id: null, picked_by: '', picked_at: null,
    verified_by: '', verified_at: null, short_reason: '', notes: '',
    scan_code: '', reference: '', step_id: stepId, unit: 'ea',
  };
  return [
    { ...base, id: 'k1', item_id: 'i1', item_name: 'Base bracket', sku: 'SKU-1001', qty_required: 1, qty_picked: 1, status: 'verified', sort_order: 0 },
    { ...base, id: 'k2', item_id: 'i2', item_name: 'M6 bolt', sku: 'SKU-1002', qty_required: 4, qty_picked: 4, status: 'picked', sort_order: 1 },
    { ...base, id: 'k3', item_id: 'i3', item_name: 'Control board', sku: 'SKU-1003', qty_required: 1, qty_picked: 0, status: 'pending', sort_order: 2 },
  ];
}

const noop = () => {};

// ─── One editable widget: the real player widget under builder chrome ────────

function StageWidget({ widget, step, variables, selected, canEdit, onSelect, onRemove }: {
  widget: Widget;
  step: Step;
  variables: Record<string, string | number | boolean>;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id, disabled: !canEdit });

  // `inert` takes the whole widget subtree out of the tab order and out of hit
  // testing, so a preview text field can never swallow the author's keystrokes.
  const inertRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inertRef.current?.setAttribute('inert', ''); }, []);

  const meta = WIDGET_META[widget.type];
  const authored = (widget.triggers ?? []).filter(t => !t.id.startsWith('legacy_')).length;

  const renderKit = (w: Widget): ReactNode => (
    <KitPanel
      lines={sampleKitLines(step.id)}
      kitStatus="picking"
      bomLines={null}
      partsList={step.parts_list ?? null}
      scope={w.config.kitScope ?? 'all'}
      currentStepId={step.id}
      allowShort={w.config.allowShort ?? true}
      requireScan={w.config.requireScan ?? false}
      poppedLineId={null}
      onRequestScan={noop}
      onVerify={noop}
      onMarkShort={noop}
      onUndoShort={noop}
    />
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.45 : 1,
      }}
      className={`wb-stage-item relative ${selected ? 'is-selected' : ''} ${canEdit ? 'cursor-pointer' : ''}`}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      data-widget-type={widget.type}
    >
      {/* The product itself — the player's renderer, drawing the player's pixels. */}
      <div ref={inertRef} style={{ pointerEvents: 'none' }}>
        <PlayerWidget
          widget={widget}
          step={step}
          value={undefined}
          variables={variables}
          appInfo={PREVIEW_APP_INFO}
          preview
          readOnly
          onChange={noop}
          onButtonPress={noop}
          onTimerDone={noop}
          onTimerTick={noop}
          onScanCode={noop}
          onRequestCameraScan={noop}
          renderKit={renderKit}
        />
      </div>

      {/* Selection / hover ring — an overlay around the widget, never over it. */}
      <span className="wb-stage-ring" aria-hidden="true" />

      {canEdit && (
        <div className="wb-stage-tools">
          <button
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            className="wb-stage-tool cursor-grab active:cursor-grabbing"
            aria-label={`Drag to reorder ${meta?.label ?? widget.type}`}
          >
            <GripVertical size={12} />
          </button>
          <span
            className="whitespace-nowrap select-none"
            style={{ fontSize: 10, fontWeight: 650, letterSpacing: '0.3px', color: 'var(--p-muted)' }}
          >
            {meta?.label ?? widget.type}
          </span>
          {authored > 0 && (
            <span
              className="tnum whitespace-nowrap rounded-full px-1.5"
              style={{ fontSize: 9.5, fontWeight: 650, background: 'var(--p-gold-wash)', color: 'var(--p-warn-ink)' }}
            >
              ⚡ {authored}
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            className="wb-stage-tool wb-stage-tool-danger"
            aria-label={`Delete ${meta?.label ?? widget.type}`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── The stacked-flow stage ──────────────────────────────────────────────────

export default function BuilderStage({
  app, step, selectedWidgetId, canEdit, onSelectWidget, onRemoveWidget, onReorder,
}: {
  app: App;
  step: Step;
  selectedWidgetId: string | null;
  canEdit: boolean;
  onSelectWidget: (id: string | null) => void;
  onRemoveWidget: (id: string) => void;
  onReorder: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const variables = useMemo(() => previewVariables(app), [app]);

  // Mirrors AppPlayer: an implicit kit panel on a kit step with no kit widget.
  const showImplicitKit = step.step_type === 'kit'
    && !step.widgets.some(w => w.type === 'kit-checklist');

  return (
    // `space-y-4` and the widget order are PlayerShell's, verbatim.
    <div className="w-full space-y-4" onClick={() => onSelectWidget(null)}>
      {step.widgets.length === 0 && (
        <div
          className="flex flex-col items-center justify-center rounded-xl py-14 text-center"
          style={{ border: '1px dashed var(--p-baseline)', color: 'var(--p-muted)' }}
        >
          <Plus size={30} className="mb-2" />
          <p style={{ fontSize: 15, fontWeight: 550, color: 'var(--p-ink-2)' }}>
            This step is empty
          </p>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            Add fields from the toolbar above — they appear here exactly as an operator will see them.
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
        <SortableContext items={step.widgets.map(w => w.id)} strategy={verticalListSortingStrategy}>
          {step.widgets.map(widget => (
            <StageWidget
              key={widget.id}
              widget={widget}
              step={step}
              variables={variables}
              selected={selectedWidgetId === widget.id}
              canEdit={canEdit}
              onSelect={() => onSelectWidget(widget.id)}
              onRemove={() => onRemoveWidget(widget.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {showImplicitKit && (
        <div style={{ pointerEvents: 'none' }}>
          <KitPanel
            lines={sampleKitLines(step.id)}
            kitStatus="picking"
            bomLines={null}
            partsList={step.parts_list ?? null}
            scope="all"
            currentStepId={step.id}
            allowShort
            requireScan={false}
            poppedLineId={null}
            onRequestScan={noop}
            onVerify={noop}
            onMarkShort={noop}
            onUndoShort={noop}
          />
        </div>
      )}
    </div>
  );
}

// ─── Step heading, rendered as the player renders it (but editable) ──────────

export function StageStepHeading({ step, name, canEdit, onRename, onFocus, trailing }: {
  step: Step;
  name: string;
  canEdit: boolean;
  onRename: (name: string) => void;
  onFocus: () => void;
  /** Builder-only chrome (step counter, zoom) pinned beside the title. */
  trailing?: ReactNode;
}) {
  const takt = stepTaktSeconds(step);
  return (
    <>
      {/* The takt chip and the builder's counter drop below the name on a phone,
          the same way the player's do — abreast they left the step name about a
          hundred pixels and "Safety Check" rendered as "Safety". */}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {/* Same type ramp, weight and ink as PlayerShell's <h2>, typed in place. */}
        <input
          className="flex-1 min-w-0 bg-transparent border-none outline-none rounded-lg px-1 -mx-1"
          style={{
            fontSize: 'clamp(26px, 3vw, 34px)',
            fontWeight: 800,
            color: 'var(--p-ink)',
            lineHeight: 1.15,
          }}
          value={name}
          readOnly={!canEdit}
          onChange={e => onRename(e.target.value)}
          onFocus={onFocus}
          onClick={e => e.stopPropagation()}
          aria-label="Step name"
        />
        <div className="flex items-center gap-2 sm:gap-3">
          {takt > 0 && (
            <div className="p-chip flex-shrink-0 tnum" style={{ minHeight: 40, fontSize: 14 }}>
              Takt {formatDur(takt)}
            </div>
          )}
          {trailing}
        </div>
      </div>
      {step.description && (
        <p style={{ fontSize: 16, color: 'var(--p-ink-2)' }}>{step.description}</p>
      )}
      {stepShowsKit(step) && (
        <p style={{ fontSize: 12.5, color: 'var(--p-muted)' }}>
          Kit lines shown are placeholders — the real ones come from the work order at run time.
        </p>
      )}
    </>
  );
}
