import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useSite } from '../context/SiteContext';
import {
  TrendingUp, Activity, CheckCircle,
  RefreshCw, CalendarCheck,
  BarChart2, Clock, Package,
  AlertTriangle, CheckCircle2, ChevronRight, ChevronDown, ChevronUp, Lock, SlidersHorizontal, RotateCcw,
  Pin, Building2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import type { AndonTeam, AttentionItem, DailyBrief } from '../types';
import type { DashboardFilters } from '../api/client';
import { attentionIcon, attentionLabel } from '../config/attention';
import { ANDON_TEAMS, ANDON_TEAM_ORDER, teamConfig } from '../config/andonTeams';
import { subscribeRealtime, isAndonEvent } from '../utils/realtime';
import { useDashboardPrefs, DASHBOARD_SECTIONS, DashboardSectionId } from '../hooks/useDashboardPrefs';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import Toggle from '../components/shared/Toggle';
import OnboardingWizard from '../components/shared/OnboardingWizard';
import ModuleOnboarding, { markWalkthroughSeen } from '../components/shared/ModuleOnboarding';
import PageHeader from '../components/shared/PageHeader';
import StatCard from '../components/shared/StatCard';
import DashboardFilterBar, { FilterOption } from '../components/shared/DashboardFilterBar';
import EmptyState from '../components/shared/EmptyState';
import {
  LayoutDashboard, Tablet, AppWindow, CalendarRange,
  GitBranch, ShieldCheck, Bell, Database, Sparkles,
} from 'lucide-react';

// ─── Plant view types ────────────────────────────────────────────────────────

interface PlantViewData {
  kpis: {
    total_completed_today: number;
    active_now: number;
    /** null when no run has recorded a QC result. */
    pass_rate: number | null;
    /** null when nothing in scope has finished — render '—', never 0. */
    avg_cycle_time: number | null;
    /** % of open work orders on track — null when there are none. */
    schedule_adherence: number | null;
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
    status: 'on_track' | 'at_risk' | 'behind' | 'idle';
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
  if (status === 'idle') return 'border-l-gray-300';
  return 'border-l-red-500';
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    on_track: { label: 'On Track', cls: 'bg-green-100 text-green-700' },
    at_risk: { label: 'At Risk', cls: 'bg-amber-100 text-amber-700' },
    behind: { label: 'Behind', cls: 'bg-red-100 text-red-700' },
    // No work orders assigned — neither good nor bad news.
    idle: { label: 'No work', cls: 'bg-gray-100 text-gray-600' },
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

// ─── Page scope ───────────────────────────────────────────────────────────────
// The Command Center's department / app filter — the same bar the workspace
// Reports pages use, so the two screens feel like one product.
//
// Remembered per user rather than per browser: two supervisors sharing the
// office terminal must not inherit each other's scope. Site is deliberately NOT
// offered here — the app-wide site switcher already owns that choice, and a
// second control for it would let the two disagree.
const scopeKey = (userId?: string) => `hm_command_center_filters_${userId ?? 'anon'}`;

/** The brief, plus the two fields the server adds to explain what a narrowed
 *  scope could not account for. */
type ScopedBrief = DailyBrief & {
  attention_plant_wide_hidden?: number;
  attention_plant_wide_kinds?: string[];
};

function loadStoredScope(userId?: string): DashboardFilters {
  try {
    const raw = localStorage.getItem(scopeKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: DashboardFilters = {};
    for (const k of ['department_id', 'app_id'] as const) {
      if (typeof parsed[k] === 'string' && parsed[k]) out[k] = parsed[k];
    }
    return out;
  } catch {
    return {};
  }
}

function storeScope(userId: string | undefined, filters: DashboardFilters) {
  try {
    if (Object.keys(filters).length === 0) localStorage.removeItem(scopeKey(userId));
    else localStorage.setItem(scopeKey(userId), JSON.stringify(filters));
  } catch {
    // Private mode / quota — the scope still works for this session.
  }
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
    <div className="absolute right-0 top-full mt-2 w-72 popover z-50 animate-slide-up">
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
  const [brief, setBrief] = useState<ScopedBrief | null>(null);
  // The header subtitle used to re-fetch the whole company settings bag on every
  // poll tick just to read one name off it. The branding provider already has it.
  const { companyName } = useBranding();
  const [loading, setLoading] = useState(true);
  const { isHidden, toggleSection, resetSections } = useDashboardPrefs();
  const [showCustomize, setShowCustomize] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');

  // ── Page scope: department + app. Every section below is fetched with it.
  const [filters, setFilters] = useState<DashboardFilters>(() => loadStoredScope(user?.id));
  const [departments, setDepartments] = useState<FilterOption[]>([]);
  const [apps, setApps] = useState<FilterOption[]>([]);
  const filtersActive = !!(filters.department_id || filters.app_id);

  const applyFilters = useCallback((next: DashboardFilters) => {
    setFilters(next);
    storeScope(user?.id, next);
  }, [user?.id]);

  // Signing in as someone else restores THEIR scope, not the previous person's.
  const lastUserRef = useRef(user?.id);
  useEffect(() => {
    if (lastUserRef.current === user?.id) return;
    lastUserRef.current = user?.id;
    setFilters(loadStoredScope(user?.id));
  }, [user?.id]);

  // Options for the bar. Departments follow the active site, so the picker never
  // offers a department that belongs to a plant the user isn't looking at.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getDepartments(selectedSiteId ? { site_id: selectedSiteId } : undefined).catch(() => []),
      api.getApps().catch(() => []),
    ]).then(([deptList, appList]: [FilterOption[], FilterOption[]]) => {
      if (cancelled) return;
      setDepartments((deptList ?? []).map(d => ({ id: d.id, name: d.name })));
      setApps((appList ?? []).map(a => ({ id: a.id, name: a.name })));
    });
    return () => { cancelled = true; };
  }, [selectedSiteId]);

  // A remembered department that belongs to another site — or an app that has
  // since been deleted — would scope every card to nothing and read as an empty
  // plant. Drop it as soon as the option lists say it no longer exists.
  useEffect(() => {
    const next = { ...filters };
    let changed = false;
    if (next.department_id && departments.length > 0 && !departments.some(d => d.id === next.department_id)) {
      delete next.department_id; changed = true;
    }
    if (next.app_id && apps.length > 0 && !apps.some(a => a.id === next.app_id)) {
      delete next.app_id; changed = true;
    }
    if (changed) applyFilters(next);
  }, [departments, apps, filters, applyFilters]);

  const scopeLabel = useMemo(() => [
    filters.department_id ? departments.find(d => d.id === filters.department_id)?.name : null,
    filters.app_id ? apps.find(a => a.id === filters.app_id)?.name : null,
  ].filter(Boolean).join(' · '), [filters, departments, apps]);

  /** "in Welding · Weld Check" — appended to every "no data" reason so a dash
   *  always says WHY it is a dash rather than implying a zero. */
  const inScope = filtersActive ? ` in ${scopeLabel || 'this filter'}` : '';

  // Help-request routing: filter the attention list to one team's queue, and
  // acknowledge / resolve a request without leaving the Command Center.
  const [attentionTeam, setAttentionTeam] = useState<AndonTeam | 'all'>('all');
  const [attentionExpanded, setAttentionExpanded] = useState(false);
  const [callActionId, setCallActionId] = useState<string | null>(null);
  const [callError, setCallError] = useState('');

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

  // Both loaders take the page scope, so a filter change re-fetches EVERY
  // section rather than narrowing one card and leaving the rest plant-wide. A
  // new `filters` object changes these callbacks' identity, which is what makes
  // useAutoRefresh refetch immediately.
  const loadData = useCallback(async () => {
    try {
      setBrief(await api.getDailyBrief(filters));
    } catch {
      // keep whatever is on screen; the page surfaces its own load errors
    }
    setLoading(false);
  }, [filters]);

  const loadPlantData = useCallback(async () => {
    try {
      const result = await api.getPlantView({ ...filters, site_id: selectedSiteId || undefined });
      setPlantData(result);
    } catch {
      // keep stale data
    } finally {
      setPlantLoading(false);
    }
  }, [selectedSiteId, filters]);

  // Live data: the brief moves slowly (60s), the floor moves fast (30s). Both
  // pause while the tab is hidden and catch up the moment it comes back.
  const briefRefresh = useAutoRefresh(loadData, 60_000);
  const plantRefresh = useAutoRefresh(loadPlantData, 30_000);
  const refreshAll = () => { void briefRefresh.refresh(); void plantRefresh.refresh(); };

  // A help request raised on any tablet appears here at once — the 60s poll
  // above is only the backstop for a dropped socket. Refreshing through the
  // hook keeps the freshness stamp honest about when the data actually landed.
  const refreshBrief = briefRefresh.refresh;
  useEffect(() => subscribeRealtime(evt => {
    if (isAndonEvent(evt)) void refreshBrief();
  }), [refreshBrief]);

  const respondToCall = useCallback(async (item: AttentionItem, action: 'ack' | 'resolve') => {
    if (!item.call_id || callActionId) return;
    setCallActionId(item.call_id);
    setCallError('');
    try {
      if (action === 'ack') await api.acknowledgeAndonCall(item.call_id);
      else await api.resolveAndonCall(item.call_id);
      await refreshBrief();
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Could not update the request.');
    } finally {
      setCallActionId(null);
    }
  }, [callActionId, refreshBrief]);

  useEffect(() => {
    if (!showCustomize) return;
    const onClick = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) setShowCustomize(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showCustomize]);

  const kpis = brief?.kpis;
  const allAttention = brief?.attention ?? [];

  // Help requests can be filtered to one team — a maintenance lead wants their
  // queue, not everyone's. Other items are never hidden by a team filter.
  const callTeams = Array.from(new Set(
    allAttention.filter(i => i.type === 'andon_call' && i.team).map(i => i.team as AndonTeam),
  ));
  const attention = attentionTeam === 'all'
    ? allAttention
    : allAttention.filter(i => i.type !== 'andon_call' || i.team === attentionTeam);

  // Two at a time. A wall of eight rows reads as noise and buries whichever one
  // actually matters; the rest are one click away.
  const ATTENTION_PREVIEW = 2;
  const attentionShown = attentionExpanded ? attention : attention.slice(0, ATTENTION_PREVIEW);
  const attentionHidden = attention.length - attentionShown.length;
  const openCallCount = allAttention.filter(i => i.type === 'andon_call').length;

  // A brand-new workspace: nothing has ever been scheduled, run, or flagged.
  // The CTA disappears the moment sample data (which creates work orders) loads.
  // Never shown while a filter is on — an empty DEPARTMENT is not an empty
  // company, and "build your first app" would be a lie on a running plant.
  const isEmptyWorkspace = !loading && !!brief && !filtersActive
    && brief.kpis.work_orders_total === 0
    && brief.kpis.completed_today === 0
    && brief.kpis.active_now === 0
    && attention.length === 0;

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      await Promise.all([briefRefresh.refresh(), plantRefresh.refresh()]);
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* One tour only: when the setup wizard shows, it permanently absorbs the
          dashboard walkthrough so new users never get two popups in a row. */}
      <OnboardingWizard onWillShow={() => markWalkthroughSeen('dashboard')} />
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
      <PageHeader
        title={<>{getGreeting()}{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}</>}
        subtitle={<>{formatDate()}{companyName ? ` · ${companyName}` : ''}</>}
        actions={
          <>
            <LastRefreshed
              at={briefRefresh.lastRefreshed}
              refreshing={briefRefresh.refreshing || plantRefresh.refreshing}
              onRefresh={refreshAll}
              className="mr-1"
            />
            <div className="relative" ref={customizeRef}>
              <button
                onClick={() => setShowCustomize(o => !o)}
                title="Customize this page"
                className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium shadow-sm transition-colors ${
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
          </>
        }
      />

      {/* Page scope. Every section below is fetched with these values — there is
          no card on this page that quietly stays plant-wide. */}
      <DashboardFilterBar
        departments={departments}
        apps={apps}
        sites={[]}
        value={filters}
        onChange={applyFilters}
        refreshing={briefRefresh.refreshing || plantRefresh.refreshing}
      />

      {/* First-run empty state — offer to populate a realistic starter dataset */}
      {isEmptyWorkspace && (
        <div className="rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 via-white to-indigo-50 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
              <Sparkles size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900">Your workspace is ready — build your first app</h2>
              <p className="text-sm text-gray-600 mt-1">
                Every number on this page comes from an app your floor runs. Build one — a guided
                procedure with the checks and readings you want captured — and this dashboard fills
                itself in as operators work through it.
                {isAtLeast('manager')
                  ? ' Prefer to look around first? Load a realistic sample dataset and clear it whenever you like.'
                  : ' A manager can also load sample data if you want to explore first.'}
              </p>
              {sampleError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{sampleError}</p>
              )}
              <div className="flex items-center gap-2 mt-4 flex-wrap">
                {/* Apps are the product's front door, so this is the primary
                    action even for managers who could load sample data instead. */}
                <Link to="/apps?new=1" className="btn-primary">
                  <AppWindow size={16} /> Build your first app
                </Link>
                {isAtLeast('manager') && (
                  <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-secondary">
                    {loadingSample ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                    {loadingSample ? 'Loading…' : 'Load Sample Data'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Needs attention */}
      {!isHidden('attention') && (
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <AlertTriangle size={16} className={attention.length > 0 ? 'text-red-500' : 'text-gray-300'} />
          <h2 className="font-semibold text-gray-900">Needs Attention</h2>
          {attention.length > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded-full">
              {attention.length}
            </span>
          )}
          {openCallCount > 0 && (
            <Link
              to="/andon"
              className="ml-auto text-xs font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1"
            >
              {openCallCount} help request{openCallCount === 1 ? '' : 's'} waiting
              <ChevronRight size={13} />
            </Link>
          )}
        </div>

        {/* Route by team — a maintenance lead sees their queue, not everyone's. */}
        {callTeams.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mr-1">Team:</span>
            <button
              onClick={() => setAttentionTeam('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                attentionTeam === 'all' ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {ANDON_TEAM_ORDER.filter(t => callTeams.includes(t)).map(team => {
              const cfg = ANDON_TEAMS[team];
              const Icon = cfg.icon;
              const n = allAttention.filter(i => i.type === 'andon_call' && i.team === team).length;
              return (
                <button
                  key={team}
                  onClick={() => setAttentionTeam(team)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 ${
                    attentionTeam === team ? 'bg-gray-900 border-gray-900 text-white' : `${cfg.chip} hover:brightness-95`
                  }`}
                >
                  <Icon size={12} />
                  {cfg.label}
                  <span className="opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {callError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{callError}</p>
        )}

        {/* Some alerts have no department and no app — low stock and late POs
            never do. They are set aside rather than filed under whatever is on
            screen, and said out loud rather than silently dropped. */}
        {filtersActive && (brief?.attention_plant_wide_hidden ?? 0) > 0 && (
          <p
            data-testid="attention-plant-wide-note"
            className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3"
          >
            {brief!.attention_plant_wide_hidden} plant-wide alert
            {brief!.attention_plant_wide_hidden === 1 ? '' : 's'}
            {(brief!.attention_plant_wide_kinds ?? []).length > 0
              ? ` (${brief!.attention_plant_wide_kinds!.join(', ')})`
              : ''}
            {' '}can't be tied to {scopeLabel || 'this filter'}, so they are not counted above.{' '}
            <button
              type="button"
              onClick={() => applyFilters({})}
              className="font-semibold text-blue-600 hover:text-blue-700 underline"
            >
              Show the whole plant
            </button>
          </p>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <SkeletonBox key={i} className="h-12 w-full" />)}
          </div>
        ) : attention.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title={filtersActive ? `All good${inScope}` : 'All good right now'}
            description={filtersActive
              ? `Nothing is behind, down or overdue${inScope}. Clear the filter to see the whole plant.`
              : 'Nothing is behind, down, short or overdue. Check back when something changes.'}
          />
        ) : (
          <div className="space-y-2">
            {attentionShown.map((item, i) => {
              // A help request is answerable right here: who is needed, where,
              // how long they have waited, and the two actions that end the wait.
              if (item.type === 'andon_call' && item.call_id) {
                const cfg = teamConfig(item.team);
                const Icon = cfg.icon;
                const busy = callActionId === item.call_id;
                return (
                  <div
                    key={item.call_id}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      item.severity === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    <span className={`flex-shrink-0 mt-0.5 ${item.severity === 'red' ? 'text-red-500' : 'text-amber-500'}`}>
                      <Icon size={15} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${cfg.chip}`}>
                          {item.target_label ?? item.team_label ?? cfg.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
                        <span className={`text-xs font-semibold tabular-nums ${item.severity === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                          {item.age_minutes ?? 0}m
                        </span>
                      </div>
                      {item.detail && <div className="text-xs text-gray-500 truncate">{item.detail}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {item.call_status === 'open' && (
                        <button
                          onClick={() => void respondToCall(item, 'ack')}
                          disabled={busy}
                          className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {busy ? '…' : 'On my way'}
                        </button>
                      )}
                      <button
                        onClick={() => void respondToCall(item, 'resolve')}
                        disabled={busy}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                      >
                        Resolve
                      </button>
                      <Link to={item.link} className="text-gray-300 hover:text-gray-500" title="Open the Andon Board">
                        <ChevronRight size={15} />
                      </Link>
                    </div>
                  </div>
                );
              }
              return (
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
                    {attentionIcon(item.type)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-semibold uppercase tracking-wide ${item.severity === 'red' ? 'text-red-600' : 'text-amber-600'}`}>
                        {attentionLabel(item.type)}
                      </span>
                      <span className="text-sm font-medium text-gray-900 truncate">{item.label}</span>
                    </div>
                    {item.detail && <div className="text-xs text-gray-500 truncate">{item.detail}</div>}
                  </div>
                  <ChevronRight size={15} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
                </Link>
              );
            })}

            {(attentionHidden > 0 || attentionExpanded) && (
              <button
                type="button"
                onClick={() => setAttentionExpanded(x => !x)}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {attentionExpanded
                  ? <>Show less <ChevronUp size={13} /></>
                  : <>{attentionHidden} more {attentionHidden === 1 ? 'item' : 'items'} <ChevronDown size={13} /></>}
              </button>
            )}
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
            <StatCard
              label="Completed Today"
              value={kpis?.completed_today ?? 0}
              delta={kpis?.vs_7day_avg_pct}
              deltaLabel={`vs 7-day avg${inScope}`}
              icon={<CheckCircle size={18} />} iconBg="bg-green-50" iconColor="text-green-600"
            />
            {/* Not "schedule adherence" (an on-time-delivery measure) — this is
                exactly what it says: how many OPEN work orders are on track today. */}
            <StatCard
              label="Open WOs On Track"
              value={kpis?.schedule_adherence != null ? `${kpis.schedule_adherence}%` : '—'}
              deltaLabel={(kpis?.work_orders_total ?? 0) > 0
                ? `${kpis?.work_orders_on_track ?? 0} of ${kpis?.work_orders_total} open work orders${inScope}`
                : `No open work orders${inScope}`}
              icon={<CalendarCheck size={18} />} iconBg="bg-teal-50" iconColor="text-teal-600"
            />
            <StatCard
              label="Pass Rate (7 days)"
              value={kpis?.pass_rate_7d != null ? `${kpis.pass_rate_7d}%` : '—'}
              deltaLabel={kpis?.pass_rate_7d != null
                ? `from QC results${inScope}`
                : `No QC results recorded${inScope}`}
              icon={<TrendingUp size={18} />} iconBg="bg-purple-50" iconColor="text-purple-600"
            />
            <StatCard
              label="Active Now"
              value={kpis?.active_now ?? 0}
              deltaLabel={`processes running${inScope}`}
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
            {filtersActive && <span className="text-[11px] text-gray-400 truncate">{scopeLabel}</span>}
            <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              View schedule <ChevronRight size={12} />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonBox key={i} className="h-14 w-full" />)}</div>
          ) : (brief?.due_soon ?? []).length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title={`Nothing due in the next two days${inScope}`}
              description={filtersActive
                ? 'Clear the filter to see what the rest of the plant owes this week.'
                : 'Scheduled work orders will show up here as their due dates approach.'}
            />
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
            <h2 className="font-semibold text-gray-900">
              Output — Last 7 Days
              {filtersActive && <span className="ml-2 text-[11px] font-normal text-gray-400">{scopeLabel}</span>}
            </h2>
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
                {filtersActive ? ` · ${scopeLabel}` : ''}
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
              <EmptyState
                icon={Building2}
                title="No plant data available"
                description="Live floor metrics will appear here once stations start reporting activity."
              />
            ) : (
              <>
                {/* KPI row — deliberately only the numbers the KPI cards above
                    DON'T already show, so the page never states the same figure twice. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    {
                      label: 'Avg Cycle (all runs)',
                      // null (not 0) when nothing in scope has finished — a dash
                      // with a reason, never a zero that reads as "instant".
                      value: (plantData.kpis.avg_cycle_time ?? 0) > 0 ? fmtDuration(plantData.kpis.avg_cycle_time!) : '—',
                      note: (plantData.kpis.avg_cycle_time ?? 0) > 0 ? null : `no completed runs${inScope}`,
                      icon: <Clock size={15} className="text-orange-600" />, bg: 'bg-orange-50',
                    },
                    {
                      label: 'Work Orders On Track',
                      value: plantData.kpis.work_orders_total > 0
                        ? `${plantData.kpis.work_orders_on_track}/${plantData.kpis.work_orders_total}`
                        : '—',
                      note: plantData.kpis.work_orders_total > 0 ? null : `no open work orders${inScope}`,
                      icon: <Package size={15} className="text-indigo-600" />, bg: 'bg-indigo-50',
                    },
                    {
                      label: 'Behind or Overdue',
                      value: plantData.active_alerts.length,
                      note: null,
                      icon: <AlertTriangle size={15} className="text-red-500" />, bg: 'bg-red-50',
                    },
                  ].map(k => (
                    <div key={k.label} className="bg-gray-50 rounded-xl p-3 flex items-center gap-2.5">
                      <div className={`w-8 h-8 ${k.bg} rounded-lg flex items-center justify-center flex-shrink-0`}>{k.icon}</div>
                      <div className="min-w-0">
                        <div className="text-base font-bold text-gray-900 leading-tight">{k.value}</div>
                        <div className="text-[11px] text-gray-500">{k.label}</div>
                        {k.note && <div className="text-[10px] text-gray-400 truncate">{k.note}</div>}
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
                        const onTrackPct = dept.total_count > 0 ? Math.round((dept.on_track_count / dept.total_count) * 100) : null;
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
                                <span>{onTrackPct === null ? 'No work orders' : `${onTrackPct}% on track`}</span>
                                <span>{dept.avg_cycle_time > 0 ? `${dept.avg_cycle_time.toFixed(1)}m avg` : 'no runs yet'}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {plantData.department_performance.length === 0 && (
                        <EmptyState
                          compact
                          className="col-span-2"
                          icon={BarChart2}
                          title={filtersActive ? `No department data${inScope}` : 'No departments set up yet'}
                          description={filtersActive
                            ? 'That department is no longer available for the selected site — clear the filter to see them all.'
                            : 'Create departments to see per-area output and schedule status here.'}
                        />
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
                {/* Kept on screen whenever a filter is active even if it is
                    empty: a section that silently vanishes leaves the manager
                    guessing whether the scope has no runs or the card is gone. */}
                {!isHidden('floor_activity') && (filtersActive || plantData.active_alerts.length > 0 || plantData.recent_completions.length > 0) && (
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
                              <tr><td colSpan={5} className="text-center py-4 text-gray-400">{`No recent completions${inScope}`}</td></tr>
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
