import { useEffect, useId, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCircle, CheckCircle2,
  Flag, Image as ImageIcon, PackageCheck, Pause, PenTool, Play, Printer, RotateCcw,
  Save, ScanLine, Table2, Variable, Wrench, X,
} from 'lucide-react';
import type { Widget, WidgetConfig, WidgetType, WidgetLayout } from '../../types';

// Fixed logical canvas width. Both the builder and player render the canvas at
// this width, then scale uniformly to fit their container — so what you build is
// exactly what plays. Height is per-step (step.canvasHeight).
export const CANVAS_W = 720;
export const DEFAULT_CANVAS_H = 560;
export const MIN_W = 32;
export const MIN_H = 24;

// Sensible starting size/position for a freshly dropped widget. New widgets are
// staggered so they don't stack exactly on top of each other.
export function defaultLayout(type: WidgetType, index = 0): WidgetLayout {
  const off = (index % 8) * 18;
  const at = (width: number, height: number): WidgetLayout => ({
    x: 40 + off, y: 40 + off, width, height, rotation: 0, z: index + 1,
  });
  switch (type) {
    case 'text':         return at(420, 56);
    case 'instruction':  return at(640, 150);
    case 'image':        return at(340, 240);
    case 'button':       return at(220, 56);
    case 'text-input':   return at(380, 84);
    case 'number-input': return at(300, 84);
    case 'select-input': return at(440, 110);
    case 'checkbox':     return at(380, 56);
    case 'timer':        return at(320, 210);
    case 'counter':      return at(340, 170);
    case 'pass-fail':     return at(440, 150);
    case 'signature':     return at(440, 150);
    case 'separator':     return at(640, 24);
    case 'video':         return at(560, 320);
    case 'model-viewer':  return at(520, 380);
    // v2 widgets (app-platform remodel §4.2)
    case 'variable-display': return at(280, 96);
    case 'table-lookup':     return at(440, 200);
    case 'kit-checklist':    return at(640, 320);
    case 'scan-input':       return at(440, 96);
    case 'photo-capture':    return at(380, 200);
    case 'shape':            return at(260, 160);
    default:              return at(360, 80);
  }
}

// ─── Button appearance (professional button upgrades) ─────────────────────────

/** Curated icon set for buttons — a safe static lookup map keyed by lucide
 *  name. NEVER extend this with dynamic imports; add entries explicitly. */
export const BUTTON_ICONS: Record<string, LucideIcon> = {
  'arrow-right':    ArrowRight,
  'arrow-left':     ArrowLeft,
  'check':          Check,
  'check-circle':   CheckCircle2,
  'x':              X,
  'play':           Play,
  'pause':          Pause,
  'flag':           Flag,
  'camera':         Camera,
  'scan-line':      ScanLine,
  'printer':        Printer,
  'save':           Save,
  'rotate-ccw':     RotateCcw,
  'wrench':         Wrench,
  'alert-triangle': AlertTriangle,
};

export interface ButtonAppearance {
  variant: 'solid' | 'outline' | 'ghost';
  size: 'sm' | 'md' | 'lg' | 'xl';
  shape: 'rounded' | 'pill' | 'square';
  /** Effective border radius in px (legacy config.borderRadius still wins). */
  radius: number;
  /** Resolved icon component, or undefined when unset/unknown. */
  icon?: LucideIcon;
}

/** Resolve a button's appearance with v1 back-compat defaults: a config with
 *  no variant/size/shape renders exactly as before — solid / md / rounded. */
export function buttonAppearance(config: WidgetConfig): ButtonAppearance {
  const shape = config.buttonShape ?? 'rounded';
  return {
    variant: config.buttonVariant ?? 'solid',
    size: config.buttonSize ?? 'md',
    shape,
    radius: config.borderRadius ?? (shape === 'pill' ? 999 : shape === 'square' ? 2 : 12),
    icon: config.buttonIcon ? BUTTON_ICONS[config.buttonIcon] : undefined,
  };
}

