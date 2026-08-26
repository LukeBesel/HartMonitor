import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useSite } from '../context/SiteContext';
import {
  TrendingUp, Activity, CheckCircle,
  RefreshCw, CalendarCheck,
  BarChart2, Clock,
  AlertTriangle, CheckCircle2, ChevronRight, ChevronDown, ChevronUp, Lock, SlidersHorizontal, RotateCcw,
  Pin, Building2, Tv, ArrowRight,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
  BarChart, Bar,
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
import type { FilterOption } from '../components/shared/DashboardFilterBar';
import EmptyState from '../components/shared/EmptyState';
// The SECONDS-based formatter, shared with the App Dashboard. This file used to
// declare its own `fmtDuration(m: number)` taking MINUTES, which shadowed it —
// feeding it a seconds value rendered a seven-minute cycle as "7.5h". One
// formatter, one unit, no shadowing.
import { fmtDuration, durationBasisLabel, durationBasisNote } from '../components/apps/appModel';
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
    /** Whole minutes, so 0 for anything under 30 seconds. Do not render it. */
    avg_cycle_time: number | null;
    /** The one to render. null when nothing in scope has finished — '—', never 0. */
    avg_cycle_seconds: number | null;
    /** Which measurement the average is: per-step timers added up, or wall
     *  clock, or a mix of both across the runs behind it. Two legitimately
     *  different numbers exist for one run, so a tile showing one has to say
     *  which. Optional here only because this branch predates the field —
     *  once merged, label it with `durationBasisLabel` / `durationBasisNote`
     *  from components/apps/appModel rather than any wording written here. */
    avg_cycle_basis?: 'hands_on' | 'elapsed' | 'mixed' | null;
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
    /** Whole minutes; 0 for anything under 30 seconds. Do not render it. */
    avg_cycle_time: number;
    /** The one to render. null when this department has finished nothing. */
    avg_cycle_seconds: number | null;
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
    department: string; status: string;
    /** When this run last did something: its finish, or its start if it is
     *  still open. The column heading is "When", so this is what it shows.
     *  Optional only because this branch predates the field — `completed_at`
     *  is the fallback, and is nullable on the newer payload. */
    activity_at?: string | null;
    completed_at?: string | null;
    /** True for the rows a completions table may count as completions. */
    is_complete?: boolean;
    /** The cycle time, and null until the run finishes — never an
     *  elapsed-so-far in disguise. */
    duration_seconds: number | null;
    /** Set only while the run is open. Not a cycle time; label it "so far". */
    elapsed_so_far_seconds?: number | null;
    /** Which measurement `duration_seconds` is — see `avg_cycle_basis`. */
    duration_basis?: 'hands_on' | 'elapsed' | 'mixed' | null;
  }>;
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
// The Command Center's department / app scope — remembered per user rather than
// per browser, so two supervisors sharing the office terminal do not inherit
// each other's choice. Site is deliberately NOT offered here: the app-wide site
// switcher already owns that, and a second control for it would let the two
// disagree.
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
  const { selectedSiteId, loading: sitesLoading } = useSite();
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
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [apps, setApps] = useState<FilterOption[]>([]);
  const filtersActive = !!(filters.department_id || filters.app_id);
  const selectedDeptId = filters.department_id ?? '';

  const applyFilters = useCallback((next: DashboardFilters) => {
    setFilters(next);
    storeScope(user?.id, next);
  }, [user?.id]);

  const chooseDepartment = useCallback((id: string) => {
    const next = { ...filters };
    if (id) next.department_id = id;
    else delete next.department_id;
    applyFilters(next);
  }, [filters, applyFilters]);

  // Signing in as someone else restores THEIR scope, not the previous person's.
  const lastUserRef = useRef(user?.id);
  useEffect(() => {
    if (lastUserRef.current === user?.id) return;
    lastUserRef.current = user?.id;
    setFilters(loadStoredScope(user?.id));
  }, [user?.id]);

  // Options for the picker. Departments follow the active site, so it never
  // offers a department belonging to a plant the user isn't looking at.
  useEffect(() => {
    let cancelled = false;
    setDepartmentsLoaded(false);
    Promise.all([
      api.getDepartments(selectedSiteId ? { site_id: selectedSiteId } : undefined).catch(() => []),
      api.getApps().catch(() => []),
    ]).then(([deptList, appList]: [FilterOption[], FilterOption[]]) => {
      if (cancelled) return;
      setDepartments((deptList ?? []).map(d => ({ id: d.id, name: d.name })));
      setApps((appList ?? []).map(a => ({ id: a.id, name: a.name })));
      setDepartmentsLoaded(true);
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

  // ── Arriving from the player: /dashboard?department_id=…&app_id=…
  //
  // The run-complete screen offers "Review this run in the live report", and the
  // operator has to land on the board that already contains the run they just
  // finished — not on a picker asking them where they work.
  //
  // Two deliberate choices here. The ids are checked against the option lists
  // rather than trusted, so a deleted department (or one belonging to another
  // tenant, or to a site this user isn't looking at) quietly falls back to the
  // normal default instead of scoping every card to nothing. And the scope is
  // set with `setFilters`, NOT `applyFilters`: a link opens a view, it does not
  // rewrite what this person's Command Center remembers. Then the params are
  // consumed, so the picker — and only the picker — owns the scope from the
  // next render on, and a hand-picked department is never overridden.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDeptId = searchParams.get('department_id');
  const urlAppId = searchParams.get('app_id');
  useEffect(() => {
    if (!urlDeptId && !urlAppId) return;
    if (!departmentsLoaded) return;
    setFilters(prev => {
      const next = { ...prev };
      if (urlDeptId && departments.some(d => d.id === urlDeptId)) next.department_id = urlDeptId;
      if (urlAppId && apps.some(a => a.id === urlAppId)) next.app_id = urlAppId;
      return next;
    });
    const rest = new URLSearchParams(searchParams);
    rest.delete('department_id');
    rest.delete('app_id');
    setSearchParams(rest, { replace: true });
  }, [urlDeptId, urlAppId, departmentsLoaded, departments, apps, searchParams, setSearchParams]);

  // A one-department shop should not be made to pick from a list of one. The
  // moment we know there is exactly one, it becomes the page — and the picker
  // below hides itself, because a dropdown with a single choice is furniture.
  // Held back while a link is still carrying its own scope, so the two never
  // race to set the department on the same render.
  useEffect(() => {
    if (!departmentsLoaded || filters.department_id) return;
    if (urlDeptId || urlAppId) return;
    if (departments.length !== 1) return;
    applyFilters({ ...filters, department_id: departments[0].id });
  }, [departmentsLoaded, departments, filters, applyFilters, urlDeptId, urlAppId]);

  const selectedDept = departments.find(d => d.id === selectedDeptId);

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

  // Plant view data — the live half of the department board.
  const [plantData, setPlantData] = useState<PlantViewData | null>(null);
  const [plantLoading, setPlantLoading] = useState(true);
  // One output chart with two ranges instead of two charts side by side. The
  // history is the point of the product, so it is one click away, not gone.
  const [outputRange, setOutputRange] = useState<'day' | 'week'>('day');
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
    // The site selection belongs to the brief too. Without it the attention list
    // and the KPI tiles were plant-wide while the department board directly
    // below them was scoped to one site — a manager at a two-site company was
    // reading the other site's late work orders next to this site's numbers.
    //
    // Only the brief is fetched here. The company name comes from the branding
    // context now; re-reading /api/config on every poll tick to fill in a header
    // subtitle was one of the duplicate requests that made a page load cost ~28
    // calls and put a whole factory behind one rate-limit bucket.
    try {
      setBrief(await api.getDailyBrief({ ...filters, site_id: selectedSiteId || undefined }));
    } catch {
      // keep whatever is on screen; the page surfaces its own load errors
    }
    setLoading(false);
  }, [filters, selectedSiteId]);

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
  // Both loaders wait for the site context. Firing before it resolves cost a
  // wasted round trip per page load — the brief was fetched once unscoped and
  // again a few milliseconds later with ?site_id= — and the first answer was
  // for the wrong scope, so for a moment the screen showed plant-wide numbers
  // under a site-scoped heading.
  const scopeReady = !sitesLoading;
  const briefRefresh = useAutoRefresh(loadData, 60_000, { enabled: scopeReady, immediate: scopeReady });
  const plantRefresh = useAutoRefresh(loadPlantData, 30_000, { enabled: scopeReady, immediate: scopeReady });
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

  const deptCards = plantData?.department_performance ?? [];
  // Pinned first — a plant with a dozen areas wants its two on top.
  const orderedDeptCards = [
    ...deptCards.filter(d => pinnedStations.includes(d.id || d.department)),
    ...deptCards.filter(d => !pinnedStations.includes(d.id || d.department)),
  ];
  const behindCount = plantData?.active_alerts.length ?? 0;
  const recentRuns = plantData?.recent_completions ?? [];
  // Both series only carry the periods that had a completion, so an empty array
  // means "nothing finished in that window" rather than "not loaded yet".
  const outputSeriesEmpty = outputRange === 'day'
    ? (plantData?.hourly_throughput ?? []).length === 0
    : (brief?.throughput_7d ?? []).length === 0;

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* One tour only: when the setup wizard shows, it permanently absorbs the
          dashboard walkthrough so new users never get two popups in a row. */}
      <OnboardingWizard onWillShow={() => markWalkthroughSeen('dashboard')} />
      <ModuleOnboarding
        moduleId="dashboard"
        title="Welcome to your MES"
        description="This is your command center. Anything that needs you today sits at the top; below it you pick a department and watch it run — what finished, how long each run took, and what is due next."
        steps={[
          'Check what needs attention today',
          'Pick the department you are running',
          'Watch runs land live, with the time each one took',
          'Open the full department view for stations and OEE',
        ]}
        icon={LayoutDashboard}
        color="#3b82f6"
        overviewTitle="What's inside your MES"
        overview={[
          { icon: LayoutDashboard, label: 'Command Center', desc: "Your home base — what needs attention, then the department you're running." },
          { icon: Tablet,          label: 'Operator Portal', desc: 'The shop-floor screen operators use to pick a job and start working.' },
          { icon: AppWindow,       label: 'App Library & Builder', desc: 'Build drag-and-drop digital work instructions, then publish them.' },
          { icon: Building2,       label: 'Departments & Stations', desc: 'Define work centers and watch live status across the floor.' },
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

      {/* ── Needs attention — pinned above everything else ─────────────────────
          This is the only block on the page that can change somebody's plan
          today, so it never moves below the fold and never sits behind a
          collapsed panel. */}
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
          {filtersActive && (
            <span className="text-[11px] text-gray-500 truncate">{scopeLabel}</span>
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
              ? `Nothing is behind, down or overdue${inScope}. Clear the department to see the whole plant.`
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

      {/* ── Which department am I running? ────────────────────────────────────
          The scope control for the whole page. A shop with one department never
          sees it — nobody should have to choose from a list of one — and a shop
          with none gets told how to make one instead of a dead dropdown. */}
      {departments.length > 1 && (
        <div className="card p-4 sm:p-5" data-testid="department-picker">
          <div className="flex flex-wrap items-end gap-3">
            {/* The two scope questions are one question — which slice of the
                plant am I looking at — so they read left to right on one line
                and shrink together. The row holds a floor of 16rem: below that
                the buttons beside it wrap away rather than squeezing the
                selects into something nobody can read a department name in. */}
            <div className="flex items-end gap-3 flex-1 min-w-[16rem]" data-testid="scope-selects">
              {/* Three parts to two: a department name is longer than "All
                  apps", and an even split truncated the placeholder on a
                  phone. */}
              <label className="flex-[3] min-w-0 sm:flex-none sm:w-64">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                  <Building2 size={12} /> Department
                </span>
                <select
                  aria-label="Department"
                  className="input-field w-full text-sm"
                  value={selectedDeptId}
                  onChange={e => chooseDepartment(e.target.value)}
                >
                  <option value="">{selectedDeptId ? 'All departments' : 'Pick a department'}</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>

              {apps.length > 0 && (
                <label className="flex-[2] min-w-0 sm:flex-none sm:w-56">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">App</span>
                  <select
                    aria-label="App"
                    className="input-field w-full text-sm"
                    value={filters.app_id ?? ''}
                    onChange={e => {
                      const next = { ...filters };
                      if (e.target.value) next.app_id = e.target.value; else delete next.app_id;
                      applyFilters(next);
                    }}
                  >
                    <option value="">All apps</option>
                    {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              )}
            </div>

            {selectedDeptId && (
              <div className="flex items-center gap-2 sm:ml-auto">
                <Link
                  to={`/departments/${selectedDeptId}`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm"
                  title="Stations, live OEE and quality for this department"
                >
                  <BarChart2 size={14} /> <span className="hidden sm:inline">Full view</span>
                </Link>
                <Link
                  to={`/departments/${selectedDeptId}/tv`}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 shadow-sm"
                  title="Open full-screen TV mode for this department"
                >
                  <Tv size={14} /> <span className="hidden sm:inline">TV</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── No department chosen: the plant, as a set of doors ────────────────
          A grid of departments is the whole screen until one is picked. It is
          both the answer to "how is the plant doing" and the way in. */}
      {!selectedDeptId && (
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="font-semibold text-gray-900">
              {departments.length > 0 ? 'Pick a department' : 'Departments'}
            </h2>
            <Link to="/departments" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
              Jobs by department <ChevronRight size={12} />
            </Link>
          </div>

          {/* The plant in one line rather than a wall of tiles. Every figure is
              the same scoped number the department board would show. */}
          {plantData && deptCards.length > 0 && (
            <p className="text-xs text-gray-500 mb-4">
              {deptCards.length} department{deptCards.length === 1 ? '' : 's'}
              {' · '}{plantData.kpis.total_completed_today} finished today
              {' · '}{plantData.kpis.active_now} running now
              {' · '}
              {plantData.kpis.avg_cycle_seconds != null
                ? `${fmtDuration(plantData.kpis.avg_cycle_seconds)} average cycle`
                : '— average cycle, no completed runs yet'}
            </p>
          )}

          {plantLoading && deptCards.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => <SkeletonBox key={i} className="h-28 w-full" />)}
            </div>
          ) : deptCards.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No departments yet"
              description="A department is an area of the floor — Assembly, Paint, Packaging. Create one and every run your apps capture gets grouped under it."
              action={isAtLeast('manager')
                ? <Link to="/settings?tab=sites" className="btn-primary">Create a department</Link>
                : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {orderedDeptCards.map(dept => {
                const key = dept.id || dept.department;
                const isPinned = pinnedStations.includes(key);
                const onTrackPct = dept.total_count > 0 ? Math.round((dept.on_track_count / dept.total_count) * 100) : null;
                return (
                  <div
                    key={key}
                    className={`relative bg-white rounded-xl border border-gray-200 border-l-4 ${deptBorderColor(dept.status)} ${isPinned ? 'ring-2 ring-blue-300' : ''} hover:shadow-md transition-shadow`}
                  >
                    <button
                      type="button"
                      onClick={() => dept.id && chooseDepartment(dept.id)}
                      className="w-full text-left p-3.5 pr-10"
                    >
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm truncate">{dept.department}</span>
                        <StatusPill status={dept.status} />
                      </div>
                      <div className="flex items-end gap-5">
                        <div className="min-w-0">
                          <div className="text-2xl font-bold text-gray-900 leading-none tabular-nums">{dept.completion_count}</div>
                          <div className="text-[11px] text-gray-500 mt-1">finished today</div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-2xl font-bold text-gray-900 leading-none tabular-nums">
                            {dept.avg_cycle_seconds != null ? fmtDuration(dept.avg_cycle_seconds) : '—'}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-1">
                            {dept.avg_cycle_seconds != null ? 'average cycle' : 'no runs yet'}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-400 mt-2.5">
                        {onTrackPct === null ? 'No work orders assigned' : `${onTrackPct}% of work orders on track`}
                      </div>
                    </button>
                    {isAtLeast('manager') && (
                      <button
                        type="button"
                        onClick={() => togglePin(key)}
                        title={isPinned ? 'Unpin' : 'Pin this department'}
                        className={`absolute top-2.5 right-2.5 p-1 rounded-lg transition-colors ${isPinned ? 'text-blue-500 bg-blue-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'}`}
                      >
                        <Pin size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── The chosen department, live ───────────────────────────────────────── */}
      {selectedDeptId && (
        <>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-lg font-bold text-gray-900">{selectedDept?.name ?? 'Department'}</h2>
            <span className="text-xs text-gray-500">
              today so far{filters.app_id ? ` · ${apps.find(a => a.id === filters.app_id)?.name}` : ''}
            </span>
          </div>

          {!isHidden('kpis') && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {loading ? (
              [1, 2, 3, 4].map(i => <SkeletonBox key={i} className="h-24 w-full" />)
            ) : (
              <>
                <StatCard
                  label="Finished today"
                  value={kpis?.completed_today ?? 0}
                  delta={kpis?.vs_7day_avg_pct}
                  deltaLabel="vs 7-day avg"
                  icon={<CheckCircle size={18} />} iconBg="bg-green-50" iconColor="text-green-600"
                />
                <StatCard
                  label="Running now"
                  value={kpis?.active_now ?? 0}
                  deltaLabel="operators mid-run"
                  icon={<Activity size={18} />} iconBg="bg-blue-50" iconColor="text-blue-600"
                  pulse={(kpis?.active_now ?? 0) > 0}
                />
                {/* The product's whole point, so it is a headline and not a
                    footnote. Seconds in, seconds out — never a rounded 0m.
                    The value never wraps: "6m 36s" broken across two lines on a
                    phone reads as two numbers. The department is named in the
                    heading directly above, so only the DASH spends words
                    repeating it — that one has to say why it is a dash.
                    `kpis.avg_cycle_basis` names whether this is hands-on time
                    or wall clock, via the one shared vocabulary in
                    components/apps/appModel. */}
                <StatCard
                  label="Average cycle time"
                  value={<span className="whitespace-nowrap" title={durationBasisNote(plantData?.kpis.avg_cycle_basis)}>
                    {plantData?.kpis.avg_cycle_seconds != null ? fmtDuration(plantData.kpis.avg_cycle_seconds) : '—'}
                  </span>}
                  deltaLabel={plantData?.kpis.avg_cycle_seconds != null
                    ? `across every recorded run${durationBasisLabel(plantData.kpis.avg_cycle_basis) ? ` · ${durationBasisLabel(plantData.kpis.avg_cycle_basis)}` : ''}`
                    : `no completed runs${inScope}`}
                  icon={<Clock size={18} />} iconBg="bg-orange-50" iconColor="text-orange-600"
                />
                <StatCard
                  label="Pass rate (7 days)"
                  value={kpis?.pass_rate_7d != null ? `${kpis.pass_rate_7d}%` : '—'}
                  deltaLabel={kpis?.pass_rate_7d != null
                    ? `from QC results${inScope}`
                    : `No QC results recorded${inScope}`}
                  icon={<TrendingUp size={18} />} iconBg="bg-purple-50" iconColor="text-purple-600"
                />
              </>
            )}
          </div>
          )}

          {/* Latest runs — the cycle times as they are captured, one row per
              run. This used to sit at the very bottom of a collapsible panel;
              it is the thing the product exists to produce. */}
          {!isHidden('floor_activity') && (
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">Latest runs</h2>
                <p className="text-[11px] text-gray-500">What each one took, as your apps record it</p>
              </div>
              <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Cycle-time history <ArrowRight size={12} />
              </Link>
            </div>
            {plantLoading && recentRuns.length === 0 ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonBox key={i} className="h-9 w-full" />)}</div>
            ) : recentRuns.length === 0 ? (
              <EmptyState
                compact
                icon={Clock}
                title={`No runs recorded yet${inScope}`}
                description="As soon as an operator finishes an app on the floor, the run and the time it took land here."
              />
            ) : (
              /* Three columns, not four: app and operator share a cell so the
                 row fits a 390px phone without a sideways scroll. Splitting
                 them was what pushed the time taken — the whole point of the
                 row — off the right-hand edge. */
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-[11px] font-medium text-gray-400 pb-1.5 pr-3">Run</th>
                      <th className="text-right text-[11px] font-medium text-gray-400 pb-1.5 pr-6 whitespace-nowrap">Time taken</th>
                      <th className="text-right text-[11px] font-medium text-gray-400 pb-1.5 whitespace-nowrap">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {recentRuns.slice(0, 8).map(c => {
                      // Three states, three honest readings.
                      //
                      // A finished run has a cycle time. A run still on the
                      // bench has an elapsed-so-far, which is a different
                      // measurement and is labelled as one — "6m" unqualified
                      // would fold a job that has not finished into the
                      // reader's sense of what a cycle costs. An abandoned run
                      // has neither: nothing ever stamped it finished, so any
                      // figure measured against the clock grows forever, and
                      // the only true thing to print is a dash.
                      const running = c.status === 'in_progress';
                      const finished = c.is_complete ?? c.status === 'completed';
                      // A zero here is not a run that took no time — it is a
                      // run shorter than the reported figure can resolve. Still
                      // a dash, never "0s".
                      const took = finished
                        ? (c.duration_seconds || null)
                        : running
                          // The newer payload keeps the two apart; the older one
                          // put the elapsed-so-far in duration_seconds.
                          ? (c.elapsed_so_far_seconds ?? c.duration_seconds) || null
                          : null;
                      const when = c.activity_at ?? c.completed_at;
                      return (
                        <tr key={c.id} className="hover:bg-gray-50 transition-colors align-top">
                          <td className="py-2 pr-3 max-w-0 w-full">
                            <span className="font-medium text-gray-900 truncate block">{c.app_name}</span>
                            <span className="text-[11px] text-gray-400 truncate block">
                              {c.operator_name}
                              {!finished && (
                                <span className={`ml-1.5 font-semibold uppercase tracking-wide ${running ? 'text-blue-600' : 'text-gray-400'}`}>
                                  {running ? 'running' : c.status}
                                </span>
                              )}
                            </span>
                          </td>
                          {/* The tooltip names which measurement this is —
                              hands-on vs wall clock — via the one shared
                              vocabulary in components/apps/appModel. */}
                          <td
                            className="py-2 pr-6 text-right font-medium text-gray-700 tabular-nums whitespace-nowrap"
                            title={took === null && finished
                              ? 'This run finished faster than the reported time can resolve'
                              : durationBasisNote(c.duration_basis)}
                          >
                            {took !== null ? `${fmtDuration(took)}${running ? ' so far' : ''}` : '—'}
                          </td>
                          <td className="py-2 text-right text-gray-400 whitespace-nowrap">
                            {when ? fmtAgo(when) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* Output — one chart, two ranges. Today's shape and the week's trend
              were two separate cards competing for the same glance. */}
          {!isHidden('output') && (
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <h2 className="font-semibold text-gray-900">Output</h2>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  {([['day', 'Last 24 hours'], ['week', 'Last 7 days']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setOutputRange(id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                        outputRange === id ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  Reports <ChevronRight size={12} />
                </Link>
              </div>
            </div>
            {loading || plantLoading ? (
              <SkeletonBox className="h-52 w-full" />
            ) : outputSeriesEmpty ? (
              // Recharts draws nothing at all for an empty series — not even
              // axes — which reads as a broken card rather than a quiet day.
              <EmptyState
                compact
                icon={BarChart2}
                title={outputRange === 'day'
                  ? `No runs finished in the last 24 hours${inScope}`
                  : `No runs finished in the last 7 days${inScope}`}
                description="Every completed run is counted here the moment an operator finishes it."
              />
            ) : outputRange === 'day' ? (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={plantData?.hourly_throughput ?? []} barSize={12} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickFormatter={h => h.slice(11, 16)} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip labelFormatter={l => `${l}`} formatter={(v: any) => [v, 'Runs finished']} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
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
                    formatter={(v: any) => [v, 'Runs finished']}
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

          {/* Due soon. The schedule health that used to need its own tile and
              its own alert list now rides in this card's header — the numbers
              are the same, and /schedule holds the detail behind them. */}
          {!isHidden('due_soon') && (
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900">Due in the next 48 hours</h2>
                <p className="text-[11px] text-gray-500">
                  {(kpis?.work_orders_total ?? 0) > 0
                    ? `${kpis?.work_orders_on_track ?? 0} of ${kpis?.work_orders_total} open work orders on track${inScope}`
                    : `No open work orders${inScope}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {behindCount > 0 && (
                  <Link
                    to="/schedule"
                    className="text-[11px] font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full hover:bg-red-200 transition-colors"
                  >
                    {behindCount} behind or overdue
                  </Link>
                )}
                <Link to="/schedule" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                  Schedule <ChevronRight size={12} />
                </Link>
              </div>
            </div>
            {loading ? (
              <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonBox key={i} className="h-14 w-full" />)}</div>
            ) : (brief?.due_soon ?? []).length === 0 ? (
              <EmptyState
                compact
                icon={CalendarCheck}
                title={`Nothing due in the next two days${inScope}`}
                description="Scheduled work orders show up here as their due dates approach."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {brief!.due_soon.map(wo => (
                  <div key={wo.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-xs text-gray-900 truncate">{wo.work_order_number}</span>
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
        </>
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
