import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useSite } from '../context/SiteContext';
import {
  TrendingUp, TrendingDown, Activity, CheckCircle,
  RefreshCw, CalendarCheck,
  BarChart2, Clock, Package,
  AlertTriangle, CheckCircle2, ChevronRight, ChevronDown, Lock, SlidersHorizontal, RotateCcw,
  Pin, Building2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import type { DailyBrief } from '../types';
import { ATTENTION_ICONS, ATTENTION_TYPE_LABELS } from '../config/attention';
import { useDashboardPrefs, DASHBOARD_SECTIONS, DashboardSectionId } from '../hooks/useDashboardPrefs';
import Toggle from '../components/shared/Toggle';
import OnboardingWizard from '../components/shared/OnboardingWizard';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import {
  LayoutDashboard, Tablet, AppWindow, CalendarRange,
  GitBranch, ShieldCheck, Bell, Database, Sparkles,
} from 'lucide-react';

// ─── Plant view types ────────────────────────────────────────────────────────

interface PlantViewData {
  kpis: {
    total_completed_today: number;
    active_now: number;
    pass_rate: number;
    avg_cycle_time: number;
    schedule_adherence: number;
    work_orders_on_track: number;
    work_orders_total: number;
  };
  department_performance: Array<{
    id: string;
    department: string;
    color: string;
    completion_count: number;
    avg_cycle_time: number;
    takt_time: number;
    on_track_count: number;
    total_count: number;
    status: 'on_track' | 'at_risk' | 'behind';
  }>;
  hourly_throughput: Array<{ hour: string; count: number }>;
  work_order_summary: { on_track: number; at_risk: number; behind: number; not_started: number };
  active_alerts: Array<{
    id: string; work_order_number: string; part_name: string;
    department: string; status: 'behind' | 'overdue';
    scheduled_end: string; completion_pct: number;
  }>;
  recent_completions: Array<{
    id: string; app_name: string; operator_name: string;
    department: string; completed_at: string; duration_minutes: number; status: string;
  }>;
}

const WO_COLORS: Record<string, string> = {
  on_track: '#22c55e', at_risk: '#f59e0b', behind: '#ef4444', not_started: '#94a3b8',
};

function fmtDuration(m: number) {
  return m < 60 ? `${m.toFixed(1)}m` : `${(m / 60).toFixed(1)}h`;
}
function fmtAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function deptBorderColor(status: string) {
  if (status === 'on_track') return 'border-l-green-500';
  if (status === 'at_risk') return 'border-l-amber-500';
  return 'border-l-red-500';
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    on_track: { label: 'On Track', cls: 'bg-green-100 text-green-700' },
    at_risk: { label: 'At Risk', cls: 'bg-amber-100 text-amber-700' },
    behind: { label: 'Behind', cls: 'bg-red-100 text-red-700' },
  };
  const s = map[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-xs font-semibold px-2 py-1 rounded-full ${s.cls}`}>{s.label}</span>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

const SCHEDULE_PILL: Record<string, string> = {
  on_track:    'bg-green-100 text-green-700',
  at_risk:     'bg-amber-100 text-amber-700',
  behind:      'bg-red-100 text-red-700',
  overdue:     'bg-red-200 text-red-800',
  not_started: 'bg-gray-100 text-gray-600',
  completed:   'bg-blue-100 text-blue-700',
};

function SkeletonBox({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 animate-pulse rounded ${className}`} />;
}

// ─── KPI card with delta ──────────────────────────────────────────────────────

