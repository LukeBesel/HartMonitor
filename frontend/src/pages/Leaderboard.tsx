import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  LeaderboardBoard, LeaderboardPeriod, LeaderboardResponse,
  LeaderboardDepartment, LeaderboardDepartmentsResponse,
} from '../types';
import {
  Trophy, Crown, Medal, Award, RefreshCw, Tv, Clock,
  Users, ShieldCheck, AlertCircle, Sparkles, ChevronRight, ChevronLeft, Building2, Gauge,
} from 'lucide-react';

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

export function formatDuration(minutes: number): string {
  if (minutes == null) return '—';
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  const m = Math.floor(minutes);
  const s = Math.round((minutes - m) * 60);
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

const RANK_ICON: Record<number, { icon: React.ReactNode; color: string }> = {
  1: { icon: <Crown size={14} />, color: 'text-amber-500' },
  2: { icon: <Medal size={14} />, color: 'text-slate-400' },
  3: { icon: <Award size={14} />, color: 'text-orange-400' },
};

function boardTitle(board: LeaderboardBoard): string {
  return board.product_type_name ? `${board.app_name} — ${board.product_type_name}` : board.app_name;
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
            <div className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{formatDuration(board.all_time_best_minutes)}</div>
          </div>
        )}
      </div>

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
          {board.leaders.map(l => {
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
                <td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">{formatDuration(l.best_minutes)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{formatDuration(l.avg_minutes)}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-400">{l.completions}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

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
  const champ = board.leaders[0];
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
        <span className="font-semibold">{formatDuration(champ.best_minutes)}</span>
        <span className="text-white/60">·</span>
        <span>{champ.completions} run{champ.completions === 1 ? '' : 's'}</span>
        {champ.is_record && (
          <span className="flex items-center gap-1 text-amber-300 ml-auto"><Sparkles size={12} /> Record</span>
        )}
      </div>
    </div>
  );
}

const DEPT_RANK_ACCENT: Record<number, string> = {
  1: 'text-amber-500',
  2: 'text-slate-400',
  3: 'text-orange-400',
};

function DepartmentCard({ dept, onSelect }: { dept: LeaderboardDepartment; onSelect: () => void }) {
  const rankColor = DEPT_RANK_ACCENT[dept.rank] || 'text-gray-300';
  return (
    <button
      onClick={onSelect}
      className="card p-5 text-left flex flex-col gap-3 hover:shadow-md transition-shadow group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-2xl font-black tabular-nums ${rankColor}`}>#{dept.rank}</span>
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
        <div>
          <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{formatDuration(dept.avg_minutes ?? 0)}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Avg Cycle</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-900 tabular-nums">{dept.throughput_per_day}</div>
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Per Day</div>
        </div>
      </div>

      {dept.best_minutes != null && (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-1 border-t border-gray-50">
          <Gauge size={11} /> Best clean run {formatDuration(dept.best_minutes)}
        </div>
      )}
    </button>
  );
}

export default function Leaderboard() {
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
  const champions = boards.filter(b => b.leaders.length > 0);

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
            <p className="text-xs text-gray-500 mt-0.5">
              {selectedDept
                ? 'Operator rankings — fastest clean runs by operation'
                : 'Departments ranked by output — drill in for operator rankings'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/leaderboard/tv"
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
      <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 w-fit shadow-sm">
        {PERIODS.map(p => {
          const active = period === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              style={active ? { backgroundColor: 'var(--accent)' } : {}}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {error && (
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
        ) : departments.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Trophy size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">No qualifying runs {period === 'all' ? 'yet' : `for ${deptData?.period_label.toLowerCase()}`}</p>
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