/** Variant → background/text/border styles for the configured accent color. */
export function buttonVariantStyle(variant: ButtonAppearance['variant'], color: string): React.CSSProperties {
  const tint = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}1f` : 'rgba(127, 127, 127, 0.12)';
  switch (variant) {
    case 'outline': return { background: 'transparent', color, border: `2px solid ${color}` };
    case 'ghost':   return { background: tint, color, border: '2px solid transparent' };
    default:        return { background: color, color: '#ffffff', border: '2px solid transparent' };
  }
}

// ─── Shape widget (canvas decoration — pure SVG) ──────────────────────────────

/** Pure-SVG shape filling its parent box. Percentage geometry scales with the
 *  widget's canvas layout box; rotation comes free from the canvas engine.
 *  Never captured — shapes have no value and fire no events. */
export function ShapeSVG({ config }: { config: WidgetConfig }) {
  const uid = useId();
  const kind = config.shapeKind ?? 'rect';
  const fill = config.fill ?? '#e0e7ff';
  const stroke = config.stroke ?? '#6366f1';
  const sw = config.strokeWidth ?? 1.5;
  const markerId = `shape-arrow-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      className="w-full h-full block"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
      data-shape-kind={kind}
    >
      {kind === 'rect' && (
        <rect
          x="0" y="0" width="100%" height="100%"
          rx={config.cornerRadius ?? 0}
          fill={fill}
          stroke={sw > 0 ? stroke : 'none'}
          strokeWidth={sw}
        />
      )}
      {kind === 'ellipse' && (
        <ellipse
          cx="50%" cy="50%" rx="50%" ry="50%"
          fill={fill}
          stroke={sw > 0 ? stroke : 'none'}
          strokeWidth={sw}
        />
      )}
      {kind === 'line' && (
        <line
          x1="0" y1="50%" x2="100%" y2="50%"
          stroke={stroke}
          strokeWidth={Math.max(sw, 1)}
          strokeLinecap="round"
        />
      )}
      {kind === 'arrow' && (
        <>
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8" refY="5"
              markerWidth="4" markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
            </marker>
          </defs>
          <line
            x1="0" y1="50%" x2="100%" y2="50%"
            stroke={stroke}
            strokeWidth={Math.max(sw, 1)}
            strokeLinecap="round"
            markerEnd={`url(#${markerId})`}
          />
        </>
      )}
    </svg>
  );
}

// Tracks the uniform scale needed to fit a CANVAS_W-wide stage into `ref`'s width.
export function useCanvasScale(ref: React.RefObject<HTMLElement>, logicalWidth = CANVAS_W) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / logicalWidth));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, logicalWidth]);
  return scale;
}

const vAlignToFlex: Record<string, string> = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

/** Loose shape for kit lines passed into the kit-checklist widget as `value`.
 *  Kept structural (not the Kit type) so the player can pass scoped subsets. */
interface KitLineLike {
  id?: string; item_name?: string; sku?: string;
  qty_required?: number; qty_picked?: number; unit?: string;
  status?: string; reference?: string;
}

const KIT_STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  pending:  { bg: '#eef1f6', color: '#636f7e', border: '#dfe4ec', label: 'Pending' },
  picked:   { bg: '#ebecfd', color: '#4338ca', border: 'rgba(79,70,229,0.25)', label: 'Picked' },
  verified: { bg: 'rgba(43,138,62,0.12)', color: '#2b8a3e', border: 'rgba(43,138,62,0.3)', label: 'Verified' },
  short:    { bg: 'rgba(217,119,6,0.12)', color: '#a16207', border: 'rgba(217,119,6,0.3)', label: 'Short' },
};

