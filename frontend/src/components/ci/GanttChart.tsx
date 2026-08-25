import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarOff, Link2 } from 'lucide-react';
import type { CIProjectTask, CITaskStatus } from '../../types';
import {
  buildTimeline, buildTicks, taskBar, todayMarker, chartWidthPx, pxPerDayFor,
  type GanttTimeline,
} from '../../utils/gantt';

// ─── GanttChart ───────────────────────────────────────────────────────────────
// Hand-built with divs and one SVG overlay — no charting dependency.
//
// Layout: ONE horizontal scroll port. The task-name column is `sticky left-0`
// inside it, so on a phone you scroll the timeline sideways while the names stay
// put, and the page body itself never scrolls horizontally. The chart body's
// width is pixels (days x pxPerDay); every bar inside it is a percentage of that
// width, which is why the geometry is testable without a DOM.
//
// Rows are a fixed height on purpose: the dependency connectors are drawn in an
// SVG overlaid on the body, and fixed rows are what let their endpoints be
// computed from a row index rather than measured.

const ROW_H = 40;          // px — must match the row height class below
const HEADER_H = 40;       // px — tall enough that the Today flag clears the tick labels

// The sticky task-name column. On a phone the full-width version eats more than
// half the port and leaves a peephole of timeline, so it narrows below ~560px.
const LABEL_W_WIDE = 168;
const LABEL_W_NARROW = 112;
const NARROW_PORT = 560;

interface TaskVisual {
  label: string;
  /** The lighter track the bar sits in. */
  track: string;
  /** The solid progress fill. */
  fill: string;
  /** Legend / dot colour. */
  dot: string;
}

// Keys are the stored vocabulary (a CHECK constraint); labels are what a person
// reads. Never let the two drift.
export const TASK_VISUALS: Record<CITaskStatus, TaskVisual> = {
  not_started: { label: 'Not started', track: 'bg-gray-200',    fill: 'bg-gray-400',    dot: 'bg-gray-400' },
  in_progress: { label: 'In progress', track: 'bg-blue-100',    fill: 'bg-blue-500',    dot: 'bg-blue-500' },
  blocked:     { label: 'Blocked',     track: 'bg-red-100',     fill: 'bg-red-500',     dot: 'bg-red-500' },
  done:        { label: 'Done',        track: 'bg-emerald-100', fill: 'bg-emerald-500', dot: 'bg-emerald-500' },
};

const FALLBACK_VISUAL: TaskVisual = { label: 'Unknown', track: 'bg-gray-200', fill: 'bg-gray-400', dot: 'bg-gray-400' };

export function taskVisual(status: string): TaskVisual {
  return (TASK_VISUALS as Record<string, TaskVisual>)[status] ?? FALLBACK_VISUAL;
}

export interface GanttChartProps {
  tasks: CIProjectTask[];
  projectStart?: string | null;
  projectTarget?: string | null;
  /** Clicking a row opens it for editing — a Gantt you can only look at is not project management. */
  onSelectTask?: (task: CIProjectTask) => void;
  /** Injectable clock, so the today marker is deterministic in tests. */
  now?: number;
  /** Horizontal zoom, in pixels per day. Defaults to a width that suits the
   *  project's length — see `pxPerDayFor`. */
  pxPerDay?: number;
}

/** One row's fully-resolved drawing instructions. */
interface Row {
  task: CIProjectTask;
  index: number;
  leftPct: number | null;
  widthPct: number | null;
}