function DeltaStatCard({ label, value, delta, deltaLabel, icon, iconBg, iconColor, pulse }: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  pulse?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-start gap-3">
        <div className={`relative w-10 h-10 ${iconBg} rounded-lg flex items-center justify-center flex-shrink-0`}>
          <span className={iconColor}>{icon}</span>
          {pulse && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400">
              <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-75" />
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-2xl font-bold text-gray-900 leading-none">{value}</div>
          <div className="text-xs font-medium text-gray-600 mt-0.5">{label}</div>
          {delta !== undefined && delta !== null ? (
            <div className={`flex items-center gap-1 text-xs mt-0.5 font-medium ${delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
              {delta >= 0 ? '+' : ''}{delta}% {deltaLabel}
            </div>
          ) : deltaLabel ? (
            <div className="text-xs text-gray-400 mt-0.5">{deltaLabel}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Customize panel ──────────────────────────────────────────────────────────

function CustomizePanel({
  isHidden, toggleSection, resetSections, onClose,
}: {
  isHidden: (id: DashboardSectionId) => boolean;
  toggleSection: (id: DashboardSectionId) => void;
  resetSections: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-gray-800">Customize this page</div>
          <div className="text-[11px] text-gray-400">Hide what you don't need</div>
        </div>
        <button onClick={onClose} className="text-gray-300 hover:text-gray-500 text-xs">Done</button>
      </div>
      <div className="py-1.5 max-h-80 overflow-y-auto">
        {DASHBOARD_SECTIONS.map(s => (
          <div key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-2 hover:bg-gray-50">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800">{s.label}</div>
              <div className="text-[11px] text-gray-400 truncate">{s.description}</div>
            </div>
            <Toggle checked={!isHidden(s.id)} onChange={() => toggleSection(s.id)} />
          </div>
        ))}
      </div>
      <button
        onClick={resetSections}
        className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 border-t border-gray-100 transition-colors"
      >
        <RotateCcw size={12} /> Show everything
      </button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, isAtLeast } = useAuth();
  const { selectedSiteId } = useSite();
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { isHidden, toggleSection, resetSections } = useDashboardPrefs();
  const [showCustomize, setShowCustomize] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');

  // Plant view data integrated into the Command Center
  const [plantData, setPlantData] = useState<PlantViewData | null>(null);
  const [plantLoading, setPlantLoading] = useState(true);
  const [plantExpanded, setPlantExpanded] = useState(true);
  const [pinnedStations, setPinnedStations] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('hm_pinned_stations') ?? '[]'); } catch { return []; }
  });

  const togglePin = (id: string) => {
    setPinnedStations(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      localStorage.setItem('hm_pinned_stations', JSON.stringify(next));
      return next;
    });
  };

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    const [briefRes, cfgRes] = await Promise.allSettled([
      api.getDailyBrief(),
      api.getCompanySettings(),
    ]);
    if (briefRes.status === 'fulfilled') setBrief(briefRes.value);
    if (cfgRes.status === 'fulfilled') setCompanyName(cfgRes.value?.company_name ?? '');
    setLoading(false);
    setRefreshing(false);
  }, []);

  const loadPlantData = useCallback(async () => {
    try {
      const result = await api.getPlantView({ site_id: selectedSiteId || undefined });
      setPlantData(result);
    } catch {
      // keep stale data
    } finally {
      setPlantLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(), 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    loadPlantData();
    const interval = setInterval(() => loadPlantData(), 30000);
    return () => clearInterval(interval);
  }, [loadPlantData]);

  useEffect(() => {
    if (!showCustomize) return;
    const onClick = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) setShowCustomize(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showCustomize]);

  const kpis = brief?.kpis;
  const attention = brief?.attention ?? [];

  // A brand-new workspace: nothing has ever been scheduled, run, or flagged.
  // The CTA disappears the moment sample data (which creates work orders) loads.
  const isEmptyWorkspace = !loading && !!brief
    && brief.kpis.work_orders_total === 0
    && brief.kpis.completed_today === 0
    && brief.kpis.active_now === 0
    && attention.length === 0;

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      await Promise.all([loadData(), loadPlantData()]);
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <OnboardingWizard />
      <ModuleOnboarding
        moduleId="dashboard"
        title="Welcome to your MES"
        description="This is your command center for running the shop floor — apps, work orders, stations, quality, and analytics, all in one place. Here's how the whole system fits together, and what to do on this page."
        steps={[
          "Check today's shift production stats",
          "Review open work orders and their status",
          "Respond to any active alerts",
          "Use the quick links to jump to any module",
        ]}
        icon={LayoutDashboard}
        color="#3b82f6"
        overviewTitle="What's inside your MES"
        overview={[
          { icon: LayoutDashboard, label: 'Command Center', desc: "Your home base — live output, alerts, and what needs attention first." },
          { icon: Tablet,          label: 'Operator Portal', desc: 'The shop-floor screen operators use to pick a job and start working.' },
          { icon: AppWindow,       label: 'App Library & Builder', desc: 'Build drag-and-drop digital work instructions, then publish them.' },
          { icon: Building2,       label: 'Plant View & Stations', desc: 'Define work centers and watch live status across the floor.' },
          { icon: CalendarRange,   label: 'Planning & Schedule', desc: 'Schedule work orders, balance capacity, and plan inventory.' },
          { icon: GitBranch,       label: 'Routings', desc: 'Define step-by-step manufacturing sequences with cycle times.' },
          { icon: BarChart2,       label: 'Reporting & Analytics', desc: 'Track throughput, cycle times, OEE, and custom dashboards.' },
          { icon: ShieldCheck,     label: 'Quality & NCR', desc: 'Capture pass/fail and log non-conformance reports from the floor.' },
          { icon: Bell,            label: 'Alerts & Messages', desc: 'Combines what needs attention with team broadcasts and DMs.' },
          { icon: Building2,       label: 'Per-module guides', desc: 'Each section shows a quick how-to the first time you open it.' },
        ]}
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {getGreeting()}{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {formatDate()}{companyName ? ` · ${companyName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
            Refresh
          </button>
          <div className="relative" ref={customizeRef}>
            <button
              onClick={() => setShowCustomize(o => !o)}
              title="Customize this page"
              className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm shadow-sm transition-colors ${
                showCustomize ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <SlidersHorizontal size={14} />
              Customize
            </button>
            {showCustomize && (
              <CustomizePanel
                isHidden={isHidden}
                toggleSection={toggleSection}
                resetSections={resetSections}
                onClose={() => setShowCustomize(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* First-run empty state — offer to populate a realistic starter dataset */}
      {isEmptyWorkspace && (
        <div className="rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 via-white to-indigo-50 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
              <Sparkles size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900">Your workspace is ready — let's fill it in</h2>
              <p className="text-sm text-gray-600 mt-1">
                There's no production data yet. {isAtLeast('manager')
                  ? 'Load a realistic sample dataset (apps, work orders, stations, inventory) to explore everything right away — you can clear it anytime. Or start adding your own from the App Library.'
                  : 'Ask a manager to load sample data, or start by building an app in the App Library.'}
              </p>
              {sampleError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{sampleError}</p>
              )}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {isAtLeast('manager') && (
                  <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-primary">
                    {loadingSample ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                    {loadingSample ? 'Loading…' : 'Load Sample Data'}
                  </button>
                )}
                <Link to="/apps" className="btn-secondary">
                  <AppWindow size={16} /> Go to App Library
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Needs attention */}
      {!isHidden('attention') && (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={16} className={attention.length > 0 ? 'text-red-500' : 'text-gray-300'} />
          <h2 className="font-semibold text-gray-900">Needs Attention</h2>
          {attention.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {attention.length}
            </span>
          )}
        </div>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <SkeletonBox key={i} className="h-12 w-full" />)}
          </div>
        ) : attention.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle2 size={30} className="text-green-400 mx-auto mb-2" />
            <p className="text-gray-500 text-sm font-medium">Nothing needs your attention right now</p>
            <p className="text-gray-400 text-xs mt-0.5">Work orders are on schedule, no critical issues open.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {attention.map((item, i) => (
              <Link
                key={`${item.type}-${i}`}
                to={item.link}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors group ${
                  item.severity === 'red'
                    ? 'bg-red-50 border-red-200 hover:bg-red-100'
                    : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <span className={`flex-shrink-0 ${item.severity === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                  {ATTENTION_ICONS[item.type]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide ${item.severity === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                      {ATTENTION_TYPE_LABELS[item.type]}
                    </span>
                    <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
                  </div>
                  {item.detail && <div className="text-xs text-gray-500 truncate">{item.detail}</div>}
                </div>
                <ChevronRight size={15} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
      )}

      {/* KPI row */}
      {!isHidden('kpis') && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          [1, 2, 3, 4].map(i => <SkeletonBox key={i} className="h-24 w-full" />)
        ) : (
          <>
            <DeltaStatCard
              label="Completed Today"
              value={kpis?.completed_today ?? 0}
              delta={kpis?.vs_7day_avg_pct}
              deltaLabel="vs 7-day avg"
              icon={<CheckCircle size={18} />} iconBg="bg-green-50" iconColor="text-green-600"
            />
            <DeltaStatCard
              label="Schedule Adherence"
              value={kpis?.schedule_adherence !== null ? `${kpis?.schedule_adherence}%` : '—'}
              deltaLabel={`${kpis?.work_orders_on_track ?? 0} of ${kpis?.work_orders_total ?? 0} WOs on track`}
              icon={<CalendarCheck size={18} />} iconBg="bg-teal-50" iconColor="text-teal-600"
            />
            <DeltaStatCard
              label="Pass Rate (7 days)"
              value={kpis?.pass_rate_7d !== null ? `${kpis?.pass_rate_7d}%` : '—'}
              deltaLabel="from QC results"
              icon={<TrendingUp size={18} />} iconBg="bg-purple-50" iconColor="text-purple-600"
            />
            <DeltaStatCard
              label="Active Now"
              value={kpis?.active_now ?? 0}
              deltaLabel="processes running"
              icon={<Activity size={18} />} iconBg="bg-blue-50" iconColor="text-blue-600"
              pulse={(kpis?.active_now ?? 0) > 0}
            />
          </>
        )}
      </div>
      )}

      {/* Due soon + throughput */}
      {(!isHidden('due_soon') || !isHidden('output')) && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {!isHidden('due_soon') && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Due in the Next 48 Hours</h2>
            <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              View schedule <ChevronRight size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonBox key={i} className="h-14 w-full" />)}</div>
          ) : (brief?.due_soon ?? []).length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 size={26} className="text-green-400 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Nothing due in the next two days</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {brief!.due_soon.map(wo => (
                <div key={wo.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-xs text-gray-900">{wo.work_order_number}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${SCHEDULE_PILL[wo.schedule_status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {wo.schedule_status.replace('_', ' ')}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      due {new Date(wo.scheduled_end).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 truncate mb-1.5">
                    {wo.part_name}{wo.department_name ? ` · ${wo.department_name}` : ''}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          wo.schedule_status === 'overdue' || wo.schedule_status === 'behind' ? 'bg-red-500' :
                          wo.schedule_status === 'at_risk' ? 'bg-amber-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${wo.completion_pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-500 tabular-nums">{wo.quantity_completed}/{wo.quantity}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {!isHidden('output') && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Output — Last 7 Days</h2>
            <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Analytics <ChevronRight size={12} />
            </Link>
          </div>
          {loading ? (
            <SkeletonBox className="h-52 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={brief?.throughput_7d ?? []} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="throughputFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date" tick={{ fontSize: 10 }}
                  tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                <Tooltip
                  labelFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                  formatter={(v: any) => [v, 'Completions']}
                />
                {(brief?.week_avg_per_day ?? 0) > 0 && (
                  <ReferenceLine
                    y={brief!.week_avg_per_day}
                    stroke="#9ca3af" strokeDasharray="5 4"
                    label={{ value: `avg ${brief!.week_avg_per_day}`, position: 'insideTopRight', style: { fontSize: 10, fill: '#9ca3af' } }}
                  />
                )}
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#throughputFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
        )}
      </div>
      )}

      {/* ─── Live Floor View (Plant View integrated) ─────────────────────── */}
      {!isHidden('floor') && (
      <div className="card overflow-hidden">
        <button
          onClick={() => setPlantExpanded(e => !e)}
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Activity size={16} className={plantData?.kpis.active_now ? 'text-green-500' : 'text-gray-400'} />
            <span className="font-semibold text-gray-900 text-sm">Live Floor View</span>
            {plantData && (
              <span className="text-xs text-gray-400 font-normal">
                {plantData.kpis.active_now} active · {plantData.kpis.total_completed_today} done today
              </span>
            )}
          </div>
          <ChevronDown size={14} className={`text-gray-400 transition-transform ${plantExpanded ? '' : '-rotate-90'}`} />
        </button>

        {plantExpanded && (
          <div className="border-t border-gray-100 p-5 space-y-5">
            {plantLoading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2">
                <RefreshCw size={14} className="animate-spin" /> Loading floor data…
              </div>
            ) : !plantData ? (
              <div className="text-center py-8 text-gray-400 text-sm">No plant data available</div>
            ) : (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Done Today', value: plantData.kpis.total_completed_today, icon: <CheckCircle size={15} className="text-green-600" />, bg: 'bg-green-50' },
                    { label: 'Active Now', value: plantData.kpis.active_now, icon: <Activity size={15} className="text-blue-600" />, bg: 'bg-blue-50' },
                    { label: 'Pass Rate', value: `${plantData.kpis.pass_rate}%`, icon: <TrendingUp size={15} className="text-purple-600" />, bg: 'bg-purple-50' },
                    { label: 'Avg Cycle', value: fmtDuration(plantData.kpis.avg_cycle_time), icon: <Clock size={15} className="text-orange-600" />, bg: 'bg-orange-50' },
                    { label: 'Schedule', value: `${plantData.kpis.schedule_adherence}%`, icon: <CalendarCheck size={15} className="text-teal-600" />, bg: 'bg-teal-50' },
                    { label: 'WOs On Track', value: `${plantData.kpis.work_orders_on_track}/${plantData.kpis.work_orders_total}`, icon: <Package size={15} className="text-indigo-600" />, bg: 'bg-indigo-50' },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 flex items-center gap-2.5">
                      <div className={`w-8 h-8 ${k.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{k.icon}</div>
                      <div>
                        <div className="text-base font-bold text-gray-900 leading-tight">{k.value}</div>
                        <div className="text-[11px] text-gray-500">{k.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Department cards + Hourly throughput */}
                {(!isHidden('floor_departments') || !isHidden('floor_throughput')) && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {!isHidden('floor_departments') && (
                  <div className={isHidden('floor_throughput') ? 'lg:col-span-3' : 'lg:col-span-2'}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Department Performance</h3>
                      <Link to="/departments" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                        Dept View <ChevronRight size={11} />
                      </Link>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Pinned departments first */}
                      {[
                        ...plantData.department_performance.filter(d => pinnedStations.includes(d.id || d.department)),
                        ...plantData.department_performance.filter(d => !pinnedStations.includes(d.id || d.department)),
                      ].slice(0, 6).map(dept => {
                        const isPinned = pinnedStations.includes(dept.id || dept.department);
                        const onTrackPct = dept.total_count > 0 ? Math.round((dept.on_track_count / dept.total_count) * 100) : 0;
                        const barColor = dept.status === 'on_track' ? 'bg-green-500' : dept.status === 'at_risk' ? 'bg-amber-500' : 'bg-red-500';
                        return (
                          <div key={dept.id || dept.department} className={`bg-white rounded-xl border border-gray-200 p-3 border-l-4 ${deptBorderColor(dept.status)} ${isPinned ? 'ring-2 ring-blue-300' : ''}`}>
                            <div className="flex items-start justify-between mb-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900 text-sm truncate">{dept.department}</div>
                                <div className="text-lg font-bold text-gray-900">{dept.completion_count}</div>
                                <div className="text-[11px] text-gray-500">done today</div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <StatusPill status={dept.status} />
                                {isAtLeast('manager') && (
                                  <button
                                    onClick={() => togglePin(dept.id || dept.department)}
                                    title={isPinned ? 'Unpin' : 'Pin this department'}
                                    className={`p-1 rounded-lg transition-colors ${isPinned ? 'text-blue-500 bg-blue-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'}`}
                                  >
                                    <Pin size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, dept.takt_time > 0 ? (dept.avg_cycle_time / dept.takt_time) * 100 : 0)}%` }} />
                              </div>
                              <div className="flex justify-between text-[11px] text-gray-400">
                                <span>{onTrackPct}% on track</span>
                                <span>{dept.avg_cycle_time.toFixed(1)}m avg</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {plantData.department_performance.length === 0 && (
                        <div className="col-span-2 text-center py-6 text-gray-400 text-sm">No department data</div>
                      )}
                    </div>
                  </div>
                  )}

                  {/* Hourly throughput */}
                  {!isHidden('floor_throughput') && (
                  <div className={isHidden('floor_departments') ? 'lg:col-span-3' : ''}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Hourly Throughput</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={plantData.hourly_throughput} barSize={10}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="hour" tick={{ fontSize: 9 }} tickFormatter={h => h.slice(11, 16)} interval={5} />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={22} />
                        <Tooltip labelFormatter={l => `${l}`} formatter={(v: any) => [v, 'Units']} />
                        <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  )}
                </div>
                )}

                {/* Active Alerts */}
                {!isHidden('floor_activity') && (plantData.active_alerts.length > 0 || plantData.recent_completions.length > 0) && (
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    {plantData.active_alerts.length > 0 && (
                      <div className="lg:col-span-2">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle size={14} className="text-red-500" />
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active Alerts</h3>
                          <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{plantData.active_alerts.length}</span>
                        </div>
                        <div className="space-y-2">
                          {plantData.active_alerts.slice(0, 4).map(alert => (
                            <div key={alert.id} className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${alert.status === 'overdue' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                              <AlertTriangle size={12} className={`mt-0.5 flex-shrink-0 ${alert.status === 'overdue' ? 'text-red-500' : 'text-amber-500'}`} />
                              <div className="min-w-0">
                                <div className="font-semibold text-gray-900">{alert.work_order_number}</div>
                                <div className="text-gray-600 truncate">{alert.part_name} · {alert.department}</div>
                                <div className="text-gray-400">{alert.completion_pct}% complete</div>
                              </div>
                              <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${alert.status === 'overdue' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                                {alert.status === 'overdue' ? 'Overdue' : 'Behind'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Recent completions */}
                    <div className={plantData.active_alerts.length > 0 ? 'lg:col-span-3' : 'lg:col-span-5'}>
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent Completions</h3>
                        <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">All <ChevronRight size={11} /></Link>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100">
                              {['App', 'Operator', 'Dept', 'Duration', 'Time'].map(h => (
                                <th key={h} className="text-left text-[11px] font-medium text-gray-400 pb-1.5 pr-3">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {plantData.recent_completions.slice(0, 6).map(c => (
                              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                                <td className="py-2 pr-3 font-medium text-gray-900 truncate max-w-[120px]">{c.app_name}</td>
                                <td className="py-2 pr-3 text-gray-600">{c.operator_name}</td>
                                <td className="py-2 pr-3 text-gray-500">{c.department}</td>
                                <td className="py-2 pr-3 text-gray-700 tabular-nums">{fmtDuration(c.duration_minutes)}</td>
                                <td className="py-2 text-gray-400">{fmtAgo(c.completed_at)}</td>
                              </tr>
                            ))}
                            {plantData.recent_completions.length === 0 && (
                              <tr><td colSpan={5} className="text-center py-4 text-gray-400">No recent completions</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      )}

      {/* Free-tier upgrade banner */}
      {brief && !brief.is_pro && (
        <Link to="/settings" className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors group">
          <div className="w-9 h-9 bg-amber-100 rounded-lg flex items-center justify-center text-amber-600 flex-shrink-0">
            <Lock size={16} />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-gray-800">Inventory, Quality and Purchasing alerts are available on Pro</span>
            <span className="text-xs text-gray-500 block">Low-stock, critical NCR and late-PO warnings will appear in Needs Attention after upgrading.</span>
          </div>
          <ChevronRight size={16} className="text-amber-400 group-hover:text-amber-600" />
        </Link>
      )}
    </div>
  );
}
