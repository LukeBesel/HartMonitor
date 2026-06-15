import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { Dashboard, DashboardCard } from '../types';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';
import {
  LayoutGrid, Plus, Trash2, Edit, RefreshCw, ChevronLeft, Settings,
  TrendingUp, BarChart3, PieChart as PieIcon, Table, Award, Clipboard, Hash
} from 'lucide-react';
import { v4 as uuidv4 } from '../utils/uuid';
import { useAuth } from '../context/AuthContext';

// ── Card palette config ───────────────────────────────────────────────────────

const CARD_TYPES = [
  { type: 'metric',       icon: Hash,       label: 'KPI Metric',      desc: 'Single number — completions, pass rate, cycle time' },
  { type: 'time_series',  icon: TrendingUp, label: 'Time Series',     desc: 'Trend chart over days — throughput, cycle time, quality' },
  { type: 'distribution', icon: PieIcon,    label: 'Distribution',    desc: 'Pie/bar breakdown — by operator, app, quality, dept' },
  { type: 'leaderboard',  icon: Award,      label: 'Leaderboard',     desc: 'Top operators by completions or cycle time' },
  { type: 'wo_status',    icon: Clipboard,  label: 'Work Order Status',desc: 'Summary of WO pipeline statuses' },
  { type: 'table',        icon: Table,      label: 'Recent Runs',     desc: 'Latest completions table' },
];

const METRIC_OPTIONS = [
  { value: 'total_completions', label: 'Total Completions' },
  { value: 'today_completions', label: 'Today\'s Completions' },
  { value: 'active_runs',       label: 'Active Runs (live)' },
  { value: 'pass_rate',         label: 'Pass Rate %' },
  { value: 'avg_cycle',         label: 'Avg Cycle Time (min)' },
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

function CardDataRenderer({ card, data }: { card: DashboardCard; data: any }) {
  if (!data) return <div className="flex items-center justify-center h-24 text-gray-300 text-sm">No data</div>;

  switch (card.type) {
    case 'metric': {
      const val = data.value ?? 0;
      const color = card.color || 'var(--accent)';
      return (
        <div className="flex flex-col items-center justify-center py-6 gap-1">
          <div className="text-5xl font-bold" style={{ color }}>
            {typeof val === 'number' && !Number.isInteger(val) ? val.toFixed(1) : val}
            {data.suffix && <span className="text-2xl ml-1 font-medium opacity-70">{data.suffix}</span>}
          </div>
        </div>
      );
    }

    case 'time_series': {
      const series = data.series?.[0];
      if (!series?.data?.length) return <div className="text-center py-8 text-gray-400 text-sm">No trend data yet</div>;
      return (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={series.data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d?.slice(5) || d} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={d => `Date: ${d}`} />
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
      return (
        <div className="space-y-1.5 py-2">
          {rows.slice(0, 6).map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-300 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {i + 1}
              </span>
              <span className="flex-1 text-sm text-gray-700 truncate">{r.name}</span>
              <span className="text-sm font-bold text-gray-900">{typeof r.value === 'number' && !Number.isInteger(r.value) ? r.value.toFixed(1) : r.value}{data.label?.includes('min') ? 'm' : ''}</span>
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
                    {new Date(r.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
  card: Partial<DashboardCard>; apps: any[]; onSave: (c: DashboardCard) => void; onCancel: () => void;
}) {
  const [cfg, setCfg] = useState<Partial<DashboardCard>>({ size: 'md', period_days: 30, ...card });
  const set = (k: string, v: any) => setCfg(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
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

      <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
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
          onClick={() => cfg.type && cfg.title && onSave(cfg as DashboardCard)}
          disabled={!cfg.type || !cfg.title}
          className="btn-primary text-xs py-1.5 px-3"
        >
          Save Card
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-1.5 px-3">Cancel</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const SIZE_COLS: Record<string, string> = { sm: 'col-span-1', md: 'col-span-2', lg: 'col-span-3', xl: 'col-span-full' };

export default function DashboardView() {
  const { id, mode } = useParams<{ id: string; mode?: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const isEditMode = mode === 'edit' && canEdit;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [cardData, setCardData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apps, setApps] = useState<any[]>([]);
  const [addingCard, setAddingCard] = useState(false);
  const [selectedType, setSelectedType] = useState<string>('');
  const [editingCard, setEditingCard] = useState<DashboardCard | null>(null);
  const [savingTitle, setSavingTitle] = useState(false);
  const [title, setTitle] = useState('');

  const loadData = useCallback(async (showSpin = false) => {
    if (!id) return;
    if (showSpin) setRefreshing(true);
    try {
      const [d, dd] = await Promise.all([
        dashboard ? Promise.resolve(dashboard) : api.getDashboard(id),
        api.getDashboardData(id),
      ]);
      if (!dashboard) { setDashboard(d); setTitle(d.name); }
      const map: Record<string, any> = {};
      for (const c of dd.cards) { if (c.data) map[c.card_id] = c.data; }
      setCardData(map);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, dashboard]);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getDashboard(id), api.getDashboardData(id), api.getApps()]).then(([d, dd, appList]) => {
      setDashboard(d);
      setTitle(d.name);
      setApps(appList);
      const map: Record<string, any> = {};
      for (const c of dd.cards) { if (c.data) map[c.card_id] = c.data; }
      setCardData(map);
      setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    if (!isEditMode) {
      const t = setInterval(() => loadData(false), 30000);
      return () => clearInterval(t);
    }
  }, [isEditMode, loadData]);

  const saveCards = async (cards: DashboardCard[]) => {
    if (!id || !dashboard) return;
    const updated = await api.updateDashboard(id, { cards });
    setDashboard(updated);
    // Re-fetch data for new cards
    const dd = await api.getDashboardData(id);
    const map: Record<string, any> = {};
    for (const c of dd.cards) { if (c.data) map[c.card_id] = c.data; }
    setCardData(map);
  };

  const addCard = async (cfg: DashboardCard) => {
    if (!dashboard) return;
    const newCard = { ...cfg, id: uuidv4() };
    await saveCards([...dashboard.cards, newCard]);
    setAddingCard(false);
    setSelectedType('');
  };

  const removeCard = async (cardId: string) => {
    if (!dashboard) return;
    await saveCards(dashboard.cards.filter(c => c.id !== cardId));
  };

  const updateCard = async (updated: DashboardCard) => {
    if (!dashboard) return;
    await saveCards(dashboard.cards.map(c => c.id === updated.id ? updated : c));
    setEditingCard(null);
  };

  const saveTitle = async () => {
    if (!id || !title.trim()) return;
    setSavingTitle(true);
    await api.updateDashboard(id, { name: title.trim() });
    setDashboard(prev => prev ? { ...prev, name: title.trim() } : prev);
    setSavingTitle(false);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <RefreshCw size={28} className="animate-spin text-blue-500" />
    </div>
  );

  if (!dashboard) return (
    <div className="flex items-center justify-center h-64 text-gray-400">Dashboard not found</div>
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboards" className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <ChevronLeft size={18} />
          </Link>
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
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          {isEditMode ? (
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
      {dashboard.cards.length === 0 && !isEditMode ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-200" />
          <div className="text-gray-500 font-medium">No cards yet</div>
          {canEdit && (
            <Link to={`/dashboards/${id}/edit`} className="btn-primary mt-4 mx-auto text-sm">
              <Settings size={14} /> Configure Dashboard
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {dashboard.cards.map(card => (
            <div
              key={card.id}
              className={`bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden ${SIZE_COLS[card.size || 'md'] || 'col-span-2'}`}
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
