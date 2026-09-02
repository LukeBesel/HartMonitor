import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Activity, CheckCircle2, Calendar, AlertTriangle, Crown, Medal, Award,
  X, Building2, Timer,
} from 'lucide-react';
import {
  BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell,
} from 'recharts';
import { getFloorSnapshot } from '../api/floor';
import type { FloorSnapshot } from '../api/floor';
import { onTrackSentence } from '../utils/floorWording';
import { useTvScale } from '../utils/useTvScale';
import { fmtDuration, fmtMinutes } from '../components/apps/appModel';
import { shiftUntilReadable } from '../utils/contrast';
import '../tv.css';

const REFRESH_MS = 25000;

/** The board's own ground. It keeps this palette in either theme, so the ink
 *  that has to survive on it can be derived once, exactly. */
const BOARD_GROUND = '#020617';

/** How many behind-takt jobs the banner names before it starts counting the
 *  rest. Three wide slots beat four narrow ones: the point of the banner is
 *  WHO is behind and by how much, and at four across a 1080p bar the operator's
 *  name is the part that gets trimmed away. */
const BANNER_SLOTS = 3;

interface TVData {
  department: { id: string; name: string; color?: string; manager_name?: string };
  date: string;
  /** `upcoming` is the only one of these three the board still renders.
   *  Running now and finished today come from GET /api/floor/snapshot, so
   *  this board, the department's own page and the Command Center print the
   *  same figures in the same words at the same minute. */
  status: { running: number; completed_today: number; upcoming: number };
  hourly: { hour: string; count: number }[];
  issues: { type: string; label: string; detail: string }[];
  // duration_seconds is the exact measurement; duration_minutes is the same
  // value pre-rounded to a tenth for older clients. Prefer seconds so this
  // board renders the identical string the run's own detail page does,
  // rather than re-expanding an already-rounded minutes figure.
  leaderboard: { operator_name: string; app_name?: string; duration_minutes: number; duration_seconds?: number }[];
  // takt_minutes/over_by_minutes have no seconds equivalent — sqdc.js
  // pre-rounds each to a tenth of a minute before it ever reaches this
  // payload (`Math.round(takt * 10) / 10`), so fmtMinutes(6.1) below prints
  // "6m 6s" for a takt computed from the un-rounded work order value as
  // "6m 5s". This is the honest rendering of the number the endpoint
  // actually sends — the fix belongs on the backend
  // (return takt_seconds/over_by_seconds instead of a pre-rounded minutes
  // figure, the same shape the leaderboard's duration_seconds already took),
  // which is outside this workstream's files (backend/src/routes/sqdc.js);
  // reported as a wave-2 follow-up rather than edited here.
  behind_takt?: {
    work_order_number: string; operator_name: string; station: string;
    takt_minutes: number; over_by_minutes: number; live: boolean;
  }[];
  any_behind?: boolean;
}

const RANK_ICON: Record<number, React.ReactNode> = {
  1: <Crown size="1.6em" className="text-amber-400" />,
  2: <Medal size="1.6em" className="text-slate-300" />,
  3: <Award size="1.6em" className="text-orange-400" />,
};

