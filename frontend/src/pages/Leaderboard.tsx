import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useBranding } from '../context/BrandingContext';
import { useTvScale } from '../utils/useTvScale';
import { fmtMinutes } from '../components/apps/appModel';
import '../tv.css';
import type {
  LeaderboardBoard, LeaderboardPeriod, LeaderboardResponse,
  LeaderboardDepartment, LeaderboardDepartmentsResponse,
} from '../types';
import {
  Trophy, Crown, Medal, Award, RefreshCw, Tv, Clock,
  Users, ShieldCheck, AlertCircle, Sparkles, ChevronRight, ChevronLeft, Building2, Gauge, X,
} from 'lucide-react';
import TabBar from '../components/shared/TabBar';

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

/**
 * The wall board below reads this name, so it stays exported — but it is now a
 * one-line re-export of the shared minutes adapter, not a second
 * implementation. The leaderboard payload is in minutes end to end; every
 * duration below is `fmtMinutes` directly, and a plant record cannot print
 * one way here and another way on the run's own history page.
 */
export function formatDuration(minutes: number | null | undefined): string {
  return fmtMinutes(minutes);
}

const RANK_ICON: Record<number, { icon: React.ReactNode; color: string }> = {
  1: { icon: <Crown size={14} />, color: 'text-amber-500' },
  2: { icon: <Medal size={14} />, color: 'text-slate-400' },
  3: { icon: <Award size={14} />, color: 'text-orange-400' },
};

function boardTitle(board: LeaderboardBoard): string {
  return board.product_type_name ? `${board.app_name} — ${board.product_type_name}` : board.app_name;
}

function LoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <AlertCircle size={40} className="text-red-400" />
      <div>
        <p className="font-medium text-gray-500">{title}</p>
        <p className="text-sm text-gray-400 mt-1">{message}</p>
      </div>
      <button className="btn-secondary" onClick={onRetry}>Retry</button>
    </div>
  );
}

function BoardCard({ board }: { board: LeaderboardBoard }) {
  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{boardTitle(board)}</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
            <span className="flex items-center gap-1"><Users size={11} />{board.operator_count} operators</span>
            <span className="flex items-center gap-1"><Clock size={11} />{board.qualifying_count} runs</span>
          </div>
        </div>
        {board.all_time_best_minutes != null && (
          <div className="text-right flex-shrink-0">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">Plant record</div>
            <div className="text-sm font-bold" style={{ color: 'var(--accent-ink)' }}>{fmtMinutes(board.all_time_best_minutes)}</div>
          </div>
        )}
      </div>

      {/* The table scrolls inside itself: several of these columns do not fit
          a phone, and the rounded card around it clipped them off entirely. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-gray-400 uppercase tracking-wide">
              <th className="text-left font-medium pb-1.5 w-8">#</th>
              <th className="text-left font-medium pb-1.5">Operator</th>
              <th className="text-right font-medium pb-1.5">Best</th>
              <th className="text-right font-medium pb-1.5">Avg</th>
              <th className="text-right font-medium pb-1.5">Runs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(board.leaders ?? []).map(l => {
              const rankStyle = RANK_ICON[l.rank];
              return (
                <tr key={l.operator_name}>
                  <td className="py-1.5">
                    {rankStyle ? (
                      <span className={rankStyle.color}>{rankStyle.icon}</span>
                    ) : (
                      <span className="text-xs text-gray-400 pl-0.5">{l.rank}</span>
                    )}
                  </td>
                  <td className="py-1.5 font-medium text-gray-800 truncate max-w-[10rem]">
                    {l.operator_name}
                    {l.is_record && (
                      <span title="Plant record" className="ml-1.5 inline-flex items-center text-amber-500">
                        <Sparkles size={11} />
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">{fmtMinutes(l.best_minutes)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{fmtMinutes(l.avg_minutes)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-400">{l.completions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {board.excluded_quality_count > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-1 border-t border-gray-50">
          <ShieldCheck size={11} />
          {board.excluded_quality_count} run{board.excluded_quality_count === 1 ? '' : 's'} excluded for quality issues
        </div>
      )}
    </div>
  );
}

function ChampionCard({ board }: { board: LeaderboardBoard }) {
  const champ = board.leaders?.[0];
  if (!champ) return null;
  return (
    <div className="flex-shrink-0 w-64 rounded-xl p-4 text-white shadow-lg"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/70 mb-2">
        <Crown size={12} />
        {boardTitle(board)}
      </div>
      <div className="text-lg font-bold truncate">{champ.operator_name}</div>
      <div className="flex items-center gap-3 mt-1 text-sm text-white/90">
        <span className="font-semibold">{fmtMinutes(champ.best_minutes)}</span>
        <span className="text-white/60">·</span>
        <span>{champ.completions} run{champ.completions === 1 ? '' : 's'}</span>
        {champ.is_record && (
          <span className="flex items-center gap-1 text-amber-600 ml-auto"><Sparkles size={12} /> Record</span>
        )}
      </div>
    </div>
  );
}

const DEPT_RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-500',
  2: 'text-slate-500',
  3: 'text-orange-400',
};

function DepartmentCard({ dept, onSelect }: { dept: LeaderboardDepartment; onSelect: () => void }) {
  // The "No department" bucket has no rank — it is a pile of runs, not a place.
  const rankColor = (dept.rank != null && DEPT_RANK_ACCENT[dept.rank]) || 'text-gray-400';
  return (
    <button
      onClick={onSelect}
      className="card p-5 text-left flex flex-col gap-3 hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`font-black tabular-nums ${rankColor} ${dept.rank == null ? 'text-xs uppercase tracking-wide' : 'text-2xl'}`}>
            {dept.rank == null ? 'Unranked' : `#${dept.rank}`}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dept.department_color }} />
              <h3 className="font-semibold text-gray-900 truncate">{dept.department_name}</h3>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
              <span className="flex items-center gap-1"><Users size={11} />{dept.operator_count} operators</span>
              <span className="flex items-center gap-1"><Clock size={11} />{dept.completions} runs</span>
            </div>
          </div>
        </div>
        <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500 flex-shrink-0 mt-1" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center pt-2 border-t border-gray-50">
        <div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">{dept.completions}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Completions</div>
        </div>
        {/* A department nobody has timed has no average. The `?? 0` that used to
            sit here printed "0s", which reads as a department finishing units
            instantly rather than one nobody has measured. */}
        <div>
          <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-ink)' }}>
            {fmtMinutes(dept.avg_minutes)}
          </div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Cycle</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">{dept.throughput_per_day}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Per Day</div>
        </div>
      </div>

      {dept.best_minutes != null && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-1 border-t border-gray-50">
          <Gauge size={11} /> Best clean run {fmtMinutes(dept.best_minutes)}
        </div>
      )}
    </button>
  );
}

