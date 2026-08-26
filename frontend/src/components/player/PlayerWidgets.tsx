// ─── Flow-mode widget renderer for the remodeled player (spec §4.2 / §5) ─────
// Renders every widget type on the dark player surface with ≥56px touch
// targets. Legacy widgets keep their v1 semantics exactly (same formData
// values, same interactions); v2 widgets (variable-display, table-lookup,
// scan-input, photo-capture) are new. kit-checklist is rendered by the parent
// (it owns kit state) via `renderKit`.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle, ScanLine, Camera, Search } from 'lucide-react';
import type { Widget, Step, TableField } from '../../types';
import { interpolate } from '../../engine';
import { api } from '../../api/client';
import { WidgetView, ShapeSVG, buttonAppearance, buttonVariantStyle, ImgSafe } from '../app/WidgetView';
import PhotoSheet from './PhotoSheet';
import { formatDur, instructionInk, legacyKey, playerTextColor } from './runtime';

/** Authors pick text colors against the builder's LIGHT canvas; the player's
 *  flow surface is DARK. Near-black desaturated inks (default #374151 /
 *  #16233d navys and grays) become unreadable there, so they are remapped to
 *  the player ink token. Saturated colors (reds, brand hues) pass through —
 *  those are deliberate choices. */
export function flowInkColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const m = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const saturationSpread = Math.max(r, g, b) - Math.min(r, g, b);
  return luminance < 0.35 && saturationSpread < 60 ? fallback : color;
}

export interface PlayerWidgetProps {
  widget: Widget;
  step: Step;
  value: unknown;
  /** Standing-validation message for this widget (red outline + text). */
  invalidMessage?: string;
  variables: Record<string, string | number | boolean>;
  appInfo: Record<string, string | number>;
  preview: boolean;
  onChange: (widget: Widget, value: unknown) => void;
  onButtonPress: (widget: Widget) => void;
  onTimerDone: (widget: Widget) => void;
  onTimerTick: (widgetId: string, elapsedSeconds: number) => void;
  onScanCode: (widget: Widget, code: string) => void;
  onRequestCameraScan: (widget: Widget) => void;
  /** Parent-rendered kit checklist (owns kit state). */
  renderKit: (widget: Widget) => ReactNode;
  /**
   * Non-interactive rendering for the builder canvas: pixel-identical output,
   * but nothing starts running on its own (no auto-starting timer). Nothing
   * grabs focus in either mode: the keyboard waits for a tap, everywhere,
   * by the owner's explicit rule. Absent / false is the operator-facing behavior,
   * unchanged in every respect — a real run never sets this.
   */
  readOnly?: boolean;
}

// ─── table-lookup ────────────────────────────────────────────────────────────

interface TableInfo { fields: TableField[]; }
interface TableRecordRow { id: string; data: Record<string, unknown>; }

