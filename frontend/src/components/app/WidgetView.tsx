import { useEffect, useRef, useState } from 'react';
import { CheckCircle, ChevronDown, Image as ImageIcon, PenTool } from 'lucide-react';
import type { Widget, WidgetType, WidgetLayout } from '../../types';

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
    default:              return at(360, 80);
  }
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

// Renders a single widget filling its parent box. Used identically by the
// builder (pointer-events disabled by the editor frame) and the player
// (interactive). Light theme so a white/colored canvas reads like a slide.
export function WidgetView({ widget, value, onChange, onNext, onPrev, onComplete }: {
  widget: Widget;
  value?: any;
  onChange?: (v: any) => void;
  onNext?: () => void;
  onPrev?: () => void;
  onComplete?: () => void;
}) {
  const { config } = widget;
  const [timerRunning, setTimerRunning] = useState(!!config.autoStart);
  const [timerLeft, setTimerLeft] = useState(config.duration || 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [counterVal, setCounterVal] = useState<number>(config.initialValue ?? 0);

  useEffect(() => {
    if (timerRunning && timerLeft > 0) {
      timerRef.current = setInterval(() => setTimerLeft(t => {
        if (t <= 1) { setTimerRunning(false); if (timerRef.current) clearInterval(timerRef.current); return 0; }
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

    case 'number-input':
      return (
        <div className="w-full h-full flex flex-col justify-center">
          {widget.label && <label className="block text-sm font-medium text-gray-700 mb-1.5">{widget.label}{config.required && <span className="text-red-500 ml-1">*</span>}</label>}
          <input type="number" className={input} placeholder={config.placeholder} value={value ?? ''} onChange={e => onChange?.(e.target.value)} min={config.min} max={config.max} step={config.step} />
        </div>
      );

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
      return (
        <button type="button" onClick={click}
          className="w-full h-full rounded-xl font-semibold text-white transition-all hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: config.buttonColor || '#3b82f6', fontSize: config.buttonSize === 'lg' ? 20 : config.buttonSize === 'sm' ? 14 : 16, borderRadius: config.borderRadius }}>
          {config.buttonText || 'Next'}
        </button>
      );
    }

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
            const key = w.config.variableName || w.id;
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