export default function GanttChart({
  tasks, projectStart, projectTarget, onSelectTask, now, pxPerDay,
}: GanttChartProps) {
  const timeline = useMemo<GanttTimeline | null>(
    () => buildTimeline(tasks, projectStart, projectTarget),
    [tasks, projectStart, projectTarget],
  );

  const ticks = useMemo(() => (timeline ? buildTicks(timeline) : []), [timeline]);

  // The width the project NEEDS. When the panel is wider than that, the chart
  // stretches to fill it rather than leaving a ragged strip of empty grid on the
  // right; when the panel is narrower, this width is what makes the port scroll.
  const naturalW = timeline ? chartWidthPx(timeline, pxPerDay ?? pxPerDayFor(timeline.days)) : 0;
  const portRef = useRef<HTMLDivElement>(null);
  const [portW, setPortW] = useState(0);
  useEffect(() => {
    const el = portRef.current;
    if (!el) return;
    // Measure once up front, so the chart is right on the very first paint even
    // where ResizeObserver is missing or stubbed out. The observer below is the
    // upgrade that keeps it right as the panel changes size.
    setPortW(el.clientWidth);
    let ro: ResizeObserver;
    try {
      ro = new ResizeObserver(() => setPortW(el.clientWidth));
      ro.observe(el);
    } catch {
      return;   // no usable ResizeObserver — the one-shot measurement stands
    }
    return () => ro.disconnect();
  }, [timeline?.days, tasks.length]);
  const labelW = portW > 0 && portW < NARROW_PORT ? LABEL_W_NARROW : LABEL_W_WIDE;
  const chartW = Math.max(naturalW, portW > 0 ? portW - labelW : 0);

  const todayPct = timeline ? todayMarker(timeline, now ?? Date.now()) : null;

  const rows = useMemo<Row[]>(() => {
    if (!timeline) return [];
    return tasks.map((task, index) => {
      const bar = taskBar(task, timeline);
      return { task, index, leftPct: bar?.leftPct ?? null, widthPct: bar?.widthPct ?? null };
    });
  }, [tasks, timeline]);

  // Finish-to-start connectors: predecessor's right edge → successor's left edge.
  // Only drawn when BOTH ends are scheduled; an unscheduled task has no edge to
  // draw to, and a guessed one would be a made-up date.
  const links = useMemo(() => {
    if (!timeline) return [];
    const byId = new Map(rows.map(r => [r.task.id, r]));
    const out: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const row of rows) {
      const predId = row.task.depends_on;
      if (!predId) continue;
      const pred = byId.get(predId);
      if (!pred) continue;
      if (pred.leftPct === null || pred.widthPct === null || row.leftPct === null) continue;
      out.push({
        key: `${predId}->${row.task.id}`,
        x1: ((pred.leftPct + pred.widthPct) / 100) * chartW,
        y1: pred.index * ROW_H + ROW_H / 2,
        x2: (row.leftPct / 100) * chartW,
        y2: row.index * ROW_H + ROW_H / 2,
      });
    }
    return out;
  }, [rows, chartW, timeline]);

  if (tasks.length === 0) {
    return (
      <div className="border border-dashed border-gray-300 rounded-xl py-10 px-4 text-center" data-testid="gantt-no-tasks">
        <p className="text-sm font-semibold text-gray-700">No tasks on this project yet</p>
        <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed">
          A Gantt chart is drawn from tasks. Add the first one and it appears here as a bar on the timeline.
        </p>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="border border-dashed border-gray-300 rounded-xl py-10 px-4 text-center" data-testid="gantt-no-dates">
        <CalendarOff size={22} className="text-gray-400 mx-auto mb-2" strokeWidth={1.75} />
        <p className="text-sm font-semibold text-gray-700">Nothing is scheduled yet</p>
        <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed">
          {tasks.length === 1 ? 'This task has' : `None of these ${tasks.length} tasks have`} a start or end date, and
          the project has no window either — so there is no timeline to draw. Give a task dates to see it on the chart.
        </p>
      </div>
    );
  }

  const bodyH = rows.length * ROW_H;

  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
      {/* The single scroll port. `overflow-x-auto` here — never on the page body. */}
      <div ref={portRef} className="overflow-x-auto" data-testid="gantt-scroll">
        <div style={{ minWidth: labelW + chartW }}>

          {/* ── Time axis ─────────────────────────────────────────────────── */}
          <div className="flex border-b border-gray-200 bg-gray-50" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-20 bg-gray-50 border-r border-gray-200 flex items-center px-3"
              style={{ width: labelW, minWidth: labelW }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Task</span>
            </div>
            <div className="relative" style={{ width: chartW, minWidth: chartW }}>
              {ticks.map(tick => (
                <div
                  key={tick.ms}
                  className={`absolute top-0 bottom-0 border-r border-gray-200 flex flex-col items-center justify-end pb-1 ${tick.weekend ? 'bg-gray-100' : ''}`}
                  style={{ left: `${tick.leftPct}%`, width: `${tick.widthPct}%` }}
                >
                  <span className="text-[10px] font-semibold text-gray-600 leading-none [font-variant-numeric:tabular-nums]">{tick.label}</span>
                  {tick.sublabel && (
                    <span className="text-[9px] text-gray-400 leading-none mt-0.5">{tick.sublabel}</span>
                  )}
                </div>
              ))}
              {todayPct !== null && (
                <div
                  className="absolute top-0 bottom-0 z-10 flex justify-center"
                  style={{ left: `${todayPct}%` }}
                  aria-hidden="true"
                >
                  <span className="text-[9px] font-bold text-rose-600 bg-white px-1 rounded-b leading-tight self-start shadow-sm">Today</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Rows ──────────────────────────────────────────────────────── */}
          <div className="relative" style={{ height: bodyH }}>
            {rows.map(row => {
              const vis = taskVisual(row.task.status);
              const scheduled = row.leftPct !== null && row.widthPct !== null;
              return (
                <div
                  key={row.task.id}
                  className="absolute left-0 right-0 flex border-b border-gray-100 hover:bg-blue-50/40 transition-colors"
                  style={{ top: row.index * ROW_H, height: ROW_H }}
                >
                  {/* Sticky name column */}
                  <button
                    type="button"
                    onClick={() => onSelectTask?.(row.task)}
                    className="sticky left-0 z-20 bg-white hover:bg-gray-50 border-r border-gray-200 flex items-center gap-2 px-3 text-left transition-colors"
                    style={{ width: labelW, minWidth: labelW }}
                    title={row.task.name}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${vis.dot}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-gray-800 truncate">{row.task.name}</span>
                      {row.task.depends_on_name && (
                        <span className="flex items-center gap-1 text-[10px] text-gray-400">
                          <Link2 size={9} className="shrink-0" />
                          {/* The ellipsis has to live on the TEXT node — a flex
                              container with `truncate` clips mid-word instead. */}
                          <span className="truncate">after {row.task.depends_on_name}</span>
                        </span>
                      )}
                    </span>
                  </button>

                  {/* Timeline lane */}
                  <div className="relative" style={{ width: chartW, minWidth: chartW }}>
                    {/* Grid, redrawn per row so columns always line up with the axis */}
                    {ticks.map(tick => (
                      <div
                        key={tick.ms}
                        className={`absolute top-0 bottom-0 border-r border-gray-100 ${tick.weekend ? 'bg-gray-50' : ''}`}
                        style={{ left: `${tick.leftPct}%`, width: `${tick.widthPct}%` }}
                        aria-hidden="true"
                      />
                    ))}
                    {todayPct !== null && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-rose-400/80 z-10"
                        style={{ left: `${todayPct}%` }}
                        aria-hidden="true"
                        data-testid="gantt-today"
                      />
                    )}

                    {scheduled ? (
                      <button
                        type="button"
                        onClick={() => onSelectTask?.(row.task)}
                        data-testid="gantt-bar"
                        data-task-id={row.task.id}
                        data-left-pct={row.leftPct!.toFixed(4)}
                        data-width-pct={row.widthPct!.toFixed(4)}
                        className={`absolute top-1/2 -translate-y-1/2 h-5 rounded-md ${vis.track} ring-1 ring-inset ring-black/5 overflow-hidden text-left hover:ring-2 hover:ring-blue-400 transition-shadow`}
                        style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%` }}
                        title={`${row.task.name} — ${vis.label}, ${row.task.progress}%  (${row.task.start_date?.slice(0, 10) ?? 'no start'} → ${row.task.end_date?.slice(0, 10) ?? 'no end'})`}
                      >
                        <span
                          className={`absolute inset-y-0 left-0 ${vis.fill}`}
                          style={{ width: `${Math.min(100, Math.max(0, row.task.progress))}%` }}
                          aria-hidden="true"
                        />
                        <span className="relative z-10 pl-1.5 pr-1 text-[10px] font-semibold text-gray-900/80 whitespace-nowrap leading-5 block truncate">
                          {row.task.progress > 0 ? `${row.task.progress}%` : ''}
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectTask?.(row.task)}
                        data-testid="gantt-unscheduled"
                        data-task-id={row.task.id}
                        className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] text-gray-400 italic hover:text-gray-600"
                      >
                        <CalendarOff size={11} />
                        No dates — not on the timeline
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Dependency connectors, drawn over the lanes (never over the names). */}
            {links.length > 0 && (
              <svg
                className="absolute pointer-events-none z-0"
                style={{ left: labelW, top: 0, width: chartW, height: bodyH }}
                width={chartW}
                height={bodyH}
                data-testid="gantt-links"
                aria-hidden="true"
              >
                <defs>
                  <marker id="ci-gantt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" className="fill-gray-400" />
                  </marker>
                </defs>
                {links.map(l => {
                  // Elbow: out of the predecessor, across, then into the successor.
                  const stub = 10;
                  const midX = Math.max(l.x1 + stub, l.x2 - stub);
                  return (
                    <polyline
                      key={l.key}
                      points={`${l.x1},${l.y1} ${l.x1 + stub},${l.y1} ${midX},${l.y1} ${midX},${l.y2} ${l.x2 - 2},${l.y2}`}
                      className="stroke-gray-400"
                      strokeWidth="1.25"
                      strokeDasharray="3 2"
                      fill="none"
                      markerEnd="url(#ci-gantt-arrow)"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        </div>
      </div>

      {/* Legend — the bar colours mean the stored statuses, spelled out. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 border-t border-gray-200 bg-gray-50">
        {(Object.keys(TASK_VISUALS) as CITaskStatus[]).map(s => (
          <span key={s} className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <span className={`w-2.5 h-2.5 rounded-sm ${TASK_VISUALS[s].fill}`} aria-hidden="true" />
            {TASK_VISUALS[s].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span className="w-px h-3 bg-rose-400" aria-hidden="true" />
          Today
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Link2 size={10} />
          Finish-to-start dependency
        </span>
      </div>
    </div>
  );
}
