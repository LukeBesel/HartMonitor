import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardFilters } from '../api/client';
import { Dashboard, DashboardCard } from '../types';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  LayoutGrid, Plus, Trash2, Edit, RefreshCw, ChevronLeft, Settings,
  TrendingUp, BarChart3, PieChart as PieIcon, Table, Award, Clipboard, Hash, AlertTriangle
} from 'lucide-react';
import { v4 as uuidv4 } from '../utils/uuid';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import DashboardFilterBar, { FilterOption } from '../components/shared/DashboardFilterBar';
import { fmtDuration, fmtMinutes } from '../components/apps/appModel';

// ── Card palette config ───────────────────────────────────────────────────────

const CARD_TYPES = [
  { type: 'metric',       icon: Hash,       label: 'KPI Metric',      desc: 'Single number — completions, pass rate, cycle time' },
  { type: 'time_series',  icon: TrendingUp, label: 'Time Series',     desc: 'Trend chart over days — throughput, cycle time, quality' },
  { type: 'distribution', icon: PieIcon,    label: 'Distribution',    desc: 'Pie/bar breakdown — by operator, app, quality, dept' },
  { type: 'leaderboard',  icon: Award,      label: 'Leaderboard',     desc: 'Top operators by completions or cycle time' },
  { type: 'wo_status',    icon: Clipboard,  label: 'Work Order Status',desc: 'Summary of work order statuses' },
  { type: 'table',        icon: Table,      label: 'Recent Runs',     desc: 'Latest completions table' },
];

const METRIC_OPTIONS = [
  { value: 'total_completions', label: 'Total Completions' },
  { value: 'today_completions', label: 'Today\'s Completions' },
  { value: 'active_runs',       label: 'Active Runs (live)' },
  { value: 'pass_rate',         label: 'Pass Rate %' },
  { value: 'avg_cycle',         label: 'Avg Cycle Time' },
  { value: 'period_completions',label: 'Completions in Period' },
];

const SERIES_OPTIONS = [
  { value: 'throughput',   label: 'Daily Throughput' },
  { value: 'cycle_time',   label: 'Avg Cycle Time' },
  { value: 'quality',      label: 'Quality Rate %' },
];

const GROUP_BY_OPTIONS = [
  { value: 'operator',   label: 'By Operator' },
  { value: 'app',        label: 'By App' },
  { value: 'quality',    label: 'Pass vs Fail' },
  { value: 'department', label: 'By Department' },
];

const LEADERBOARD_OPTIONS = [
  { value: 'completions', label: 'Most Completions' },
  { value: 'cycle_time',  label: 'Fastest Avg Cycle' },
];

const PERIOD_OPTIONS = [7, 14, 30, 60, 90];
const CHART_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#f43f5e','#64748b'];

// ── Card renderer ─────────────────────────────────────────────────────────────

