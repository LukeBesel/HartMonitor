import { useRef, useCallback } from 'react';
import { RotateCw } from 'lucide-react';
import type { Step, Widget, WidgetLayout } from '../../types';
import { WidgetView, useCanvasScale, defaultLayout, CANVAS_W, MIN_W, MIN_H } from './WidgetView';

const GRID = 8;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// Eight resize handles: corners + edge midpoints.
const HANDLES = [
  { id: 'nw', x: 0,   y: 0,   cursor: 'nwse-resize' },
  { id: 'n',  x: 0.5, y: 0,   cursor: 'ns-resize' },
  { id: 'ne', x: 1,   y: 0,   cursor: 'nesw-resize' },
  { id: 'e',  x: 1,   y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1,   y: 1,   cursor: 'nwse-resize' },
  { id: 's',  x: 0.5, y: 1,   cursor: 'ns-resize' },
  { id: 'sw', x: 0,   y: 1,   cursor: 'nesw-resize' },
  { id: 'w',  x: 0,   y: 0.5, cursor: 'ew-resize' },
] as const;

type HandleId = typeof HANDLES[number]['id'];

export default function CanvasEditor({ step, selectedId, onSelect, onChangeLayout }: {
  step: Step;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChangeLayout: (id: string, layout: WidgetLayout) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useCanvasScale(containerRef);
  const height = step.canvasHeight ?? 560;
  const ordered = [...step.widgets].sort((a, b) => (a.layout?.z ?? 0) - (b.layout?.z ?? 0));

  return (
    <div ref={containerRef} className="w-full" style={{ maxWidth: CANVAS_W, margin: '0 auto' }}>
      <div style={{ height: height * scale }}>
        <div
          className="relative rounded-xl shadow-lg overflow-hidden ring-1 ring-gray-200"
          style={{
            width: CANVAS_W, height,
            background: step.canvasBackground || '#ffffff',
            transform: `scale(${scale})`, transformOrigin: 'top left',
            backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)',
            backgroundSize: `${GRID * 2}px ${GRID * 2}px`,
          }}
          onPointerDown={e => { if (e.target === e.currentTarget) onSelect(null); }}
        >
          {ordered.map(w => (
            <EditableWidget
              key={w.id}
              widget={w}
              scale={scale}
              canvasHeight={height}
              selected={selectedId === w.id}
              onSelect={() => onSelect(w.id)}
              onChangeLayout={l => onChangeLayout(w.id, l)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EditableWidget({ widget, scale, canvasHeight, selected, onSelect, onChangeLayout }: {
  widget: Widget;
  scale: number;
  canvasHeight: number;
  selected: boolean;
  onSelect: () => void;
  onChangeLayout: (l: WidgetLayout) => void;
}) {
  const l: WidgetLayout = widget.layout ?? defaultLayout(widget.type);
  const layoutRef = useRef(l);
  layoutRef.current = l;

  const clamp = useCallback((next: WidgetLayout): WidgetLayout => {
    const width = Math.max(MIN_W, Math.round(next.width));
    const height = Math.max(MIN_H, Math.round(next.height));
    const x = Math.min(CANVAS_W - GRID, Math.max(0, Math.round(next.x)));
    const y = Math.min(canvasHeight - GRID, Math.max(0, Math.round(next.y)));
    return { ...next, x, y, width, height };
  }, [canvasHeight]);

  // Drag the whole widget.
  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...layoutRef.current };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      const useSnap = !ev.altKey;
      const nx = start.x + dx, ny = start.y + dy;
      onChangeLayout(clamp({ ...start, x: useSnap ? snap(nx) : nx, y: useSnap ? snap(ny) : ny }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Resize from a handle.
  const startResize = (e: React.PointerEvent, handle: HandleId) => {
    e.stopPropagation();
    onSelect();
    const startX = e.clientX, startY = e.clientY;
    const start = { ...layoutRef.current };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      let { x, y, width, height } = start;
      if (handle.includes('e')) width = start.width + dx;
      if (handle.includes('s')) height = start.height + dy;
      if (handle.includes('w')) { width = start.width - dx; x = start.x + dx; }
      if (handle.includes('n')) { height = start.height - dy; y = start.y + dy; }
      const useSnap = !ev.altKey;
      if (useSnap) { width = snap(width); height = snap(height); x = snap(x); y = snap(y); }
      // Keep the anchored edge fixed when shrinking past the minimum.
      if (width < MIN_W && handle.includes('w')) x = start.x + start.width - MIN_W;
      if (height < MIN_H && handle.includes('n')) y = start.y + start.height - MIN_H;
      onChangeLayout(clamp({ ...start, x, y, width, height }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Rotate around the widget center.
  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect();
    const el = (e.currentTarget as HTMLElement).closest('[data-widget-frame]') as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const move = (ev: PointerEvent) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
      const snapped = ev.altKey ? angle : Math.round(angle / 15) * 15;
      onChangeLayout({ ...layoutRef.current, rotation: Math.round(snapped) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      data-widget-frame
      style={{
        position: 'absolute', left: l.x, top: l.y, width: l.width, height: l.height,
        transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
        opacity: widget.config.opacity ?? 1,
        zIndex: selected ? 1000 : (l.z ?? 1),
      }}
      onPointerDown={startMove}
      className={`cursor-move select-none ${selected ? 'outline outline-2 outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-blue-300'}`}
    >
      {/* Inert visual — pointer events off so dragging/clicks hit the frame */}
      <div className="w-full h-full pointer-events-none">
        <WidgetView widget={widget} />
      </div>

      {selected && (
        <>
          {/* Rotation handle */}
          <div
            onPointerDown={startRotate}
            title="Rotate"
            style={{ position: 'absolute', top: -28, left: '50%', transform: 'translateX(-50%)' }}
            className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center cursor-grab active:cursor-grabbing shadow"
          >
            <RotateCw size={12} />
          </div>
          <div style={{ position: 'absolute', top: -16, left: '50%', width: 1, height: 16, background: '#3b82f6', transform: 'translateX(-50%)' }} />

          {/* Resize handles */}
          {HANDLES.map(h => (
            <div
              key={h.id}
              onPointerDown={e => startResize(e, h.id)}
              style={{
                position: 'absolute',
                left: `calc(${h.x * 100}% - 5px)`,
                top: `calc(${h.y * 100}% - 5px)`,
                cursor: h.cursor,
              }}
              className="w-2.5 h-2.5 rounded-sm bg-white border-2 border-blue-500"
            />
          ))}
        </>
      )}
    </div>
  );
}