const RANK_RING: Record<number, string> = {
  1: 'border-amber-400/50 bg-amber-400/10',
  2: 'border-slate-400/40 bg-slate-400/10',
  3: 'border-orange-400/40 bg-orange-400/10',
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Tile({
  icon: Icon, value, label, accent,
}: { icon: React.ElementType; value: number | null; label: string; accent: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-3xl px-3 sm:px-6 py-4 sm:py-5 flex flex-col items-center justify-center text-center min-w-0">
      <Icon size="1.6em" style={{ color: accent }} className="mb-2" />
      <div className="text-5xl sm:text-6xl font-bold tabular-nums tracking-tight leading-none">{value ?? '—'}</div>
      <div className="text-xs uppercase tracking-[0.15em] text-white/60 mt-2 leading-tight">{label}</div>
    </div>
  );
}

export default function DepartmentTV() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TVData | null>(null);
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);
  const [error, setError] = useState(false);
  const now = useClock();
  // The board scales its whole type ramp with the panel; the chart is the one
  // piece that needs the number rather than the rem.
  const rootPx = useTvScale();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [res, snap] = await Promise.all([
        api.getDepartmentTV(id),
        getFloorSnapshot({ department_id: id }).catch(() => null),
      ]);
      setData(res);
      if (snap) setSnapshot(snap);
      setError(false);
    } catch {
      setError(true);
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const accent = data?.department.color || '#6366f1';
  // The department's own colour is whatever someone picked out of a colour
  // well, and here it is drawn as an icon on the board's near-black ground. A
  // deep blue or purple lands under 3:1 there, so it is lifted only as far as
  // the non-text-contrast floor requires and keeps its hue.
  const accentInk = shiftUntilReadable(accent, BOARD_GROUND, 3);
  const hourly = data?.hourly ?? [];
  const issues = data?.issues ?? [];
  const leaderboard = data?.leaderboard ?? [];
  const maxHour = Math.max(1, ...hourly.map(h => h.count), 1);
  // Every bar at zero is a truthful chart of a quiet shift, but on a wall it is
  // indistinguishable from a chart that failed to load. Name which one it is.
  const noThroughputYet = hourly.length > 0 && hourly.every(h => h.count === 0);
  const onTrack = onTrackSentence(snapshot);
  const behind = data?.behind_takt ?? [];
  const anyBehind = !!data?.any_behind && behind.length > 0;
  const bannerShown = behind.slice(0, BANNER_SLOTS);
  const bannerRest = behind.length - bannerShown.length;

  return (
    // A board owns the whole screen and never scrolls — but a phone cannot show
    // one in a single viewport, so below the board breakpoint the same content
    // becomes an ordinary scrolling column instead of being clipped away.
    <div className="min-h-screen lg:h-screen w-full bg-slate-950 text-white flex flex-col overflow-x-hidden lg:overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-x-6 gap-y-2 flex-wrap px-4 sm:px-10 py-4 border-b border-white/10">
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${accent}33`, color: accentInk }}
          >
            <Building2 size="1.6em" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-none truncate">{data?.department.name ?? 'Department'}</h1>
            <p className="text-white/60 mt-1 flex items-center gap-3 text-sm">
              {data?.department.manager_name && <span className="truncate">{data.department.manager_name}</span>}
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          <div className="text-right min-w-0">
            <div className="text-3xl sm:text-4xl font-mono font-bold tabular-nums leading-none">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-xs text-white/60 mt-1 truncate">
              {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <Link
            to={`/departments/${id ?? ''}`}
            aria-label="Leave the board"
            className="text-white/60 hover:text-white transition-colors flex-shrink-0"
          >
            <X size="1.5em" />
          </Link>
        </div>
      </div>

      {/* Behind-takt alert banner.
          The bar itself does not pulse. Fading a red bar in and out drags
          everything written on it down too — at the dim end of the cycle the
          job numbers here measured 2.7:1, so for half of every second the most
          urgent thing on the board was also the least readable. The alarm is
          carried by a solid red that holds white at 6.5:1, and only the timer
          icon moves. */}
      {anyBehind && (
        <div className="flex-shrink-0 bg-red-700 px-4 sm:px-10 py-3 flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-5 border-b border-red-400/40">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Timer size="1.75em" className="text-white animate-pulse" />
            <span className="text-xl sm:text-2xl font-extrabold tracking-wide uppercase">Behind Takt</span>
            <span className="bg-black/25 text-white text-sm font-bold px-2.5 py-0.5 rounded-full tabular-nums">{behind.length}</span>
          </div>
          {/* A wall board is never scrolled, so the jobs wrap into a grid that
              fits instead of a strip that runs off the edge. Whatever the grid
              cannot seat is counted rather than dropped. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 xl:gap-3 flex-1 min-w-0">
            {bannerShown.map((b, i) => (
              <div key={i} className="bg-black/25 rounded-xl px-4 py-1.5 min-w-0">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-bold truncate">{b.work_order_number}</span>
                  <span className="font-bold tabular-nums ml-auto flex-shrink-0">+{fmtMinutes(b.over_by_minutes)}</span>
                </div>
                <div className="text-sm text-white/85 truncate">
                  {b.operator_name} @ {b.station} · over {fmtMinutes(b.takt_minutes)} takt{b.live ? ' (live)' : ''}
                </div>
              </div>
            ))}
          </div>
          {bannerRest > 0 && (
            <div className="tv-more text-sm font-bold self-center flex-shrink-0">+{bannerRest} more</div>
          )}
        </div>
      )}

      {error && !data ? (
        <div className="flex-1 flex items-center justify-center text-white/60 text-2xl px-6 text-center">
          Unable to load department display. Retrying automatically…
        </div>
      ) : !data ? (
        <div className="flex-1 flex items-center justify-center text-white/60 text-2xl">Loading…</div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 p-4 sm:p-6">
          {/* Left + center column: tiles, chart, issues */}
          <div className="lg:col-span-2 flex flex-col gap-4 sm:gap-6 min-h-0">
            {/* Status tiles */}
            <div className="grid grid-cols-3 gap-3 sm:gap-6 flex-shrink-0">
              <Tile icon={Activity} value={snapshot ? snapshot.running_now : null} label="Running Now" accent="#38bdf8" />
              <Tile icon={CheckCircle2} value={snapshot ? snapshot.finished_today : null} label="Finished Today" accent="#34d399" />
              <Tile icon={Calendar} value={data.status.upcoming} label="Upcoming" accent="#fbbf24" />
            </div>

            {/* Schedule health, worded exactly as the department's own page and
                the Command Center word it (utils/floorWording): a supervisor
                comparing the wall with the office screen is comparing the
                plant, not two turns of phrase. */}
            <div
              className="flex-shrink-0 bg-white/5 border border-white/10 rounded-3xl px-4 sm:px-6 py-3 text-center text-lg sm:text-xl text-white/85"
              data-testid="tv-on-track"
            >
              {onTrack ?? `— ${snapshot?.on_track_reason ?? 'no open work order to be on track with'}`}
            </div>

            {/* Hourly throughput chart */}
            <div className="flex-1 min-h-[14rem] bg-white/5 border border-white/10 rounded-3xl p-4 sm:p-6 flex flex-col">
              <h2 className="text-lg font-semibold text-white/80 mb-3 flex-shrink-0">Hourly Throughput</h2>
              {noThroughputYet && (
                <div className="text-white/60 text-base mb-2 flex-shrink-0">
                  Nothing completed in these hours yet today.
                </div>
              )}
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="hour"
                      stroke="#ffffff66"
                      // Recharts wants a number, so the axis is derived from the
                      // board's own scale rather than pinned at a laptop size.
                      tick={{ fill: '#ffffff99', fontSize: rootPx * 0.8 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={rootPx}
                    />
                    <Tooltip
                      cursor={{ fill: '#ffffff10' }}
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#fff', fontSize: rootPx * 0.85 }}
                      formatter={(v: number) => [v, 'Completions']}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {hourly.map((h, i) => (
                        <Cell key={i} fill={h.count >= maxHour ? accent : `${accent}99`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Issues */}
            <div className="flex-shrink-0 bg-white/5 border border-white/10 rounded-3xl p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle size="1.25em" className="text-red-400" />
                <h2 className="text-lg font-semibold text-white/80">Active Issues</h2>
                {issues.length > 0 && (
                  <span className="bg-red-500/20 text-red-200 text-sm font-bold px-3 py-0.5 rounded-full tabular-nums">
                    {issues.length}
                  </span>
                )}
              </div>
              {issues.length === 0 ? (
                <div className="flex items-center gap-3 text-emerald-400 text-lg">
                  <CheckCircle2 size="1.4em" />
                  <span>All clear — no active issues.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {issues.slice(0, 4).map((iss, i) => (
                    <div key={i} className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 min-w-0">
                      <AlertTriangle size="1.15em" className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-red-200 text-base truncate">{iss.label}</div>
                        <div className="text-red-200/90 text-sm line-clamp-2">{iss.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column: leaderboard */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-4 sm:p-6 flex flex-col min-h-0">
            <div className="flex items-center gap-3 mb-4 flex-shrink-0">
              <Crown size="1.5em" className="text-amber-400" />
              <h2 className="text-xl font-bold">Fastest Today</h2>
            </div>
            {leaderboard.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-white/60 text-center text-lg py-8">
                No completed runs yet today.
              </div>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto min-h-0">
                {leaderboard.map((l, i) => {
                  const rank = i + 1;
                  return (
                    <div
                      key={`${l.operator_name}-${i}`}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 min-w-0 ${
                        RANK_RING[rank] ?? 'border-white/10 bg-white/5'
                      }`}
                    >
                      <div className="w-9 flex items-center justify-center flex-shrink-0">
                        {RANK_ICON[rank] ?? <span className="text-xl font-bold text-white/60 tabular-nums">{rank}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-semibold truncate">{l.operator_name}</div>
                        {l.app_name && <div className="text-sm text-white/60 truncate">{l.app_name}</div>}
                      </div>
                      <div
                        className="text-xl font-bold tabular-nums flex-shrink-0"
                        style={{ color: rank === 1 ? '#fbbf24' : '#fff' }}
                      >
                        {l.duration_seconds != null ? fmtDuration(l.duration_seconds) : fmtMinutes(l.duration_minutes)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