function TableLookup({ widget, variables }: { widget: Widget; variables: Record<string, string | number | boolean> }) {
  const { tableId, lookupFieldId, matchVariable, displayFieldIds } = widget.config;
  const [table, setTable] = useState<TableInfo | null>(null);
  const [records, setRecords] = useState<TableRecordRow[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;
    Promise.all([api.getTable(tableId), api.getRecords(tableId)])
      .then(([t, recs]) => {
        if (cancelled) return;
        setTable({ fields: Array.isArray(t?.fields) ? t.fields : [] });
        setRecords(Array.isArray(recs) ? recs : []);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [tableId]);

  const matchValue = matchVariable ? variables[matchVariable] : undefined;
  const match = lookupFieldId !== undefined && matchValue !== undefined && matchValue !== ''
    ? records.find(r => String(r.data?.[lookupFieldId] ?? '') === String(matchValue))
    : undefined;

  const shown = (displayFieldIds && displayFieldIds.length > 0
    ? (table?.fields ?? []).filter(f => displayFieldIds.includes(f.id))
    : table?.fields ?? []);

  return (
    <div className="p-card p-4">
      <div className="flex items-center gap-2 mb-2" style={{ fontSize: 13, fontWeight: 650, color: 'var(--p-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        <Search size={13} /> {widget.label || 'Lookup'}
      </div>
      {error ? (
        <div style={{ fontSize: 14, color: 'var(--p-muted)' }}>Lookup unavailable</div>
      ) : !match ? (
        <div style={{ fontSize: 14, color: 'var(--p-muted)' }}>
          {matchValue ? 'No match found' : 'Waiting for a value…'}
        </div>
      ) : (
        <div className="space-y-1.5">
          {shown.map(f => (
            <div key={f.id} className="flex justify-between gap-3" style={{ fontSize: 15 }}>
              <span style={{ color: 'var(--p-muted)' }}>{f.name}</span>
              <span style={{ color: 'var(--p-ink)', fontWeight: 550 }} className="text-right">
                {String(match.data?.[f.id] ?? '—')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── scan-input ──────────────────────────────────────────────────────────────

function ScanInput({ widget, value, invalid, readOnly, onScanCode, onRequestCameraScan }: {
  widget: Widget;
  value: unknown;
  invalid: boolean;
  /** Builder canvas: render the field but never steal the page's focus. */
  readOnly: boolean;
  onScanCode: (widget: Widget, code: string) => void;
  onRequestCameraScan: (widget: Widget) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const code = draft.trim();
    if (!code) return;
    setDraft('');
    onScanCode(widget, code);
  };

  return (
    <div>
      {widget.label && (
        <label className="p-label">
          {widget.label}
          {widget.config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}
        </label>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine size={18} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--p-accent)' }} />
          <input
            ref={inputRef}
            className={`p-input p-mono ${invalid ? 'p-input-invalid' : ''}`}
            style={{ paddingLeft: 44 }}
            placeholder={widget.config.placeholder || 'Scan or type a code…'}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            onBlur={() => { if (draft.trim()) commit(); }}
          />
        </div>
        <button
          className="p-btn p-btn-ghost flex-shrink-0"
          style={{ minWidth: 64 }}
          onClick={() => onRequestCameraScan(widget)}
          aria-label="Open camera scanner"
        >
          <Camera size={20} />
        </button>
      </div>
      {typeof value === 'string' && value !== '' && (
        <div className="flex items-center gap-1.5 mt-2" style={{ fontSize: 14, color: 'var(--p-good)' }}>
          <CheckCircle size={14} /> <span className="p-mono">{value}</span>
        </div>
      )}
    </div>
  );
}

// ─── Timer (upgraded: fires timer_done, reports elapsed) ─────────────────────

function TimerWidget({ widget, readOnly, onTimerDone, onTimerTick }: {
  widget: Widget;
  /** Builder canvas: show the timer at its full duration, never counting down. */
  readOnly: boolean;
  onTimerDone: (widget: Widget) => void;
  onTimerTick: (widgetId: string, elapsedSeconds: number) => void;
}) {
  const duration = widget.config.duration || 60;
  const [running, setRunning] = useState(!readOnly && !!widget.config.autoStart);
  const [left, setLeft] = useState(duration);
  const doneFired = useRef(false);

  useEffect(() => {
    if (readOnly || !running || left <= 0) return;
    const iv = setInterval(() => {
      setLeft(t => {
        const next = t - 1;
        onTimerTick(widget.id, duration - Math.max(0, next));
        if (next <= 0) {
          setRunning(false);
          if (!doneFired.current) {
            doneFired.current = true;
            // Defer trigger dispatch out of the state updater
            setTimeout(() => onTimerDone(widget), 0);
          }
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, readOnly]);

  const pct = (left / duration) * 100;
  return (
    <div className="p-card p-6 text-center">
      {widget.label && <div style={{ fontSize: 14, fontWeight: 550, color: 'var(--p-muted)', marginBottom: 10 }}>{widget.label}</div>}
      <div className="tnum p-mono" style={{ fontSize: 48, fontWeight: 750, color: 'var(--p-ink)', marginBottom: 14 }}>{formatDur(left)}</div>
      <div className="rounded-full overflow-hidden mb-4" style={{ height: 8, background: 'var(--p-surface-2)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: left < 30 ? 'var(--p-bad)' : 'var(--p-accent)' }} />
      </div>
      <div className="flex gap-2 justify-center">
        <button
          className="p-btn"
          style={{ minHeight: 48, background: running ? 'var(--p-warn)' : 'var(--p-accent)', color: running ? '#3a2703' : 'var(--p-on-accent)', fontSize: 15 }}
          onClick={() => setRunning(r => !r)}
        >
          {running ? 'Pause' : left === 0 ? 'Done' : 'Start'}
        </button>
        <button
          className="p-btn p-btn-ghost"
          style={{ minHeight: 48, fontSize: 15 }}
          onClick={() => { setLeft(duration); setRunning(false); doneFired.current = false; onTimerTick(widget.id, 0); }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ─── Counter (fixed: value persists across remounts via formData) ────────────

function CounterWidget({ widget, value, onChange }: {
  widget: Widget; value: unknown; onChange: (widget: Widget, v: unknown) => void;
}) {
  const min = widget.config.min ?? 0;
  const max = widget.config.max ?? 9999;
  const step = widget.config.step ?? 1;
  const current = typeof value === 'number' ? value : (widget.config.initialValue ?? 0);

  const bump = (delta: number) => {
    const next = Math.min(max, Math.max(min, current + delta * step));
    onChange(widget, next);
  };

  return (
    <div className="p-card p-5">
      {widget.label && <div style={{ fontSize: 14, fontWeight: 550, color: 'var(--p-muted)', marginBottom: 14 }}>{widget.label}</div>}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={() => bump(-1)} disabled={current <= min} aria-label="Decrease"
          className="p-btn p-btn-ghost" style={{ width: 64, height: 64, fontSize: 28, fontWeight: 750 }}
        >−</button>
        <div className="text-center">
          <div className="tnum p-mono" style={{ fontSize: 48, fontWeight: 750, color: 'var(--p-ink)' }}>{current}</div>
          <div className="tnum" style={{ fontSize: 12, color: 'var(--p-muted)', marginTop: 2 }}>{min} — {max}</div>
        </div>
        <button
          onClick={() => bump(1)} disabled={current >= max} aria-label="Increase"
          className="p-btn" style={{ width: 64, height: 64, fontSize: 28, fontWeight: 750, background: 'var(--p-accent)', color: 'var(--p-on-accent)' }}
        >+</button>
      </div>
    </div>
  );
}

// ─── Main dispatcher ─────────────────────────────────────────────────────────

export default function PlayerWidget(props: PlayerWidgetProps) {
  const {
    value, invalidMessage, variables, appInfo, preview, readOnly = false,
    onChange, onButtonPress, onTimerDone, onTimerTick, onScanCode, onRequestCameraScan, renderKit,
  } = props;
  // The builder writes `label` on the widget itself, but apps authored by hand
  // (the seeded QC app was one) put it inside config — and then every input on
  // the screen rendered as a bare unlabeled box. Accept both spellings here,
  // once, so no widget can reach the operator nameless.
  const widget = !props.widget.label && props.widget.config?.label
    ? { ...props.widget, label: props.widget.config.label as string }
    : props.widget;
  const { config } = widget;
  const invalid = invalidMessage !== undefined;

  const withError = (node: ReactNode) => (
    <div>
      {node}
      {invalidMessage && <div className="p-field-error">{invalidMessage}</div>}
    </div>
  );

  switch (widget.type) {
    case 'text':
      // Contrast guard: text configured with a dark ink (authored on the light
      // builder canvas) has no background of its own here, so it falls back to
      // the player ink instead of vanishing on the dark shell.
      return (
        <p style={{
          fontSize: config.fontSize || 18,
          fontWeight: config.fontWeight === 'bold' ? 700 : config.fontWeight === 'semibold' ? 600 : 400,
          fontStyle: config.fontStyle || 'normal',
          textAlign: config.textAlign || 'left',
          color: playerTextColor(config.color),
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}>
          {interpolate(config.text || '', variables, appInfo)}
        </p>
      );

    case 'instruction': {
      // Luminance check: a light configured background (white card, builder's
      // default #eff6ff wash…) gets dark ink; dark backgrounds keep light ink.
      const bg = config.backgroundColor || '#1e3a5f';
      return (
        <div className="rounded-xl p-5" style={{ backgroundColor: bg, border: '1px solid var(--p-border)' }}>
          <div style={{ fontSize: 18, lineHeight: 1.55, color: instructionInk(bg), whiteSpace: 'pre-wrap' }}>
            {interpolate(config.content || config.text || '', variables, appInfo)}
          </div>
        </div>
      );
    }

    case 'separator':
      return <div style={{ borderTop: '1px solid var(--p-grid)', margin: '8px 0' }} />;

    case 'image':
      return config.imageUrl
        ? (
          <ImgSafe
            src={config.imageUrl}
            alt={config.imageAlt || ''}
            className="w-full rounded-xl max-h-72 object-contain p-2"
            style={{ background: 'var(--p-surface-1)', minHeight: 96 }}
          />
        )
        : <div className="w-full h-32 rounded-xl flex items-center justify-center" style={{ background: 'var(--p-surface-1)', border: '1px dashed var(--p-border)', color: 'var(--p-muted)', fontSize: 14 }}>Image placeholder</div>;

    case 'video':
    case 'model-viewer':
      return (
        // Black rounded stage behind the embed so the area reads as a video
        // frame even before the third-party player paints.
        <div className="rounded-xl overflow-hidden bg-black" style={{ height: widget.type === 'video' ? 320 : 380 }}>
          <WidgetView widget={widget} />
        </div>
      );

    case 'text-input':
      return withError(
        <div>
          {widget.label && (
            <label className="p-label">{widget.label}{config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}</label>
          )}
          <input
            type="text"
            className={`p-input ${invalid ? 'p-input-invalid' : ''}`}
            placeholder={config.placeholder}
            value={typeof value === 'string' ? value : value !== undefined && value !== null ? String(value) : ''}
            onChange={e => onChange(widget, e.target.value)}
          />
        </div>
      );

    case 'number-input': {
      const decimals = config.decimals;
      const stepAttr = config.step ?? (decimals !== undefined && decimals > 0 ? Math.pow(10, -decimals) : undefined);
      // Whole-number fields get the digits-only phone keypad; anything that can
      // take a fraction keeps the decimal-point layout.
      const wantsInteger = decimals === 0 || (decimals === undefined && config.step !== undefined && Number.isInteger(config.step));
      return withError(
        <div>
          {widget.label && (
            <label className="p-label">{widget.label}{config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}</label>
          )}
          <input
            type="number"
            inputMode={wantsInteger ? 'numeric' : 'decimal'}
            className={`p-input tnum ${invalid ? 'p-input-invalid' : ''}`}
            placeholder={config.placeholder}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={e => onChange(widget, e.target.value)}
            min={config.min} max={config.max} step={stepAttr}
          />
        </div>
      );
    }

    case 'select-input':
      return withError(
        <div>
          {widget.label && (
            <label className="p-label">{widget.label}{config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}</label>
          )}
          <div className="flex flex-wrap gap-2">
            {(config.options || []).map(opt => {
              const selected = value === opt;
              return (
                <button
                  key={opt}
                  onClick={() => onChange(widget, opt)}
                  className="rounded-xl transition-all"
                  style={{
                    minHeight: 56, padding: '0 20px', fontSize: 16, fontWeight: 550,
                    background: selected ? 'var(--p-accent)' : 'var(--p-surface-1)',
                    color: selected ? 'var(--p-on-accent)' : 'var(--p-ink-2)',
                    border: `2px solid ${selected ? 'var(--p-accent)' : invalid ? 'var(--p-bad)' : 'var(--p-baseline)'}`,
                  }}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );

    case 'checkbox':
      return withError(
        <button
          onClick={() => onChange(widget, value !== true)}
          className="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-colors"
          style={{
            minHeight: 64,
            background: 'var(--p-surface-1)',
            border: `1px solid ${invalid ? 'var(--p-bad)' : 'var(--p-border)'}`,
          }}
        >
          <span
            className="flex items-center justify-center rounded-lg flex-shrink-0 transition-colors"
            style={{
              width: 28, height: 28,
              background: value === true ? 'var(--p-accent)' : 'transparent',
              border: `2px solid ${value === true ? 'var(--p-accent)' : 'var(--p-baseline)'}`,
            }}
          >
            {value === true && <CheckCircle size={16} style={{ color: 'var(--p-on-accent)' }} />}
          </span>
          <span style={{ fontSize: 17, fontWeight: 550, color: 'var(--p-ink)' }}>
            {widget.label}{config.required && <span style={{ color: 'var(--p-bad)' }} className="ml-1">*</span>}
          </span>
        </button>
      );

    case 'timer':
      return <TimerWidget widget={widget} readOnly={readOnly} onTimerDone={onTimerDone} onTimerTick={onTimerTick} />;

    case 'counter':
      return <CounterWidget widget={widget} value={value} onChange={onChange} />;

    case 'pass-fail':
      return withError(
        <div className="p-card p-5">
          {widget.label && <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--p-ink)', marginBottom: 14 }}>{widget.label}</div>}
          <div className="flex gap-3">
            <button
              onClick={() => onChange(widget, 'Pass')}
              className="flex-1 rounded-xl transition-all"
              style={{
                minHeight: 72, fontSize: 19, fontWeight: 750,
                background: value === 'Pass' ? 'var(--p-good)' : 'var(--p-surface-2)',
                color: value === 'Pass' ? '#052e13' : 'var(--p-muted)',
                border: `2px solid ${value === 'Pass' ? 'var(--p-good)' : 'var(--p-baseline)'}`,
              }}
            >✓ Pass</button>
            <button
              onClick={() => onChange(widget, 'Fail')}
              className="flex-1 rounded-xl transition-all"
              style={{
                minHeight: 72, fontSize: 19, fontWeight: 750,
                background: value === 'Fail' ? 'var(--p-bad-strong)' : 'var(--p-surface-2)',
                color: value === 'Fail' ? '#fff' : 'var(--p-muted)',
                border: `2px solid ${value === 'Fail' ? 'var(--p-bad-strong)' : 'var(--p-baseline)'}`,
              }}
            >✗ Fail</button>
          </div>
        </div>
      );

    case 'signature':
      return withError(
        <div className="p-card p-4">
          {widget.label && <div style={{ fontSize: 16, fontWeight: 650, color: 'var(--p-ink)', marginBottom: 10 }}>{widget.label}</div>}
          {typeof value === 'string' && value ? (
            <div className="text-center py-3">
              <div style={{ fontFamily: 'cursive', fontSize: 26, fontStyle: 'italic', color: 'var(--p-good)' }}>{value}</div>
              <button onClick={() => onChange(widget, '')} style={{ fontSize: 12, color: 'var(--p-muted)' }} className="mt-1 hover:underline">Clear</button>
            </div>
          ) : (
            <input
              className="p-input text-center"
              style={{ fontFamily: 'cursive', fontStyle: 'italic' }}
              placeholder="Type your signature…"
              onBlur={e => { if (e.target.value) onChange(widget, e.target.value); }}
            />
          )}
        </div>
      );

    case 'button': {
      const ap = buttonAppearance(config);
      // Touch target never drops below 44px, regardless of configured size.
      const minHeight = Math.max(44, { sm: 48, md: 60, lg: 72, xl: 84 }[ap.size]);
      const fontSize = { sm: 15, md: 18, lg: 21, xl: 24 }[ap.size];
      const fullWidth = config.fullWidth !== false; // absent = full width (v1 behavior)
      const ButtonIcon = ap.icon;
      return (
        <button
          onClick={() => onButtonPress(widget)}
          className={`${fullWidth ? 'flex w-full' : 'inline-flex'} items-center justify-center gap-2 transition-all active:scale-[0.99]`}
          style={{
            minHeight, fontSize, fontWeight: 650,
            borderRadius: ap.radius,
            padding: '0 24px',
            ...buttonVariantStyle(ap.variant, config.buttonColor || '#60a5fa'),
          }}
        >
          {ButtonIcon && <ButtonIcon size={Math.round(fontSize * 1.15)} className="flex-shrink-0" />}
          {config.buttonText || 'Next'}
        </button>
      );
    }

    case 'shape': {
      // Canvas decoration — pure SVG, no capture, no events. Flow mode gives
      // it a sensible fixed height (canvas mode sizes it via the layout box).
      const kind = config.shapeKind ?? 'rect';
      return (
        <div aria-hidden="true" style={{ height: kind === 'line' || kind === 'arrow' ? 32 : 140, opacity: config.opacity ?? 1 }}>
          <ShapeSVG config={config} />
        </div>
      );
    }

    // ── v2 widgets ─────────────────────────────────────────────────────────

    case 'variable-display': {
      const name = config.variableRef || '';
      const raw = name ? (variables[name] ?? appInfo[name]) : undefined;
      const display = raw === undefined || raw === null || raw === '' ? '—' : String(raw);
      if (config.displayFormat === 'stat') {
        return (
          <div className="p-well px-4 py-3 inline-block" style={{ minWidth: 160 }}>
            <div style={{ fontSize: 11.5, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)' }}>
              {widget.label || name || 'Value'}
            </div>
            <div className="tnum" style={{ fontSize: 30, fontWeight: 750, color: flowInkColor(config.color, 'var(--p-ink)') }}>{display}</div>
          </div>
        );
      }
      return (
        <p style={{ fontSize: config.fontSize || 18, color: flowInkColor(config.color, 'var(--p-ink)') }}>
          {widget.label ? `${widget.label}: ` : ''}<span style={{ fontWeight: 650 }}>{display}</span>
        </p>
      );
    }

    case 'table-lookup':
      return <TableLookup widget={widget} variables={variables} />;

    case 'kit-checklist':
      return <>{renderKit(widget)}</>;

    case 'scan-input':
      return withError(
        <ScanInput
          widget={widget}
          value={value}
          invalid={invalid}
          readOnly={readOnly}
          onScanCode={onScanCode}
          onRequestCameraScan={onRequestCameraScan}
        />
      );

    case 'photo-capture':
      return withError(
        <PhotoSheet
          widget={widget}
          value={typeof value === 'string' ? value : undefined}
          onChange={v => onChange(widget, v)}
          preview={preview}
          invalid={invalid}
        />
      );

    default:
      return null;
  }
}

export { legacyKey };
