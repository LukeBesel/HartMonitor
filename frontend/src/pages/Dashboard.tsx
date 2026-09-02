import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import {
  getFloorSnapshot, getFloorDepartments, getWipSummary, type WipSummary,
} from '../api/floor';
import WipSearch from '../components/shared/WipSearch';
import type { FloorSnapshot, DepartmentSnapshot } from '../api/floor';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { useSite } from '../context/SiteContext';
import {
  TrendingUp, Activity, CheckCircle,
  RefreshCw, CalendarCheck,
  BarChart2, Clock,
  AlertTriangle, CheckCircle2, ChevronRight, ChevronDown, ChevronUp, Lock,
  Building2, Tv, ArrowRight, CalendarClock,
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
import { onTrackSentence } from '../utils/floorWording';
import { displayId, hasCompanyTag } from '../utils/ids';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
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
import { fmtDuration, durationBasisLabel, durationBasisNote, elapsedSeconds } from '../components/apps/appModel';
import {
  LayoutDashboard, Tablet, AppWindow, CalendarRange,
  GitBranch, ShieldCheck, Bell, Database, Sparkles,
} from 'lucide-react';

// ─── What this screen is ──────────────────────────────────────────────────────
//
// The one live-floor screen. It answers "what is the floor doing right now" for
// the WHOLE PLANT the moment it opens — nothing selected, nothing to pick — and
// a department (or an app) is a filter that narrows the same tiles, the same
// lists and the same words.
//
// Every headline number comes from GET /api/floor/snapshot through api/floor.ts:
// finished today, running now, average cycle, pass rate and the on-track share
// are defined once, server-side, against the PLANT's calendar day. Nothing here
// counts completions by date for itself — that is how four screens ended up
// disagreeing at the same minute — and a number nobody measured renders as '—'
// beside the reason the payload gives, never as a 0.

// ─── Floor lists ─────────────────────────────────────────────────────────────
// The snapshot answers the numbers; these two lists are the rows behind them.

interface PlantViewData {
  hourly_throughput: Array<{ hour: string; count: number }>;
  active_alerts: Array<{
    id: string; work_order_number: string; part_name: string;
    department: string; status: 'behind' | 'overdue';
    scheduled_end: string; completion_pct: number;
  }>;
  recent_completions: Array<{
    id: string; app_name: string; operator_name: string;
    department: string; status: string;
    /** When this run last did something: its finish, or its start if it is
     *  still open. The column heading is "When", so this is what it shows. */
    activity_at?: string | null;
    completed_at?: string | null;
    /** When the run started. What a live elapsed counts from. */
    started_at?: string | null;
    /** True for the rows a completions table may count as completions. */
    is_complete?: boolean;
    /** The cycle time, and null until the run finishes — never an
     *  elapsed-so-far in disguise. */
    duration_seconds: number | null;
    /** Set only while the run is open. Not a cycle time; label it "so far". */
    elapsed_so_far_seconds?: number | null;
    /** Which measurement `duration_seconds` is: step timers, or wall clock. */
    duration_basis?: 'hands_on' | 'elapsed' | 'mixed' | null;
  }>;
}

/**
 * The PLANT's calendar date for one of the floor list's hour buckets.
 *
 * The buckets arrive as UTC stamps ("2026-09-02T13:00:00", no zone marker), so
 * they are parsed as UTC and re-read in the plant's own zone — the zone the
 * snapshot names, never the browser's. A tablet in another timezone must file a
 * run under the same day the tiles above the chart counted it in.
 */
function plantDateOf(hourUtc: string, timezone: string): string {
  const at = new Date(`${hourUtc}Z`);
  if (isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The same bucket as a clock reading at the plant — "13:00". */
function plantHourLabel(hourUtc: string, timezone: string): string {
  const at = new Date(`${hourUtc}Z`);
  if (isNaN(at.getTime())) return hourUtc.slice(11, 16);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** The ranges the Output card offers, in the order they are read. */
const OUTPUT_RANGES = [
  ['today', 'Today'],
  ['day', 'Last 24 hours'],
  ['week', 'Last 7 days'],
] as const;

type OutputRange = (typeof OUTPUT_RANGES)[number][0];

function fmtAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** A department's colour band, from the counts the snapshot already reports. */
function deptStatus(dept: DepartmentSnapshot): 'on_track' | 'at_risk' | 'behind' | 'idle' {
  if (dept.open_work_orders <= 0) return 'idle';
  if (dept.behind + dept.overdue > 0) return 'behind';
  if (dept.at_risk > 0) return 'at_risk';
  return 'on_track';
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

/** Seconds a still-open run has been running, ticking once a second — the
 *  one thing the retired third floor screen did that nothing else did. */
function useLiveElapsed(startedAt: string | null | undefined, fallback: number | null | undefined) {
  const [seconds, setSeconds] = useState<number | null>(() => elapsedSeconds(startedAt) ?? fallback ?? null);
  useEffect(() => {
    // elapsedSeconds parses SQLite's "YYYY-MM-DD HH:MM:SS" as UTC
    // (parseServerTime); `new Date(...)` would read the same string as LOCAL
    // time, and a plant west of UTC would watch every live run count from zero.
    const tick = () => setSeconds(elapsedSeconds(startedAt) ?? fallback ?? null);
    tick();
    if (!startedAt) return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt, fallback]);
  return seconds;
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

// ─── Page ─────────────────────────────────────────────────────────────────────

/** "1 call" / "3 calls". A bare "1 calls" on the plant's home screen is the
 *  first thing a visitor notices and the last thing they forget. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function Dashboard() {
  const { user, isAtLeast } = useAuth();
  const { selectedSiteId, loading: sitesLoading } = useSite();
  const [brief, setBrief] = useState<ScopedBrief | null>(null);
  // The header subtitle used to re-fetch the whole company settings bag on every
  // poll tick just to read one name off it. The branding provider already has it.
  const { companyName } = useBranding();
  const [loading, setLoading] = useState(true);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');

  // ── Page scope: department + app, and it lives in the URL ──────────────────
  //
  // Not in this component's private state. A scoped Command Center has to be a
  // link somebody can send ("look at Welding"), Back has to walk back through
  // the scopes a supervisor just looked at, and the player's "Review this run"
  // already arrives as one. localStorage is the DEFAULT for somebody who
  // arrives with no scope in the URL — not the record of where they are.
  const [searchParams, setSearchParams] = useSearchParams();
  const [departments, setDepartments] = useState<FilterOption[]>([]);
  const [departmentsLoaded, setDepartmentsLoaded] = useState(false);
  const [apps, setApps] = useState<FilterOption[]>([]);

  // The scope this page opens with: what the URL carries, or — when it carries
  // nothing — the scope this person left behind last time. Resolved on the very
  // FIRST render, so the first request already goes out scoped and the page
  // never flashes plant-wide numbers it is about to replace. (The URL cannot be
  // written during mount: the router subscribes to history in ITS layout
  // effect, which runs after this component's, so a push from here would be
  // made to nobody. It is written in an effect below instead, and until then
  // this value stands in for it.)
  const initialStored = useRef<DashboardFilters | null>(null);
  if (initialStored.current === null) {
    initialStored.current = (searchParams.get('department_id') || searchParams.get('app_id'))
      ? {}
      : loadStoredScope(user?.id);
  }
  const [scopeSeeded, setScopeSeeded] = useState(() => Object.keys(initialStored.current!).length === 0);

  // Keyed on the two STRINGS, not on the params object, so `filters` keeps one
  // identity across the render where the URL catches up with the remembered
  // scope — otherwise every loader would refetch the answer it already has.
  const deptParam = searchParams.get('department_id')
    ?? (scopeSeeded ? null : initialStored.current!.department_id ?? null);
  const appParam = searchParams.get('app_id')
    ?? (scopeSeeded ? null : initialStored.current!.app_id ?? null);

  const filters = useMemo<DashboardFilters>(() => {
    const out: DashboardFilters = {};
    if (deptParam) out.department_id = deptParam;
    if (appParam) out.app_id = appParam;
    return out;
  }, [deptParam, appParam]);
  const filtersActive = !!(filters.department_id || filters.app_id);
  const selectedDeptId = filters.department_id ?? '';

  /**
   * Write a scope.
   *
   * A scope the user CHOSE pushes a history entry, so Back returns them to what
   * they were looking at a moment ago. `replace` is for the corrections they did
   * not ask for — seeding their remembered scope on arrival, dropping an id that
   * no longer exists — which must not leave an entry to walk back into.
   * `remember: false` goes with those: a link, or a repair, is not this person's
   * new default.
   */
  const applyFilters = useCallback((next: DashboardFilters, opts?: { replace?: boolean; remember?: boolean }) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next.department_id) params.set('department_id', next.department_id);
      else params.delete('department_id');
      if (next.app_id) params.set('app_id', next.app_id);
      else params.delete('app_id');
      return params;
    }, { replace: opts?.replace ?? false });
    if (opts?.remember !== false) storeScope(user?.id, next);
  }, [setSearchParams, user?.id]);

  // …and now that the router is listening, the remembered scope becomes the URL
  // — replacing the entry, because the person did not ask to go anywhere.
  useEffect(() => {
    if (scopeSeeded) return;
    applyFilters(initialStored.current!, { replace: true, remember: false });
    setScopeSeeded(true);
  }, [scopeSeeded, applyFilters]);

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
    applyFilters(loadStoredScope(user?.id), { replace: true, remember: false });
  }, [user?.id, applyFilters]);

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
    // A repair, not a choice: it replaces the entry rather than adding one, and
    // it DOES forget the stored id, which is now known to be gone.
    if (changed) applyFilters(next, { replace: true });
  }, [departments, apps, filters, applyFilters]);

  // Arriving from the player — /dashboard?department_id=…&app_id=… — needs no
  // code of its own any more: the URL IS the scope, so the link simply opens the
  // view it names. The effect above is what keeps an id that means nothing here
  // (deleted, another tenant's, another site's) from scoping every tile to
  // nothing; it falls back to the whole plant instead.

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

  // ── The floor, as the plant itself defines it ───────────────────────────────
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [deptRows, setDeptRows] = useState<DepartmentSnapshot[]>([]);
  const [plantData, setPlantData] = useState<PlantViewData | null>(null);
  /** Work in progress by operation, per department. Null until the first read
   *  lands — the strip says so rather than drawing an empty rail. */
  const [wip, setWip] = useState<WipSummary | null>(null);
  const [floorLoading, setFloorLoading] = useState(true);
  // One output chart, three ranges. It opens on the PLANT'S day — the same day
  // the tiles above it count — because "4 finished today" sitting above a chart
  // summing to 8, both labelled runs finished, is two answers to one question.
  // The other two ranges are a click away and say what they are.
  const [outputRange, setOutputRange] = useState<OutputRange>('today');

  // Both loaders take the page scope, so a filter change re-fetches EVERY
  // section rather than narrowing one card and leaving the rest plant-wide. A
  // new `filters` object changes these callbacks' identity, which is what makes
  // useAutoRefresh refetch immediately.
  const loadData = useCallback(async () => {
    // The site selection belongs to the brief too. Without it the attention list
    // would be plant-wide while the tiles directly above it were scoped to one
    // site — a manager at a two-site company reading the other site's late work
    // orders next to this site's numbers.
    try {
      setBrief(await api.getDailyBrief({ ...filters, site_id: selectedSiteId || undefined }));
    } catch {
      // keep whatever is on screen; the page surfaces its own load errors
    }
    setLoading(false);
  }, [filters, selectedSiteId]);

  const loadFloor = useCallback(async () => {
    const scope = { ...filters, site_id: selectedSiteId || undefined };
    const [snap, depts, plant, wip] = await Promise.all([
      getFloorSnapshot(scope).catch(() => null),
      getFloorDepartments(selectedSiteId ? { site_id: selectedSiteId } : undefined).catch(() => null),
      api.getPlantView(scope).catch(() => null),
      // Work in progress BY OPERATION — how much is running and how much is
      // waiting in each department. Best-effort like its siblings, and started
      // inside a promise so that a synchronous throw cannot take the four
      // parallel reads down with it: this page's tiles must render even when
      // one of its reads is unavailable.
      Promise.resolve().then(() => getWipSummary({
        site_id: selectedSiteId || undefined,
        department_id: filters.department_id || undefined,
      })).catch(() => null),
    ]);
    if (snap) setSnapshot(snap);
    if (depts) setDeptRows(depts.departments ?? []);
    if (plant) setPlantData(plant);
    if (wip) setWip(wip);
    setFloorLoading(false);
  }, [filters, selectedSiteId]);

  // Live data: the brief moves slowly (60s), the floor moves fast (30s). Both
  // pause while the tab is hidden and catch up the moment it comes back, and
  // both wait for the site context — firing before it resolves cost a wasted
  // round trip per page load and put plant-wide numbers under a site-scoped
  // heading for a moment.
  const scopeReady = !sitesLoading;
  const briefRefresh = useAutoRefresh(loadData, 60_000, { enabled: scopeReady, immediate: scopeReady });
  const floorRefresh = useAutoRefresh(loadFloor, 30_000, { enabled: scopeReady, immediate: scopeReady });
  const refreshAll = () => { void briefRefresh.refresh(); void floorRefresh.refresh(); };

  // A call raised on any tablet appears here at once — the 60s poll
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

  const allAttention = brief?.attention ?? [];

  // Calls can be filtered to one team — a maintenance lead wants their
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

  // A brand-new company: nothing has ever been scheduled, run, or flagged.
  // The CTA disappears the moment sample data (which creates work orders) loads.
  // Never shown while a filter is on — an empty DEPARTMENT is not an empty
  // company, and "build your first app" would be a lie on a running plant.
  const isEmptyCompany = !loading && !floorLoading && !!snapshot && !filtersActive
    && snapshot.total_work_orders === 0
    && snapshot.finished_today === 0
    && snapshot.running_now === 0
    && attention.length === 0;

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      await Promise.all([briefRefresh.refresh(), floorRefresh.refresh()]);
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  const behindCount = plantData?.active_alerts.length ?? 0;
  const recentRuns = plantData?.recent_completions ?? [];

  /** The hourly buckets, each carrying the plant day and the plant hour it
   *  belongs to, so the chart can be cut and labelled by the plant's clock. */
  const hourlySeries = useMemo(() => {
    const zone = snapshot?.timezone || 'UTC';
    return (plantData?.hourly_throughput ?? []).map(h => ({
      ...h,
      label: plantHourLabel(h.hour, zone),
      plant_date: plantDateOf(h.hour, zone),
    }));
  }, [plantData, snapshot?.timezone]);

  /** Today = the plant's day, so this series totals exactly what the
   *  Finished-today tile says. The 24-hour series answers a different question
   *  (at 09:00 it still holds last night) and is labelled as one. */
  const todaySeries = useMemo(
    () => (snapshot?.plant_date ? hourlySeries.filter(h => h.plant_date === snapshot.plant_date) : hourlySeries),
    [hourlySeries, snapshot?.plant_date],
  );

  const outputSeries: { count: number }[] = outputRange === 'today'
    ? todaySeries
    : outputRange === 'day'
      ? hourlySeries
      : (brief?.throughput_7d ?? []);
  // Every series only carries the periods that had a completion, so an empty
  // array means "nothing finished in that window", not "not loaded yet".
  const outputSeriesEmpty = outputSeries.length === 0;
  const outputTotal = outputSeries.reduce((n, row) => n + (row.count ?? 0), 0);
  const outputRangeLabel = (OUTPUT_RANGES.find(([id]) => id === outputRange)?.[1] ?? '').toLowerCase();

  /** The heading over the tiles: the plant, or the slice of it being read. */
  const scopeHeading = selectedDept?.name ?? 'The whole plant';
  const onTrack = onTrackSentence(snapshot);

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-fade-in">
      {/* One tour only: when the setup wizard shows, it permanently absorbs the
          dashboard walkthrough so new users never get two popups in a row. */}
      <OnboardingWizard onWillShow={() => markWalkthroughSeen('dashboard')} />
      <ModuleOnboarding
        moduleId="dashboard"
        title="Welcome to your MES"
        description="This is your command center. Anything that needs you today sits at the top; under it the whole plant — what finished, what is running, how long a run takes and what is due next. Pick a department to narrow the same numbers."
        steps={[
          'Check what needs attention today',
          'Read the plant: finished, running, cycle time, pass rate, on track',
          'Narrow to one department or app when you need to',
          'Open a department for its stations and wall board',
        ]}
        icon={LayoutDashboard}
        color="#3b82f6"
        overviewTitle="What's inside your MES"
        overview={[
          { icon: LayoutDashboard, label: 'Command Center', desc: 'Your home base — what needs attention, then the whole plant, live.' },
          { icon: Tablet,          label: 'Operator Portal', desc: 'The shop-floor screen operators use to pick a job and start working.' },
          { icon: AppWindow,       label: 'App Library & Builder', desc: 'Build drag-and-drop digital work instructions, then publish them.' },
          { icon: Building2,       label: 'Departments & Stations', desc: 'Define stations and watch live status across the floor.' },
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
          <LastRefreshed
            at={floorRefresh.lastRefreshed}
            refreshing={briefRefresh.refreshing || floorRefresh.refreshing}
            onRefresh={refreshAll}
          />
        }
      />

      {/* First-run empty state — offer to populate a realistic starter dataset */}
      {isEmptyCompany && (
        <div className="rounded-2xl border border-pink-200 bg-gradient-to-br from-pink-50 via-white to-indigo-50 p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
              <Sparkles size={26} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-gray-900">Your company is set up — build your first app</h2>
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
      <div className="card p-5" data-tour="attention">
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
              {plural(openCallCount, 'call')} waiting
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
              // A call is answerable right here: who is needed, where,
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
                        {/* A composite label the server wrote — an id, a
                            separator and a sentence. Printed as it came. */}
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

      {/* ── Narrow it, if you want to ──────────────────────────────────────────
          A filter, not a gate: the numbers below are the whole plant's until
          somebody chooses otherwise. The two scope questions are one question —
          which slice am I looking at — so they read left to right on one row
          and shrink together. */}
      {/* The card is here whatever the company has in it. A tour step, and a
          manager's eye, both need somewhere stable to land: on a brand-new
          company with no departments and no apps this says what would make
          filtering possible instead of vanishing. */}
      <div className="card p-4 sm:p-5" data-testid="department-picker" data-tour="filters">
        {/* "Where is WO-1042?" — the same box, and the same server-written
            sentence, the Schedule carries. It sits with the scope controls
            because it is the other question a manager arrives with, and it
            answers without narrowing anything on the page. */}
        <div className="mb-4 pb-4 border-b border-gray-100">
          <WipSearch className="max-w-xl" data-testid="dashboard-wip-search" />
        </div>

        {departments.length <= 1 && apps.length === 0 ? (
          <p className="text-sm text-gray-500" data-testid="filters-empty">
            Add a department or publish an app to filter this screen. Until then it is the whole plant.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-end gap-3 flex-1 min-w-[16rem]" data-testid="scope-selects">
              {departments.length > 1 && (
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
                    <option value="">All departments</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
              )}

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
        )}
      </div>

      {/* ── The plant, right now ───────────────────────────────────────────────
          Five tiles, always on screen, plant-wide until somebody narrows them.
          Every value is the server's own answer; a value nobody could measure
          prints '—' with the payload's reason next to it, never a 0. */}
      <div className="flex items-baseline gap-3 flex-wrap" data-tour="scope-heading">
        <h2 className="text-lg font-bold text-gray-900">{scopeHeading}</h2>
        <span className="text-xs text-gray-500">
          today so far{filters.app_id ? ` · ${apps.find(a => a.id === filters.app_id)?.name}` : ''}
          {snapshot?.plant_date ? ` · ${snapshot.plant_date}` : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4" data-tour="kpis">
        {floorLoading && !snapshot ? (
          [1, 2, 3, 4, 5].map(i => <SkeletonBox key={i} className="h-24 w-full" />)
        ) : (
          <>
            {/* The count is the snapshot's. The comparison beside it is the
                brief's `vs_7day_avg_pct`, measured over the same plant-day
                definition of a finished run, so the two cannot disagree — and
                it is simply absent (no 0%) on a plant with no week behind it.
                The heading above already names the scope, so this line does not
                repeat it: a tile that renames itself when you filter reads as a
                different measurement. */}
            <div data-testid="kpi-finished-today" className="h-full">
              <StatCard
                label="Finished today"
                className="h-full"
                value={snapshot?.finished_today ?? '—'}
                delta={brief?.kpis?.vs_7day_avg_pct ?? null}
                deltaLabel={brief?.kpis?.vs_7day_avg_pct != null ? 'vs 7-day average' : 'runs completed today'}
                icon={<CheckCircle size={18} />} iconBg="bg-green-50" iconColor="text-green-600"
              />
            </div>
            <div data-testid="kpi-running-now" className="h-full">
              <StatCard
                label="Running now"
                className="h-full"
                value={snapshot?.running_now ?? '—'}
                deltaLabel="operators mid-run"
                icon={<Activity size={18} />} iconBg="bg-blue-50" iconColor="text-blue-600"
                pulse={(snapshot?.running_now ?? 0) > 0}
              />
            </div>
            {/* The product's whole point, so it is a headline and not a
                footnote. Seconds in, seconds out — never a rounded 0m. The
                value never wraps: "6m 36s" broken across two lines on a phone
                reads as two numbers. `avg_cycle_basis` names whether this is
                hands-on time or wall clock, through the one shared vocabulary
                in components/apps/appModel. */}
            <div data-testid="kpi-avg-cycle" className="h-full">
              <StatCard
                label="Average cycle time"
                className="h-full"
                value={<span className="whitespace-nowrap" title={durationBasisNote(snapshot?.avg_cycle_basis ?? null)}>
                  {snapshot?.avg_cycle_seconds != null ? fmtDuration(snapshot.avg_cycle_seconds) : '—'}
                </span>}
                deltaLabel={snapshot?.avg_cycle_seconds != null
                  ? `${snapshot.avg_cycle_sample} run${snapshot.avg_cycle_sample === 1 ? '' : 's'}${durationBasisLabel(snapshot.avg_cycle_basis) ? ` · ${durationBasisLabel(snapshot.avg_cycle_basis)}` : ''}`
                  : `${snapshot?.avg_cycle_reason ?? 'no run has finished yet'}${inScope}`}
                icon={<Clock size={18} />} iconBg="bg-orange-50" iconColor="text-orange-600"
              />
            </div>
            <div data-testid="kpi-pass-rate" className="h-full">
              <StatCard
                label="Pass rate"
                className="h-full"
                value={snapshot?.pass_rate != null ? `${snapshot.pass_rate}%` : '—'}
                deltaLabel={snapshot?.pass_rate != null
                  ? `${snapshot.pass_rate_sample} inspected run${snapshot.pass_rate_sample === 1 ? '' : 's'}`
                  : `${snapshot?.pass_rate_reason ?? 'no pass/fail result recorded yet'}${inScope}`}
                icon={<TrendingUp size={18} />} iconBg="bg-purple-50" iconColor="text-purple-600"
              />
            </div>
            {/* The same sentence the department page and its wall board print
                (utils/floorWording), split across the tile's two lines so it is
                said once: "6 of 8" at headline size, "open work orders on
                track" as the label. Printing the whole sentence twice made this
                tile a head taller than its four siblings. */}
            <div data-testid="kpi-on-track" title={onTrack ?? undefined} className="h-full">
              <StatCard
                label="open work orders on track"
                className="h-full"
                value={<span className="whitespace-nowrap">
                  {snapshot && snapshot.open_work_orders > 0 ? `${snapshot.on_track} of ${snapshot.open_work_orders}` : '—'}
                </span>}
                deltaLabel={onTrack
                  ? undefined
                  : `${snapshot?.on_track_reason ?? 'no open work order to be on track with'}${inScope}`}
                icon={<CalendarClock size={18} />} iconBg="bg-sky-50" iconColor="text-sky-600"
              />
            </div>
          </>
        )}
      </div>

      {/* ── Work in progress, by operation ─────────────────────────────────────
          How much is running and how much is waiting in each department — the
          question the tiles above cannot answer, because "running now" is a
          plant total and the floor is organised by department.

          Every value here is the server's. Good and scrap are null WITH A
          REASON until somebody counts them: a plant that has recorded no scrap
          has not made zero scrap, and a rail of confident zeros is how that
          gets believed. */}
      {wip && wip.departments.length > 0 && (
        <div className="card p-5" data-testid="wip-strip">
          <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
            <h2 className="font-semibold text-gray-900">Work in progress</h2>
            <span className="text-xs text-gray-500">
              by operation{wip.plant_date ? ` · ${wip.plant_date}` : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {wip.departments.map(dept => (
              <div
                key={dept.department_id}
                data-testid="wip-department"
                className="rounded-xl border border-gray-200 p-3"
                style={{ borderLeft: `3px solid ${dept.department_color || '#94a3b8'}` }}
              >
                <div className="font-semibold text-gray-900 text-sm truncate">{dept.department_name}</div>
                <div className="text-sm text-gray-700 mt-1 [font-variant-numeric:tabular-nums]">
                  <span className="font-semibold">{dept.running}</span> running
                  {' · '}
                  <span className="font-semibold">{dept.queued}</span> queued
                </div>
                <div className="text-xs text-gray-500 mt-1 [font-variant-numeric:tabular-nums]">
                  {dept.good_today != null || dept.scrap_today != null ? (
                    <>
                      {dept.good_today ?? '—'} good / {dept.scrap_today ?? '—'} scrap today
                    </>
                  ) : (
                    // The reason, not a dash on its own — "—" alone leaves a
                    // supervisor guessing whether the line is broken.
                    <>— good / — scrap today · {dept.good_today_reason ?? 'not counted yet'}</>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── The departments, as doors ──────────────────────────────────────────
          The same figures the department's own page and its wall board show,
          from the same endpoint. A card opens that department. */}
      <div className="card p-5" data-tour="departments">
        <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
          <h2 className="font-semibold text-gray-900">Departments</h2>
          {/* The cards are a directory, not a fifth tile: they stay plant-wide
              while a filter is on, and say so, rather than looking like numbers
              that failed to narrow. */}
          <p className="text-xs text-gray-500" data-testid="departments-caption">
            {filtersActive ? 'Every department, plant-wide' : 'Open one for its stations, wall board and team'}
          </p>
        </div>

        {floorLoading && deptRows.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
            {[1, 2, 3].map(i => <SkeletonBox key={i} className="h-28 w-full" />)}
          </div>
        ) : deptRows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No departments yet"
            description="A department is an area of the floor — Assembly, Paint, Packaging. Create one and every run your apps capture gets grouped under it."
            action={isAtLeast('manager')
              ? <Link to="/settings?tab=sites" className="btn-primary">Create a department</Link>
              : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
            {deptRows.map(dept => {
              const status = deptStatus(dept);
              const sentence = onTrackSentence(dept);
              // Dimmed, not hidden: the one being read stays legible and the
              // rest recede, so the directory cannot be mistaken for the tiles.
              const outsideScope = !!selectedDeptId && dept.department_id !== selectedDeptId;
              return (
                <Link
                  key={dept.department_id}
                  to={`/departments/${dept.department_id}`}
                  data-testid="department-card"
                  data-outside-scope={outsideScope ? 'true' : 'false'}
                  className={`block bg-white rounded-xl border border-gray-200 border-l-4 ${deptBorderColor(status)} hover:shadow-md transition-all p-3.5 ${
                    outsideScope ? 'opacity-40 hover:opacity-100' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm truncate">{dept.department_name}</span>
                    <StatusPill status={status} />
                    <ChevronRight size={14} className="text-gray-300 ml-auto flex-shrink-0" />
                  </div>
                  <div className="flex items-end gap-5">
                    <div className="min-w-0">
                      <div className="text-2xl font-bold text-gray-900 leading-none tabular-nums">{dept.finished_today}</div>
                      <div className="text-[11px] text-gray-500 mt-1">finished today</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-2xl font-bold text-gray-900 leading-none tabular-nums whitespace-nowrap">
                        {dept.avg_cycle_seconds != null ? fmtDuration(dept.avg_cycle_seconds) : '—'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        {dept.avg_cycle_seconds != null ? 'average cycle' : dept.avg_cycle_reason ?? 'nothing measured yet'}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-2.5">
                    {sentence ?? `— ${dept.on_track_reason ?? 'no open work order to be on track with'}`}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Latest runs — the cycle times as they are captured, one row per run,
          and a live count-up on whatever is still running. */}
      <div className="card p-5" data-tour="latest-runs">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Latest runs</h2>
            <p className="text-[11px] text-gray-500">What each one took, as your apps record it</p>
          </div>
          <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
            Cycle-time history <ArrowRight size={12} />
          </Link>
        </div>
        {floorLoading && recentRuns.length === 0 ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <SkeletonBox key={i} className="h-9 w-full" />)}</div>
        ) : recentRuns.length === 0 ? (
          <EmptyState
            compact
            icon={Clock}
            title={`No runs recorded yet${inScope}`}
            description="As soon as an operator finishes an app on the floor, the run and the time it took land here."
          />
        ) : (
          /* Three columns, not four: app and operator share a cell so the row
             fits a 390px phone without a sideways scroll. Splitting them was
             what pushed the time taken — the whole point of the row — off the
             right-hand edge. */
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
                {recentRuns.slice(0, 8).map(c => <RunRow key={c.id} run={c} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Output — one chart, three ranges, opening on the plant's own day so
          the chart and the Finished-today tile answer with the same number.
          Whichever range is on, the header says which and totals it. */}
      <div className="card p-5" data-tour="output">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Output</h2>
            <p className="text-[11px] text-gray-500" data-testid="output-total">
              {outputTotal} run{outputTotal === 1 ? '' : 's'} · {outputRangeLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {OUTPUT_RANGES.map(([id, label]) => (
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
        {loading || floorLoading ? (
          <SkeletonBox className="h-52 w-full" />
        ) : outputSeriesEmpty ? (
          // Recharts draws nothing at all for an empty series — not even axes —
          // which reads as a broken card rather than a quiet day.
          <EmptyState
            compact
            icon={BarChart2}
            title={outputRange === 'today'
              ? `No runs finished today${inScope}`
              : outputRange === 'day'
                ? `No runs finished in the last 24 hours${inScope}`
                : `No runs finished in the last 7 days${inScope}`}
            description="Every completed run is counted here the moment an operator finishes it."
          />
        ) : outputRange !== 'week' ? (
          <ResponsiveContainer width="100%" height={210}>
            {/* The axis is the plant's clock, like the buckets under it. */}
            <BarChart data={outputRange === 'today' ? todaySeries : hourlySeries} barSize={12} margin={{ left: 0, right: 10, top: 5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
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

      {/* Due soon. The schedule health that used to need its own tile and its
          own alert list now rides in this card's header — the same on-track
          sentence the tile above prints, from the same payload. */}
      <div className="card p-5" data-tour="due-soon">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Due in the next 48 hours</h2>
            <p className="text-[11px] text-gray-500">
              {onTrack ?? `No open work orders${inScope}`}
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
                    {/* WO-1001, the way the traveller and the barcode say it.
                        The stored id carries a company tag; it stays in `title`. */}
                    <span className="font-semibold text-xs text-gray-900 truncate" title={hasCompanyTag(wo.work_order_number) ? wo.work_order_number : undefined}>{displayId(wo.work_order_number)}</span>
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

/** One row of Latest runs. Three states, three honest readings.
 *
 *  A finished run has a cycle time. A run that is still running has an
 *  elapsed-so-far, which is a different measurement, is labelled as one, and
 *  counts up live rather than freezing at whatever the last poll returned. An
 *  abandoned run has neither: nothing ever stamped it finished, so any figure
 *  measured against the clock grows forever, and the only true thing to print
 *  is a dash. */
function RunRow({ run: c }: { run: PlantViewData['recent_completions'][number] }) {
  const running = c.status === 'in_progress';
  const finished = c.is_complete ?? c.status === 'completed';
  // Ticks once a second while the run is open; null for every other state, so
  // nothing is doing arithmetic on a run nobody is watching.
  const live = useLiveElapsed(running ? c.started_at : null, running ? c.elapsed_so_far_seconds : null);
  // A zero here is not a run that took no time — it is a run shorter than the
  // reported figure can resolve. Still a dash, never "0s".
  const took = finished
    ? (c.duration_seconds || null)
    : running
      ? (live || null)
      : null;
  const when = c.activity_at ?? c.completed_at;
  return (
    <tr className="hover:bg-gray-50 transition-colors align-top">
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
      {/* The tooltip names which measurement this is — hands-on vs wall clock —
          through the one shared vocabulary in components/apps/appModel. */}
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
}