// Not a duration — a wall-clock reading (e.g. "2:45 PM") for when a run
// started. Named to stay clear of the fmt*/format* duration-formatter family.
function clockReading(iso: string) {
  const t = new Date(iso);
  return isNaN(t.getTime()) ? '—' : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * How one value on a card reads, given the unit the card says it is in.
 *
 * ONE function, so a chart's axis, that chart's tooltip and the tile beside it
 * cannot disagree: a minutes series goes through fmtMinutes (which is
 * fmtDuration on seconds), and everything else prints as the number it is.
 * Exported so the test can compare a chart's text against the per-app screen's
 * string for the same fixture — jsdom gives a Recharts chart no width, so the
 * rendered tooltip itself cannot be read there.
 */
export function seriesValueText(unit: string | undefined, value: number): string {
  return unit === 'minutes' ? fmtMinutes(value) : String(value);
}

/** "1 run" / "5 runs". */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The window a card's number was measured over — "today", "all time",
 * "last 30 days".
 *
 * Two tiles side by side, one counting today and one counting every run ever
 * recorded, with nothing on either saying so, is not a report: it is two
 * numbers a reader has to guess the meaning of, and the guess is usually that
 * the smaller one is broken. The server names the window when it can
 * (`window_label`); when it does not, the card's own configuration already
 * knows — the metric it asked for, and the period it asked over.
 */
function metricWindow(card: DashboardCard, data: any): string {
  if (typeof data?.window_label === 'string' && data.window_label) return data.window_label;
  switch (card.metric_key) {
    case 'today_completions':     return 'today';
    case 'period_completions':    return `last ${plural(card.period_days ?? 30, 'day')}`;
    case 'active_runs':           return 'right now';
    case 'low_stock_items':       return 'right now';
    case 'open_ncrs':             return 'open now';
    case 'open_maintenance_wos':  return 'open now';
    case 'pm_due':                return 'next 7 days';
    case 'total_completions':
    case 'pass_rate':
    case 'avg_cycle':
    case 'training_coverage':     return 'all time';
    default:                      return '';
  }
}

/** What a metric's `sample_size` counted, so "323" is never a bare number. */
function sampleNoun(card: DashboardCard): string {
  if (card.metric_key === 'pass_rate') return 'inspected run';
  if (card.metric_key === 'avg_cycle') return 'run';
  if (card.metric_key === 'training_coverage') return 'training record';
  return 'recorded result';
}

/** "today" · "all time · 323 runs" — the window, and the sample when there is
 *  one. Empty string when neither is known: never an invented window. */
function metricBasis(card: DashboardCard, data: any): string {
  const parts = [metricWindow(card, data)];
  if (typeof data?.sample_size === 'number') parts.push(plural(data.sample_size, sampleNoun(card)));
  return parts.filter(Boolean).join(' · ');
}

function CardDataRenderer({ card, data }: { card: DashboardCard; data: any }) {
  if (!data) return <div className="flex items-center justify-center h-24 text-gray-400 text-sm">No data</div>;

  switch (card.type) {
    case 'metric': {
      const val = data.value;
      const color = card.color || 'var(--accent)';
      // A metric with nothing behind it shows "—" and says why — never a 0 or a
      // 100% that the underlying data doesn't support.
      if (val === null || val === undefined) {
        return (
          <div className="flex flex-col items-center justify-center py-6 gap-1.5">
            <div className="text-5xl font-bold text-gray-300">—</div>
            <div className="text-xs text-gray-400 text-center px-2">{data.empty_reason || 'No data yet'}</div>
            {metricWindow(card, data) && (
              <div className="text-[11px] text-gray-400" data-testid="card-window">{metricWindow(card, data)}</div>
            )}
          </div>
        );
      }
      // A duration is a duration: the card says `unit: 'duration'` and hands
      // back the exact seconds it averaged, so this renders through the one
      // duration formatter every other screen uses. No label sniffing, no
      // re-rounding of an already-rounded minutes value — which is what kept
      // this tile disagreeing with the same runs' average on the per-app screen.
      // `suffix === 'm'` is the pre-`unit` payload, kept for one release.
      const seconds = typeof data.avg_cycle_seconds === 'number' ? data.avg_cycle_seconds : data.seconds;
      const isDuration = (data.unit === 'duration' || data.suffix === 'm') && typeof seconds === 'number';
      return (
        <div className="flex flex-col items-center justify-center py-6 gap-1">
          <div className="text-5xl font-bold" style={{ color }}>
            {isDuration
              ? fmtDuration(seconds)
              : (typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(1) : val)}
            {data.suffix && !isDuration && <span className="text-2xl ml-1 font-medium opacity-70">{data.suffix}</span>}
          </div>
          {metricBasis(card, data) && (
            <div className="text-[11px] text-gray-400" data-testid="card-window">{metricBasis(card, data)}</div>
          )}
        </div>
      );
    }

    case 'time_series': {
      const series = data.series?.[0];
      if (!series?.data?.length) return <div className="text-center py-8 text-gray-400 text-sm">No trend data yet</div>;
      // A cycle-time trend is plotted in minutes, and a minute is a duration:
      // its axis and its tooltip read "30s" and "6m 1s", exactly like the tile
      // beside it and like the same runs on the per-app screen. The card SAYS
      // it is minutes (`unit`) — nothing here reads the series name to guess.
      const minutes = data.unit === 'minutes';
      const axis = minutes ? (v: number) => seriesValueText(data.unit, v) : undefined;
      return (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series.data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d?.slice(5) || d} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={axis} width={minutes ? 52 : undefined} />
            <Tooltip
              labelFormatter={d => `Date: ${d}`}
              formatter={(v: number) => [seriesValueText(data.unit, v), series.name]}
            />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} name={series.name} />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    case 'distribution': {
      const items = data.data || [];
      if (!items.length) return <div className="text-center py-8 text-gray-400 text-sm">No data</div>;
      if (card.group_by === 'quality') {
        return (
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={items} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={60} label={({ label, value }) => `${label}: ${value}`}>
                {items.map((_: any, i: number) => (
                  <Cell key={i} fill={i === 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      return (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={items} margin={{ left: -20, right: 5, top: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" radius={[4,4,0,0]}>
              {items.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'leaderboard': {
      const rows = data.rows || [];
      // The card says what its rows are in — `unit: 'minutes'` — so the minutes
      // adapter is chosen from a fact. Sniffing the label for the word "min"
      // was the bug: "Admin Actions" contains it and is not a duration, and a
      // renamed label silently changed how numbers were formatted.
      const isMinutes = data.unit === 'minutes';
      return (
        <div className="space-y-1.5 py-2">
          {rows.slice(0, 6).map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-300 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-gray-700 truncate">{r.name}</span>
              <span className="text-sm font-bold text-gray-900">
                {isMinutes
                  ? fmtMinutes(r.value)
                  : (typeof r.value === 'number' && !Number.isInteger(r.value) ? r.value.toFixed(1) : r.value)}
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="text-center py-4 text-gray-400 text-sm">No data</div>}
        </div>
      );
    }

    case 'wo_status': {
      const c = data.counts || {};
      const items = [
        { label: 'Pending', value: c.pending || 0, color: '#9ca3af' },
        { label: 'In Progress', value: c.in_progress || 0, color: '#3b82f6' },
        { label: 'Completed', value: c.completed || 0, color: '#10b981' },
        { label: 'Overdue', value: c.overdue || 0, color: '#ef4444' },
      ];
      return (
        <div className="grid grid-cols-2 gap-2 py-2">
          {items.map(item => (
            <div key={item.label} className="text-center p-2 rounded-xl" style={{ backgroundColor: item.color + '15' }}>
              <div className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      );
    }

    case 'table': {
      const rows = data.rows || [];
      return (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-gray-100">
                <th className="text-left py-1.5 px-2 font-medium">App</th>
                <th className="text-left py-1.5 px-2 font-medium">Operator</th>
                <th className="text-left py-1.5 px-2 font-medium">Status</th>
                <th className="text-right py-1.5 px-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="py-1.5 px-2 truncate max-w-[100px]">{r.app_name}</td>
                  <td className="py-1.5 px-2">{r.operator_name}</td>
                  <td className="py-1.5 px-2">
                    <span className={`px-1.5 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-gray-500">
                    {clockReading(r.started_at)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-gray-400">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    default: return null;
  }
}

// ── Card config form ──────────────────────────────────────────────────────────

function CardConfigForm({ card, apps, onSave, onCancel }: {
  card: Partial<DashboardCard>; apps: any[]; onSave: (c: DashboardCard) => void | Promise<void>; onCancel: () => void;
}) {
  const [cfg, setCfg] = useState<Partial<DashboardCard>>({ size: 'md', period_days: 30, ...card });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setCfg(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    if (!cfg.type || !cfg.title || saving) return;
    setSaving(true);
    try {
      await onSave(cfg as DashboardCard);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="field-row gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
          <input className="input-field text-sm" value={cfg.title || ''} onChange={e => set('title', e.target.value)} placeholder="Card title..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Size</label>
          <select className="input-field text-sm" value={cfg.size || 'md'} onChange={e => set('size', e.target.value)}>
            <option value="sm">Small (1 col)</option>
            <option value="md">Medium (2 col)</option>
            <option value="lg">Large (3 col)</option>
            <option value="xl">Full width</option>
          </select>
        </div>
      </div>

      <div className="field-row gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Data Source</label>
          <select className="input-field text-sm" value={cfg.app_id || ''} onChange={e => set('app_id', e.target.value || null)}>
            <option value="">All Apps</option>
            {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Period</label>
          <select className="input-field text-sm" value={cfg.period_days || 30} onChange={e => set('period_days', Number(e.target.value))}>
            {PERIOD_OPTIONS.map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
        </div>
      </div>

      {cfg.type === 'metric' && (
        <div className="field-row gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
            <select className="input-field text-sm" value={cfg.metric_key || ''} onChange={e => set('metric_key', e.target.value)}>
              <option value="">Select metric…</option>
              {METRIC_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Accent Color</label>
            <div className="flex gap-2">
              <input type="color" className="w-9 h-9 rounded border border-gray-300 p-0.5 cursor-pointer" value={cfg.color || '#3b82f6'} onChange={e => set('color', e.target.value)} />
              <input className="input-field flex-1 text-xs" value={cfg.color || '#3b82f6'} onChange={e => set('color', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {cfg.type === 'time_series' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Data Series</label>
          <select className="input-field text-sm" value={cfg.series || ''} onChange={e => set('series', e.target.value)}>
            <option value="">Select series…</option>
            {SERIES_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}

      {cfg.type === 'distribution' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Group By</label>
          <select className="input-field text-sm" value={cfg.group_by || ''} onChange={e => set('group_by', e.target.value)}>
            <option value="">Select grouping…</option>
            {GROUP_BY_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
      )}

      {cfg.type === 'leaderboard' && (
        <div className="field-row gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Metric</label>
            <select className="input-field text-sm" value={cfg.leaderboard_metric || ''} onChange={e => set('leaderboard_metric', e.target.value)}>
              <option value="">Select…</option>
              {LEADERBOARD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Rows to show</label>
            <input type="number" className="input-field text-sm" value={cfg.limit || 5} onChange={e => set('limit', Number(e.target.value))} min={3} max={20} />
          </div>
        </div>
      )}

      {cfg.type === 'table' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rows to show</label>
          <input type="number" className="input-field text-sm" value={cfg.limit || 10} onChange={e => set('limit', Number(e.target.value))} min={5} max={50} />
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!cfg.type || !cfg.title || saving}
          className="btn-primary text-xs py-1.5 px-3"
        >
          {saving ? 'Saving…' : 'Save Card'}
        </button>
        <button onClick={onCancel} disabled={saving} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

// Card widths are quarters of the grid only once there is a grid to divide. A
// phone gets one card per row and a tablet two — a quarter-width chart on a
// 390px screen is about eighty pixels across, which is not a chart. The span
// classes are held behind the breakpoints that actually create those columns,
// because a span wider than the grid would invent an extra column and push the
// page off the screen.
const SIZE_COLS: Record<string, string> = {
  sm: 'lg:col-span-1',
  md: 'sm:col-span-2 lg:col-span-2',
  lg: 'sm:col-span-2 lg:col-span-3',
  xl: 'sm:col-span-2 lg:col-span-full',
};

// Page filters are remembered per dashboard, so a plant manager who always
// looks at Weld gets Weld back tomorrow without re-picking it.
const filtersKey = (id: string) => `hm_dashboard_filters_${id}`;

function loadStoredFilters(id: string | undefined): DashboardFilters {
  if (!id) return {};
  try {
    const raw = localStorage.getItem(filtersKey(id));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: DashboardFilters = {};
    for (const k of ['department_id', 'app_id', 'site_id'] as const) {
      if (typeof parsed[k] === 'string' && parsed[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return {};
  }
}

function storeFilters(id: string, filters: DashboardFilters) {
  try {
    if (Object.keys(filters).length === 0) localStorage.removeItem(filtersKey(id));
    else localStorage.setItem(filtersKey(id), JSON.stringify(filters));
  } catch {
    // Private mode / quota — filtering still works for this session.
  }
}

/** The skeleton a report shows while it loads. Exported so the workspace
 *  Reports routes (/reports/:category), which have to resolve their saved
 *  report's id before this view can mount, show the SAME thing rather than a
 *  second, slightly different one of their own. */
export function ReportSkeleton() {
  return (
    <div className="p-6 space-y-5">
      <div className="h-9 w-64 animate-pulse bg-gray-200 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-48 animate-pulse bg-white border border-gray-200 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** Same idea for the failure: one "couldn't load this report" for both routes. */
export function ReportLoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center py-24 gap-3 text-center">
      <AlertTriangle size={40} className="text-red-400" />
      <div>
        <p className="font-medium text-gray-500">Couldn't load this report</p>
        <p className="text-sm text-gray-400 mt-1">{message}</p>
      </div>
      <button className="btn-secondary" onClick={onRetry}>Retry</button>
      <Link to="/dashboards" className="text-blue-600 text-sm hover:underline">← Back to Report Builder</Link>
    </div>
  );
}

/** `dashboardId` lets a host route (the per-workspace Reports pages) render this
 *  view in place without navigating to /dashboards/:id — which would swap the
 *  user out of their current workspace and its tab bar. */
export default function DashboardView({ dashboardId }: { dashboardId?: string } = {}) {
  const params = useParams<{ id: string; mode?: string }>();
  const id = dashboardId ?? params.id;
  const mode = dashboardId ? undefined : params.mode;
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const embedded = !!dashboardId;
  // Embedded (workspace Reports) edits toggle in place — routing to
  // /dashboards/:id/edit would drop the user out of their workspace.
  const [embeddedEdit, setEmbeddedEdit] = useState(false);
  const isEditMode = canEdit && (embedded ? embeddedEdit : mode === 'edit');

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cardData, setCardData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [apps, setApps] = useState<any[]>([]);
  const [departments, setDepartments] = useState<FilterOption[]>([]);
  const [sites, setSites] = useState<FilterOption[]>([]);
  const [filters, setFilters] = useState<DashboardFilters>(() => loadStoredFilters(id));
  const [addingCard, setAddingCard] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [editingCard, setEditingCard] = useState<DashboardCard | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [title, setTitle] = useState('');

  // Card data is fetched on its own so a filter change reloads only the cards,
  // never the whole page. A new `filters` object changes this callback's
  // identity, which is what makes useAutoRefresh refetch immediately.
  const loadCards = useCallback(async () => {
    if (!id) return;
    const dd = await api.getDashboardData(id, filters);
    const map: Record<string, any> = {};
    for (const c of dd.cards ?? []) { if (c.data) map[c.card_id] = c.data; }
    setCardData(map);
  }, [id, filters]);

  // No polling while editing — a background reload would fight the card editor.
  const auto = useAutoRefresh(loadCards, 30_000, { enabled: !isEditMode });

  // The page shell (dashboard definition + filter option lists) loads once per
  // dashboard; it does not depend on the filters.
  const loadShell = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.getDashboard(id),
      api.getApps(),
      api.getDepartments().catch(() => []),
      api.getSites().catch(() => []),
    ])
      .then(([d, appList, deptList, siteList]) => {
        setDashboard(d);
        setTitle(d.name);
        setApps(appList);
        setDepartments((deptList ?? []).map((x: any) => ({ id: x.id, name: x.name })));
        // A single-site company has nothing to choose between — hide the select.
        const siteOptions = (siteList ?? []).map((x: any) => ({ id: x.id, name: x.name }));
        setSites(siteOptions.length > 1 ? siteOptions : []);
      })
      .catch((err: any) => setLoadError(err?.message || 'Failed to load this report'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadShell(); }, [loadShell]);

  // Switching dashboards restores that dashboard's own saved scope. Guarded so
  // the first render doesn't re-set (and therefore re-fetch) what useState
  // already read from storage.
  const lastIdRef = useRef(id);
  useEffect(() => {
    if (lastIdRef.current === id) return;
    lastIdRef.current = id;
    setFilters(loadStoredFilters(id));
  }, [id]);

  const applyFilters = (next: DashboardFilters) => {
    setFilters(next);
    if (id) storeFilters(id, next);
  };

  const saveCards = async (cards: DashboardCard[]) => {
    if (!id || !dashboard) return;
    const updated = await api.updateDashboard(id, { cards });
    setDashboard(updated);
    // Re-fetch data for new cards (respecting the current page filters).
    await auto.refresh();
  };

  const addCard = async (cfg: DashboardCard) => {
    if (!dashboard) return;
    const newCard = { ...cfg, id: uuidv4() };
    try {
      await saveCards([...(dashboard.cards ?? []), newCard]);
      setAddingCard(false);
      setSelectedType('');
    } catch (err: any) {
      alert(err.message || 'Failed to add card');
    }
  };

  const removeCard = async (cardId: string) => {
    if (!dashboard) return;
    try {
      await saveCards((dashboard.cards ?? []).filter(c => c.id !== cardId));
    } catch (err: any) {
      alert(err.message || 'Failed to remove card');
    }
  };

  const updateCard = async (updated: DashboardCard) => {
    if (!dashboard) return;
    try {
      await saveCards((dashboard.cards ?? []).map(c => c.id === updated.id ? updated : c));
      setEditingCard(null);
    } catch (err: any) {
      alert(err.message || 'Failed to update card');
    }
  };

  const saveTitle = async () => {
    if (!id || !title.trim()) return;
    setSavingTitle(true);
    try {
      await api.updateDashboard(id, { name: title.trim() });
      setDashboard(prev => prev ? { ...prev, name: title.trim() } : prev);
    } catch (err: any) {
      alert(err.message || 'Failed to rename this report');
    } finally {
      setSavingTitle(false);
    }
  };

  if (loading) return <ReportSkeleton />;

  if (!dashboard) return <ReportLoadFailed message={loadError || 'Report not found'} onRetry={loadShell} />;

  const cards = dashboard.cards ?? [];

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {!embedded && (
            <Link to="/dashboards" className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
              <ChevronLeft size={18} />
            </Link>
          )}
          {isEditMode ? (
            <div className="flex items-center gap-2">
              <input
                className="font-bold text-xl text-gray-900 bg-white border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={saveTitle}
              />
              {savingTitle && <RefreshCw size={14} className="animate-spin text-blue-500" />}
            </div>
          ) : (
            <h1 className="text-xl font-bold text-gray-900">{dashboard.name}</h1>
          )}
        </div>
        <div className="flex items-center gap-2">
          <LastRefreshed
            at={auto.lastRefreshed}
            refreshing={auto.refreshing}
            onRefresh={() => { void auto.refresh(); }}
            className="mr-1"
          />
          {embedded ? (
            canEdit && (
              <button
                onClick={() => setEmbeddedEdit(e => !e)}
                className={`text-xs py-1.5 px-3 ${isEditMode ? 'btn-primary' : 'btn-secondary'}`}
              >
                {isEditMode ? 'Done Editing' : <><Edit size={13} /> Edit</>}
              </button>
            )
          ) : isEditMode ? (
            <Link to={`/dashboards/${id}`} className="btn-primary text-xs py-1.5 px-3">
              Done Editing
            </Link>
          ) : canEdit ? (
            <Link to={`/dashboards/${id}/edit`} className="btn-secondary text-xs py-1.5 px-3">
              <Edit size={13} /> Edit
            </Link>
          ) : null}
        </div>
      </div>

      {/* Page scope — applies to every card that has the dimension */}
      <DashboardFilterBar
        departments={departments}
        apps={apps.map(a => ({ id: a.id, name: a.name }))}
        sites={sites}
        value={filters}
        onChange={applyFilters}
        refreshing={auto.refreshing}
      />

      {/* Edit mode: add card UI */}
      {isEditMode && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-5">
          {!addingCard ? (
            <button
              onClick={() => setAddingCard(true)}
              className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-blue-600 py-4 transition-colors"
            >
              <Plus size={18} /> Add Card
            </button>
          ) : !selectedType ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-gray-900">Select Card Type</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {CARD_TYPES.map(ct => (
                  <button
                    key={ct.type}
                    onClick={() => setSelectedType(ct.type)}
                    className="flex flex-col items-start gap-1.5 p-3 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 text-left transition-all"
                  >
                    <ct.icon size={18} className="text-gray-500" />
                    <div className="font-semibold text-gray-900 text-xs">{ct.label}</div>
                    <div className="text-gray-400 text-[11px] leading-tight">{ct.desc}</div>
                  </button>
                ))}
              </div>
              <button onClick={() => setAddingCard(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          ) : (
            <CardConfigForm
              card={{ type: selectedType as any }}
              apps={apps}
              onSave={addCard}
              onCancel={() => { setSelectedType(''); setAddingCard(false); }}
            />
          )}
        </div>
      )}

      {/* Cards grid */}
      {cards.length === 0 && !isEditMode ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-200" />
          <div className="text-gray-500 font-medium">No cards yet</div>
          <p className="text-gray-400 text-sm mt-1">Add KPI, chart and table cards to bring this report to life.</p>
          {canEdit && (embedded ? (
            <button onClick={() => setEmbeddedEdit(true)} className="btn-primary mt-4 mx-auto text-sm">
              <Settings size={14} /> Add cards
            </button>
          ) : (
            <Link to={`/dashboards/${id}/edit`} className="btn-primary mt-4 mx-auto text-sm">
              <Settings size={14} /> Add cards
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(card => (
            <div
              key={card.id}
              className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${SIZE_COLS[card.size || 'md'] || SIZE_COLS.md}`}
            >
              {/* Card header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <div className="font-semibold text-gray-800 text-sm truncate">{card.title}</div>
                {isEditMode && (
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingCard(card)}
                      className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-blue-600"
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      onClick={() => removeCard(card.id)}
                      className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>

              {/* Edit inline */}
              {isEditMode && editingCard?.id === card.id ? (
                <div className="p-4">
                  <CardConfigForm
                    card={editingCard}
                    apps={apps}
                    onSave={updateCard}
                    onCancel={() => setEditingCard(null)}
                  />
                </div>
              ) : (
                <div className="px-4 py-3">
                  <CardDataRenderer card={card} data={cardData[card.id]} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