// Renders a single widget filling its parent box. Used identically by the
// builder (pointer-events disabled by the editor frame) and the player
// (interactive). Light theme so a white/colored canvas reads like a slide.
export function WidgetView({ widget, value, onChange, onNext, onPrev, onComplete, onDone, onScan, onPhotoRequest }: {
  widget: Widget;
  value?: any;
  onChange?: (v: any) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onComplete?: () => void;
  /** Timer reached 0 — the player uses this to fire `timer_done` triggers. */
  onDone?: () => void;
  /** scan-input received an Enter-terminated code (keyboard-wedge scanners). */
  onScan?: (code: string) => void;
  /** photo-capture wants the player to open its camera/file sheet. */
  onPhotoRequest?: () => void;
}) {
  const { config } = widget;
  const [timerRunning, setTimerRunning] = useState(!!config.autoStart);
  const [timerLeft, setTimerLeft] = useState(config.duration || 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [counterVal, setCounterVal] = useState<number>(config.initialValue ?? 0);
  const [scanDraft, setScanDraft] = useState('');
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (timerRunning && timerLeft > 0) {
      timerRef.current = setInterval(() => setTimerLeft(t => {
        if (t <= 1) {
          setTimerRunning(false);
          if (timerRef.current) clearInterval(timerRef.current);
          onDoneRef.current?.();
          return 0;
        }
        return t - 1;
      }), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const handleCounter = (delta: number) => {
    const min = config.min ?? 0, max = config.max ?? 9999, step = config.step ?? 1;
    const nv = Math.min(max, Math.max(min, counterVal + delta * step));
    setCounterVal(nv);
    onChange?.(nv);
  };

  const input = "w-full px-3 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base";

  switch (widget.type) {
    case 'text':
      return (
        <div className="w-full h-full overflow-hidden flex" style={{ alignItems: vAlignToFlex[config.verticalAlign || 'top'] }}>
          <div style={{
            width: '100%',
            textAlign: config.textAlign || 'left',
            fontSize: config.fontSize || 16,
            color: config.color || '#374151',
            fontWeight: config.fontWeight === 'bold' ? 700 : config.fontWeight === 'semibold' ? 600 : 400,
            fontStyle: config.fontStyle || 'normal',
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {config.text || ''}
          </div>
        </div>
      );

    case 'instruction':
      return (
        <div className="w-full h-full rounded-xl border border-blue-200 overflow-auto p-4" style={{ backgroundColor: config.backgroundColor || '#eff6ff' }}>
          <div className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">{config.content}</div>
        </div>
      );

    case 'separator':
      return <div className="w-full h-full flex items-center"><div className="w-full border-t-2" style={{ borderColor: config.color || '#e5e7eb' }} /></div>;

    case 'image':
      return config.imageUrl
        ? <img src={config.imageUrl} alt={config.imageAlt || ''} className="w-full h-full" style={{ objectFit: config.imageFit || 'contain', borderRadius: config.borderRadius ?? 8 }} />
        : <div className="w-full h-full bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-400 text-xs border border-dashed border-gray-300"><ImageIcon size={20} className="mb-1" />Image</div>;

    case 'text-input':
      return (
        <div className="w-full h-full flex flex-col justify-center">
          {widget.label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</label>}
          <input type="text" className={input} placeholder={config.placeholder} value={value || ''} onChange={e => onChange?.(e.target.value)} />
        </div>
      );

    case 'number-input': {
      // Activated blocking validation (spec §4.2): out-of-range = red outline
      // + message under the field. Navigation blocking is the player's job —
      // this renders the offense.
      const raw = value === undefined || value === null ? '' : String(value);
      const num = raw === '' ? null : Number(raw);
      let rangeError = '';
      if (config.enforceRange && num !== null && Number.isFinite(num)) {
        if (config.min !== undefined && num < config.min) rangeError = `Must be at least ${config.min}`;
        else if (config.max !== undefined && num > config.max) rangeError = `Must be at most ${config.max}`;
      }
      return (
        <div className="w-full h-full flex flex-col justify-center">
          {widget.label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</label>}
          <input
            type="number"
            className={`${input} tnum ${rangeError ? '!border-[#c92a2a] !ring-2 !ring-red-200' : ''}`}
            placeholder={config.placeholder}
            value={raw}
            onChange={e => onChange?.(e.target.value)}
            min={config.min} max={config.max}
            step={config.step ?? (config.decimals ? Math.pow(10, -config.decimals) : undefined)}
          />
          {rangeError && (
            <p className="mt-1" style={{ color: '#c92a2a', fontSize: 13.5, fontWeight: 550 }}>{rangeError}</p>
          )}
        </div>
      );
    }

    case 'select-input':
      return (
        <div className="w-full h-full flex flex-col justify-center overflow-auto">
          {widget.label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</label>}
          <div className="flex flex-wrap gap-2">
            {(config.options || []).map(opt => (
              <button key={opt} type="button" onClick={() => onChange?.(opt)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all border-2 ${value === opt ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );

    case 'checkbox':
      return (
        <label className="w-full h-full flex items-center gap-3 cursor-pointer px-3 bg-white rounded-lg border border-gray-300">
          <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${value ? 'bg-blue-600 border-blue-600' : 'border-gray-400'}`} onClick={() => onChange?.(!value)}>
            {value && <CheckCircle size={14} className="text-white" />}
          </span>
          <span className="text-gray-800 font-medium">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</span>
        </label>
      );

    case 'timer': {
      const pct = (timerLeft / (config.duration || 60)) * 100;
      return (
        <div className="w-full h-full bg-gray-50 rounded-xl p-4 flex flex-col items-center justify-center border border-gray-200">
          {widget.label && <div className="text-gray-500 text-xs mb-1.5 font-medium">{widget.label}</div>}
          <div className="text-4xl font-mono font-bold text-gray-900 mb-2">{fmt(timerLeft)}</div>
          <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden mb-3">
            <div className={`h-full rounded-full ${timerLeft < 30 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setTimerRunning(r => !r)} className={`px-3 py-1.5 rounded-lg text-sm font-medium text-white ${timerRunning ? 'bg-amber-500' : 'bg-blue-600'}`}>{timerRunning ? 'Pause' : 'Start'}</button>
            <button type="button" onClick={() => { setTimerLeft(config.duration || 60); setTimerRunning(false); }} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-200 text-gray-700">Reset</button>
          </div>
        </div>
      );
    }

    case 'counter':
      return (
        <div className="w-full h-full bg-gray-50 rounded-xl p-4 flex flex-col justify-center border border-gray-200">
          {widget.label && <div className="text-gray-500 text-xs font-medium mb-2 text-center">{widget.label}</div>}
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => handleCounter(-1)} className="w-11 h-11 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xl font-bold">−</button>
            <div className="text-3xl font-mono font-bold text-gray-900">{counterVal}</div>
            <button type="button" onClick={() => handleCounter(1)} className="w-11 h-11 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xl font-bold">+</button>
          </div>
        </div>
      );

    case 'pass-fail':
      return (
        <div className="w-full h-full bg-gray-50 rounded-xl p-3 flex flex-col justify-center border border-gray-200">
          {widget.label && <div className="text-gray-700 font-medium mb-2 text-sm">{widget.label}</div>}
          <div className="flex gap-2 flex-1">
            <button type="button" onClick={() => onChange?.('Pass')} className={`flex-1 rounded-lg text-base font-bold border-2 ${value === 'Pass' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:border-emerald-400'}`}>✓ Pass</button>
            <button type="button" onClick={() => onChange?.('Fail')} className={`flex-1 rounded-lg text-base font-bold border-2 ${value === 'Fail' ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:border-red-400'}`}>✗ Fail</button>
          </div>
        </div>
      );

    case 'signature':
      return (
        <div className="w-full h-full bg-gray-50 rounded-xl p-3 flex flex-col justify-center border border-gray-200">
          {widget.label && <div className="text-gray-700 font-medium mb-2 text-sm">{widget.label}</div>}
          {value ? (
            <div className="text-center">
              <div className="text-emerald-600 italic text-2xl" style={{ fontFamily: 'cursive' }}>{value}</div>
              <button type="button" onClick={() => onChange?.('')} className="text-xs text-gray-400 hover:text-red-500 mt-1">Clear</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-400 border border-dashed border-gray-300 rounded-lg px-3 py-2">
              <PenTool size={14} /><input className="flex-1 bg-transparent italic outline-none text-gray-700" style={{ fontFamily: 'cursive' }} placeholder="Type signature…" onBlur={e => e.target.value && onChange?.(e.target.value)} />
            </div>
          )}
        </div>
      );

    case 'button': {
      const click = () => {
        if (config.buttonType === 'prev') onPrev?.();
        else if (config.buttonType === 'complete') onComplete?.();
        else onNext?.();
      };
      const ap = buttonAppearance(config);
      const fontSize = { sm: 14, md: 16, lg: 20, xl: 24 }[ap.size];
      const ButtonIcon = ap.icon;
      return (
        <button type="button" onClick={click}
          className="w-full h-full font-semibold transition-all hover:opacity-90 active:scale-[0.99] inline-flex items-center justify-center gap-2"
          style={{ ...buttonVariantStyle(ap.variant, config.buttonColor || '#3b82f6'), fontSize, borderRadius: ap.radius }}>
          {ButtonIcon && <ButtonIcon size={Math.round(fontSize * 1.15)} className="flex-shrink-0" />}
          {config.buttonText || 'Next'}
        </button>
      );
    }

    case 'shape':
      return <ShapeSVG config={config} />;

    case 'video': {
      const isYoutube = config.videoType === 'youtube' || (config.videoUrl || '').includes('youtube') || (config.videoUrl || '').includes('youtu.be');
      if (!config.videoUrl) {
        return (
          <div className="w-full h-full bg-gray-900 rounded-xl flex flex-col items-center justify-center text-gray-400 border border-dashed border-gray-600">
            <svg width="32" height="32" fill="currentColor" viewBox="0 0 24 24" className="mb-2 opacity-50"><path d="M21 5.5l-9 5.5 9 5.5V5.5z"/><path d="M3 5h10v14H3z"/></svg>
            <span className="text-sm">Video</span>
          </div>
        );
      }
      if (isYoutube) {
        // Convert any YouTube URL to embed
        let embedUrl = config.videoUrl;
        const ytMatch = config.videoUrl.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        if (ytMatch) embedUrl = `https://www.youtube.com/embed/${ytMatch[1]}?rel=0${config.videoAutoplay ? '&autoplay=1' : ''}`;
        return (
          <iframe
            src={embedUrl}
            className="w-full h-full rounded-xl"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={widget.label || 'Video'}
            style={{ border: 'none' }}
          />
        );
      }
      return (
        <video
          src={config.videoUrl}
          controls={config.videoControls !== false}
          autoPlay={!!config.videoAutoplay}
          className="w-full h-full rounded-xl object-contain bg-black"
          title={widget.label || 'Video'}
        />
      );
    }

    case 'model-viewer': {
      if (!config.modelUrl) {
        return (
          <div className="w-full h-full bg-gray-800 rounded-xl flex flex-col items-center justify-center text-gray-400 border border-dashed border-gray-600">
            <svg width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-2 opacity-50"><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>
            <span className="text-sm">3D Model / CAD</span>
            <span className="text-xs opacity-60 mt-1">.glb · .gltf · .obj · .stl</span>
          </div>
        );
      }
      return (
        // @ts-ignore — model-viewer is a custom web component loaded via CDN script
        <model-viewer
          src={config.modelUrl}
          alt={config.modelAlt || widget.label || '3D Model'}
          auto-rotate={config.modelAutoRotate ? '' : undefined}
          camera-controls=""
          camera-orbit={config.modelCameraOrbit || '0deg 75deg 105%'}
          exposure={config.modelExposure ?? 1}
          shadow-intensity={config.modelShadowIntensity ?? 0.8}
          style={{ width: '100%', height: '100%', borderRadius: '12px', background: '#1e293b' }}
        />
      );
    }

    // ── v2 widgets (app-platform remodel §4.2) ───────────────────────────────

    case 'variable-display': {
      // Live value display. The stage passes the current variable value as
      // `value` (keyed by config.variableRef); the builder passes none, so the
      // reference renders as a mono chip placeholder.
      const label = widget.label || config.variableRef || 'Variable';
      const display = value === undefined || value === null || value === ''
        ? null
        : String(value);
      if (config.displayFormat === 'stat') {
        // dci stat tile: 11.5px uppercase label over a 30px/750 tabular value.
        return (
          <div className="w-full h-full rounded-xl border p-4 flex flex-col justify-center overflow-hidden"
            style={{ background: '#ffffff', borderColor: '#dfe4ec', boxShadow: '0 1px 3px rgba(22,35,61,0.06)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: 0.5, textTransform: 'uppercase', color: '#636f7e' }}>{label}</div>
            <div className="tnum truncate" style={{ fontSize: 30, fontWeight: 750, color: '#16233d', lineHeight: 1.25, marginTop: 2 }}>
              {display ?? <span style={{ color: '#c4cdda' }}>—</span>}
            </div>
            {display === null && config.variableRef && (
              <div className="font-mono truncate" style={{ fontSize: 11, color: '#9aa5b4' }}>{'{{'}{config.variableRef}{'}}'}</div>
            )}
          </div>
        );
      }
      return (
        <div className="w-full h-full flex items-center gap-2 overflow-hidden">
          <Variable size={15} style={{ color: '#636f7e', flexShrink: 0 }} />
          {display !== null ? (
            <span className="tnum truncate" style={{ fontSize: config.fontSize || 16, color: config.color || '#16233d', fontWeight: 550 }}>{display}</span>
          ) : (
            <span className="font-mono truncate rounded px-1.5 py-0.5" style={{ fontSize: 13, color: '#636f7e', background: '#eef1f6', border: '1px solid #dfe4ec' }}>
              {config.variableRef ? `{{${config.variableRef}}}` : 'Pick a variable'}
            </span>
          )}
        </div>
      );
    }

    case 'table-lookup': {
      // The player fetches the first matching record and passes it as `value`
      // (a field-id → display value map). Renders as a read-only field list.
      const record = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>) : null;
      const entries = record ? Object.entries(record) : [];
      return (
        <div className="w-full h-full rounded-xl border overflow-auto" style={{ background: '#ffffff', borderColor: '#dfe4ec' }}>
          <div className="flex items-center gap-1.5 px-3 py-2 border-b" style={{ borderColor: '#e4e9f1', background: '#eef1f6' }}>
            <Table2 size={13} style={{ color: '#636f7e' }} />
            <span style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: 0.5, textTransform: 'uppercase', color: '#636f7e' }}>
              {widget.label || 'Record lookup'}
            </span>
          </div>
          {entries.length > 0 ? (
            <div>
              {entries.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 border-b last:border-b-0" style={{ borderColor: '#e4e9f1' }}>
                  <span className="truncate" style={{ fontSize: 12.5, color: '#636f7e', fontWeight: 550 }}>{k}</span>
                  <span className="tnum truncate" style={{ fontSize: 13.5, color: '#16233d', fontWeight: 650 }}>{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-center" style={{ fontSize: 12.5, color: '#9aa5b4' }}>
              {config.tableId
                ? <>Looks up a record when <span className="font-mono">{config.matchVariable ? `{{${config.matchVariable}}}` : 'the match variable'}</span> changes</>
                : 'Pick a table in the panel to configure this lookup'}
            </div>
          )}
        </div>
      );
    }

    case 'kit-checklist': {
      // Kit lines arrive from the player as `value`; the builder shows a
      // representative placeholder. Verification interactivity (scan/tap)
      // lives in the player shell — this renders the checklist itself.
      const lines: KitLineLike[] = Array.isArray(value) ? (value as KitLineLike[]) : [];
      const sample: KitLineLike[] = lines.length > 0 ? lines : [
        { item_name: 'Kit line', sku: 'SKU-000', qty_required: 2, qty_picked: 2, unit: 'ea', status: 'verified' },
        { item_name: 'Kit line', sku: 'SKU-001', qty_required: 1, qty_picked: 0, unit: 'ea', status: 'pending' },
      ];
      const isPlaceholder = lines.length === 0;
      return (
        <div className="w-full h-full rounded-xl border overflow-auto flex flex-col" style={{ background: '#ffffff', borderColor: '#dfe4ec' }}>
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: '#e4e9f1', background: '#eef1f6' }}>
            <div className="flex items-center gap-1.5">
              <PackageCheck size={14} style={{ color: '#636f7e' }} />
              <span style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: 0.5, textTransform: 'uppercase', color: '#636f7e' }}>
                {widget.label || 'Kit checklist'}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#9aa5b4', fontWeight: 550 }}>
              {isPlaceholder
                ? (config.kitScope === 'step' ? 'This step’s lines' : 'All kit lines')
                : `${sample.filter(l => l.status === 'verified' || l.status === 'picked').length}/${sample.length}`}
            </span>
          </div>
          <div className={isPlaceholder ? 'opacity-60' : ''}>
            {sample.map((l, i) => {
              const st = KIT_STATUS_STYLE[l.status ?? 'pending'] ?? KIT_STATUS_STYLE.pending;
              return (
                <div key={l.id ?? i} className="flex items-center gap-3 px-3 border-b last:border-b-0" style={{ borderColor: '#e4e9f1', minHeight: 52 }}>
                  <div className="flex-shrink-0">
                    {l.status === 'verified'
                      ? <CheckCircle2 size={18} style={{ color: '#2b8a3e' }} />
                      : l.status === 'short'
                        ? <Flag size={16} style={{ color: '#d97706' }} />
                        : <span className="block rounded-full" style={{ width: 14, height: 14, border: '2px solid #c4cdda' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate" style={{ fontSize: 13.5, fontWeight: 650, color: '#16233d' }}>{l.item_name || 'Item'}</div>
                    {(l.sku || l.reference) && (
                      <div className="font-mono truncate" style={{ fontSize: 11, color: '#636f7e' }}>
                        {l.sku}{l.reference ? ` · ${l.reference}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="tnum flex-shrink-0" style={{ fontSize: 13.5, fontWeight: 650, color: '#3f4c63' }}>
                    {l.qty_picked ?? 0}/{l.qty_required ?? 0} {l.unit || 'ea'}
                  </div>
                  <span className="flex-shrink-0 rounded-full px-2 py-0.5" style={{ fontSize: 10.5, fontWeight: 650, background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
          {isPlaceholder && (
            <div className="px-3 py-2 text-center" style={{ fontSize: 11.5, color: '#9aa5b4' }}>
              Lines come from the work order&rsquo;s kit at run time
              {config.requireScan ? ' · scan-to-verify only' : ''}
            </div>
          )}
        </div>
      );
    }

    case 'scan-input': {
      const scanned = value === undefined || value === null ? '' : String(value);
      const commit = (code: string) => {
        const trimmed = code.trim();
        if (!trimmed) return;
        onChange?.(trimmed);
        onScan?.(trimmed);
        setScanDraft('');
      };
      return (
        <div className="w-full h-full flex flex-col justify-center">
          {widget.label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</label>}
          <div className="relative">
            <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#636f7e' }} />
            <input
              type="text"
              className={`${input} !pl-9 font-mono`}
              placeholder={config.placeholder || 'Scan or type code…'}
              value={scanDraft || scanned}
              onChange={e => setScanDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }}
              onBlur={e => { if (scanDraft) commit(e.target.value); }}
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            />
          </div>
          {scanned && !scanDraft && (
            <p className="mt-1 flex items-center gap-1" style={{ fontSize: 12, color: '#2b8a3e', fontWeight: 550 }}>
              <CheckCircle size={12} /> <span className="font-mono">{scanned}</span>
            </p>
          )}
        </div>
      );
    }

    case 'photo-capture': {
      const urls = typeof value === 'string' && value ? value.split(',').filter(Boolean) : [];
      const max = config.maxPhotos ?? 1;
      return (
        <div className="w-full h-full rounded-xl border border-dashed p-3 flex flex-col" style={{ background: '#fbfcfe', borderColor: '#c4cdda' }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span style={{ fontSize: 13, fontWeight: 650, color: '#3f4c63' }}>
              {widget.label || 'Photo'}{config.required && <span style={{ color: '#c92a2a' }}> *</span>}
            </span>
            <span className="tnum" style={{ fontSize: 11, color: '#9aa5b4', fontWeight: 550 }}>{urls.length}/{max}</span>
          </div>
          {urls.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2 overflow-auto">
              {urls.map((u, i) => (
                <img key={i} src={u} alt={`Photo ${i + 1}`} className="rounded-lg object-cover" style={{ width: 56, height: 56, border: '1px solid #dfe4ec' }} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onPhotoRequest?.()}
            disabled={urls.length >= max}
            className="flex-1 min-h-0 w-full rounded-lg flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-40"
            style={{ border: '1px dashed #c4cdda', color: '#636f7e', background: '#ffffff' }}
          >
            <Camera size={20} />
            <span style={{ fontSize: 12.5, fontWeight: 550 }}>
              {urls.length >= max ? 'Photo limit reached' : urls.length > 0 ? 'Add photo' : 'Take photo'}
            </span>
          </button>
        </div>
      );
    }

    default:
      return null;
  }
}

// Read-only positioned stage used by the player for canvas-mode steps. Scales a
// CANVAS_W-wide logical canvas to fit, then absolutely positions each widget.
export function CanvasStage({ widgets, height, background, values, onChange, onNext, onPrev, onComplete }: {
  widgets: Widget[];
  height: number;
  background?: string;
  values: Record<string, any>;
  onChange: (key: string, v: any) => void;
  onNext: () => void;
  onPrev: () => void;
  onComplete: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useCanvasScale(containerRef);
  const ordered = [...widgets].sort((a, b) => (a.layout?.z ?? 0) - (b.layout?.z ?? 0));

  return (
    <div ref={containerRef} className="w-full" style={{ maxWidth: CANVAS_W, margin: '0 auto' }}>
      <div style={{ height: height * scale }}>
        <div
          className="relative rounded-xl shadow-2xl overflow-hidden"
          style={{ width: CANVAS_W, height, background: background || '#ffffff', transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {ordered.map(w => {
            const l = w.layout ?? defaultLayout(w.type);
            // variable-display reads a registered variable (variableRef);
            // every other widget keeps the legacy variableName-or-id key.
            const key = w.type === 'variable-display'
              ? (w.config.variableRef || w.id)
              : (w.config.variableName || w.id);
            return (
              <div key={w.id} style={{
                position: 'absolute', left: l.x, top: l.y, width: l.width, height: l.height,
                transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
                opacity: w.config.opacity ?? 1,
              }}>
                <WidgetView
                  widget={w}
                  value={values[key]}
                  onChange={v => onChange(key, v)}
                  onNext={onNext}
                  onPrev={onPrev}
                  onComplete={onComplete}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(Math.abs(s) / 60);
  const sec = Math.abs(s) % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