// ─── The wall board ───────────────────────────────────────────────────────────
// Same screen, same data, wall scale: `/leaderboard?tv=1` renders this instead
// of the page below, and App.tsx keeps that URL outside the management shell so
// there is no sidebar on the panel in the break room. It used to be a second
// page file that duplicated this one's rendering with different chrome — two
// files, one screen, and a plant record that could print two ways.

const TV_ROTATE_MS = 10000;
const TV_REFRESH_MS = 60000;

// Icons are sized in em so they ride the board's type scale up onto a 4K panel
// with everything else, instead of staying a fixed laptop size.
const TV_RANK_STYLE: Record<number, { icon: React.ReactNode; ring: string }> = {
  1: { icon: <Crown size="1.75em" />, ring: 'border-amber-400 bg-amber-400/10' },
  2: { icon: <Medal size="1.75em" />, ring: 'border-slate-400 bg-slate-400/10' },
  3: { icon: <Award size="1.75em" />, ring: 'border-orange-400 bg-orange-400/10' },
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function LeaderboardBoardTV({ period }: { period: LeaderboardPeriod }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const { companyName } = useBranding();
  const now = useClock();
  useTvScale();

  useEffect(() => {
    const load = () => api.getLeaderboard(period)
      .then(d => { setData(d); setLoadFailed(false); })
      .catch(() => setLoadFailed(true));
    load();
    const refresh = setInterval(load, TV_REFRESH_MS);
    return () => clearInterval(refresh);
  }, [period]);

  const boards = (data?.boards ?? []).filter(b => b.leaders.length > 0);

  useEffect(() => {
    if (boards.length <= 1) { setIndex(0); return; }
    const t = setInterval(() => setIndex(i => (i + 1) % boards.length), TV_ROTATE_MS);
    return () => clearInterval(t);
  }, [boards.length]);

  const board = boards[Math.min(index, boards.length - 1)];

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-x-6 gap-y-3 flex-wrap px-4 sm:px-10 py-5 sm:py-6 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--accent-glow), var(--secondary))' }}>
            <Trophy size="1.4em" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight truncate">{companyName || 'HartMonitor'} Leaderboard</h1>
            <p className="text-sm text-white/60 truncate">{data?.period_label ?? ''} · fastest clean runs</p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          <div className="text-right min-w-0">
            <div className="text-2xl font-mono font-bold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="text-xs text-white/60 truncate">{now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          </div>
          <Link to="/leaderboard" aria-label="Leave the board" className="text-white/60 hover:text-white transition-colors flex-shrink-0">
            <X size="1.4em" />
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-10 py-8">
        {!data ? (
          <div className="text-white/60 text-lg text-center">
            {loadFailed ? 'Unable to load leaderboard. Retrying automatically…' : 'Loading…'}
          </div>
        ) : !board ? (
          <div className="text-center text-white/60">
            <Trophy size="3.5em" className="mx-auto mb-4 text-white/50" />
            <p className="text-xl font-medium">No qualifying runs yet</p>
            <p className="text-sm mt-1">Leaderboards appear once published apps log clean completions.</p>
          </div>
        ) : (
          <div key={`${board.app_id}-${board.product_type_id ?? 'd'}`} className="w-full max-w-4xl animate-[fadeIn_0.4s_ease-out]">
            <div className="text-center mb-8">
              <div className="text-sm uppercase tracking-[0.15em] text-white/60 mb-1">{boardTitle(board)}</div>
              <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1 text-white/60 text-sm">
                <span>{board.operator_count} operators</span>
                <span>·</span>
                <span>{board.qualifying_count} runs</span>
                {board.all_time_best_minutes != null && (
                  <>
                    <span>·</span>
                    <span>plant record {formatDuration(board.all_time_best_minutes)}</span>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {board.leaders.slice(0, 5).map(l => {
                const style = TV_RANK_STYLE[l.rank];
                return (
                  <div
                    key={l.operator_name}
                    className={`flex items-center gap-3 sm:gap-5 flex-wrap px-4 sm:px-6 py-4 rounded-2xl border transition-all ${
                      style ? style.ring : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="w-10 flex items-center justify-center text-white/80 flex-shrink-0">
                      {style ? style.icon : <span className="text-xl font-bold text-white/60 tabular-nums">{l.rank}</span>}
                    </div>
                    <div className="flex-1 min-w-[10rem]">
                      <div className="text-xl font-semibold truncate flex items-center gap-2">
                        {l.operator_name}
                        {l.is_record && <Sparkles size="1.15em" className="text-amber-300 flex-shrink-0" />}
                      </div>
                      <div className="text-sm text-white/60 truncate">{l.completions} run{l.completions === 1 ? '' : 's'} · avg {formatDuration(l.avg_minutes)}</div>
                    </div>
                    <div className="text-3xl font-bold tabular-nums flex-shrink-0 ml-auto" style={{ color: l.rank === 1 ? '#fbbf24' : 'white' }}>
                      {formatDuration(l.best_minutes)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Rotation dots */}
      {boards.length > 1 && (
        <div className="flex items-center justify-center gap-2 pb-8">
          {boards.map((b, i) => (
            <div
              key={`${b.app_id}-${b.product_type_id ?? 'd'}`}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-white/80' : 'w-1.5 bg-white/40'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `?tv=1` is the wall board; anything else is the office page. The choice is
 * made HERE, before either one's hooks exist, so a panel on the wall runs the
 * board's fetches and only the board's: an early return further down still
 * mounted the office page's effects first, and every board load fetched the
 * department ranking nobody was going to see.
 */
export default function Leaderboard() {
  const [searchParams] = useSearchParams();
  if (searchParams.get('tv') === '1') {
    const period = (['today', 'week', 'month', 'all'].includes(searchParams.get('period') ?? '')
      ? searchParams.get('period')
      : 'week') as LeaderboardPeriod;
    return <LeaderboardBoardTV period={period} />;
  }
  return <LeaderboardPage />;
}

/** The leaderboard inside the management shell: departments, then operators. */
function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // ── Level 1: department-ranked board ──
  const [deptData, setDeptData] = useState<LeaderboardDepartmentsResponse | null>(null);
  const [deptLoading, setDeptLoading] = useState(true);

  // ── Drill-down selection (null = Level 1) ──
  const [selectedDept, setSelectedDept] = useState<LeaderboardDepartment | null>(null);
  const [appId, setAppId] = useState('');

  // ── Level 2: per-operation operator boards for the selected department ──
  const [boardData, setBoardData] = useState<LeaderboardResponse | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const loadDepartments = useCallback((p: LeaderboardPeriod, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    api.getLeaderboardDepartments(p)
      .then(res => { setDeptData(res); setError(''); })
      .catch(err => setError(err.message || 'Failed to load leaderboard'))
      .finally(() => { setDeptLoading(false); setRefreshing(false); });
  }, []);

  const loadBoards = useCallback((p: LeaderboardPeriod, departmentId: string | null, app: string, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    setBoardLoading(true);
    api.getLeaderboard(p, { department_id: departmentId || undefined, app_id: app || undefined })
      .then(res => { setBoardData(res); setError(''); })
      .catch(err => setError(err.message || 'Failed to load leaderboard'))
      .finally(() => { setBoardLoading(false); setRefreshing(false); });
  }, []);

  // Level 1 always reloads on period change.
  useEffect(() => {
    setDeptLoading(true);
    loadDepartments(period);
  }, [period, loadDepartments]);

  // Level 2 reloads whenever the drill-down scope (dept, app, period) changes.
  useEffect(() => {
    if (!selectedDept) return;
    loadBoards(period, selectedDept.department_id, appId);
  }, [selectedDept, appId, period, loadBoards]);

  const openDepartment = (dept: LeaderboardDepartment) => {
    setSelectedDept(dept);
    setAppId('');
    setBoardData(null);
  };
  const backToDepartments = () => {
    setSelectedDept(null);
    setAppId('');
    setBoardData(null);
  };

  const refresh = () => {
    if (selectedDept) loadBoards(period, selectedDept.department_id, appId, true);
    else loadDepartments(period, true);
  };

  const departments = deptData?.departments ?? [];
  const boards = boardData?.boards ?? [];
  const appOptions = boardData?.apps ?? [];
  const champions = boards.filter(b => (b.leaders?.length ?? 0) > 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            <Trophy size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Leaderboard</h1>
            {/* Says exactly what is being counted. Cross-department output is a
                volume tally, not a productivity comparison — the like-for-like
                ranking is the per-operation drill-down. */}
            <p className="text-xs text-gray-500 mt-0.5">
              {selectedDept
                ? 'Operator rankings — fastest clean runs, compared only within the same operation and part'
                : 'Clean runs completed per department — open one to rank operators within the same operation'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/leaderboard?tv=1"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <Tv size={14} /> TV Mode
          </Link>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={backToDepartments}
          className={`flex items-center gap-1 ${selectedDept ? 'text-gray-500 hover:text-gray-800' : 'font-medium text-gray-900'}`}
        >
          <Building2 size={14} /> Departments
        </button>
        {selectedDept && (
          <>
            <ChevronRight size={14} className="text-gray-300" />
            <span className="flex items-center gap-1.5 font-medium text-gray-900">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selectedDept.department_color }} />
              {selectedDept.department_name}
            </span>
          </>
        )}
      </div>

      {/* Period selector */}
      <TabBar
        items={PERIODS.map(p => ({ key: p.id, label: p.label }))}
        active={period}
        onSelect={setPeriod}
        variant="pill"
        ariaLabel="Leaderboard time range"
      />

      {error && (selectedDept ? boards.length > 0 : departments.length > 0) && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* ── Level 1: departments ── */}
      {!selectedDept && (
        deptLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="card h-40 animate-pulse bg-gray-100" />)}
          </div>
        ) : error && departments.length === 0 ? (
          <LoadError
            title="Couldn't load the leaderboard"
            message={error}
            onRetry={() => { setDeptLoading(true); loadDepartments(period); }}
          />
        ) : departments.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Trophy size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No qualifying runs {period === 'all' ? 'yet' : `for ${deptData?.period_label?.toLowerCase() ?? 'this period'}`}</p>
            <p className="text-sm mt-1 max-w-md mx-auto">
              Leaderboards appear once a published app has completed runs with status "completed"
              and no open quality issues (NCRs).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map(d => (
              <DepartmentCard key={d.department_id ?? 'unassigned'} dept={d} onSelect={() => openDepartment(d)} />
            ))}
          </div>
        )
      )}

      {/* ── Level 2: operator rankings within the selected department ── */}
      {selectedDept && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={backToDepartments}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
            >
              <ChevronLeft size={14} /> All Departments
            </button>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Operation</label>
              <select
                className="input-field text-sm py-1.5 min-w-[12rem]"
                value={appId}
                onChange={e => setAppId(e.target.value)}
              >
                <option value="">All Operations</option>
                {appOptions.map(a => <option key={a.app_id} value={a.app_id}>{a.app_name}</option>)}
              </select>
            </div>
          </div>

          {boardLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => <div key={i} className="card h-56 animate-pulse bg-gray-100" />)}
            </div>
          ) : error && boards.length === 0 ? (
            <LoadError
              title="Couldn't load operator rankings"
              message={error}
              onRetry={() => loadBoards(period, selectedDept.department_id, appId)}
            />
          ) : boards.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Trophy size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">No qualifying runs in {selectedDept.department_name}</p>
              <p className="text-sm mt-1 max-w-md mx-auto">
                Try a different operation or period. Boards show completed runs with no open quality issues.
              </p>
            </div>
          ) : (
            <>
              {/* Champions banner */}
              {champions.length > 0 && (
                <div>
                  <h2 className="font-semibold text-gray-700 text-sm mb-3">
                    {boardData?.period_label} Champions
                  </h2>
                  <div className="flex gap-3 overflow-x-auto pb-1">
                    {champions.map(b => (
                      <ChampionCard key={`${b.app_id}-${b.product_type_id ?? 'default'}`} board={b} />
                    ))}
                  </div>
                </div>
              )}

              {/* Board grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {boards.map(b => (
                  <BoardCard key={`${b.app_id}-${b.product_type_id ?? 'default'}`} board={b} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
