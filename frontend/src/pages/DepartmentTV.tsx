import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import {
  Activity, CheckCircle2, Calendar, AlertTriangle, Crown, Medal, Award,
  X, Building2,
} from 'lucide-react';
import {
  BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell,
} from 'recharts';

const REFRESH_MS = 25000;

interface TVData {
  department: { id: string; name: string; color?: string; manager_name?: string };
  date: string;
  status: { running: number; completed_today: number; upcoming: number };
  hourly: { hour: string; count: number }[];
  issues: { type: string; label: string; detail: string }[];
  leaderboard: { operator_name: string; app_name?: string; duration_minutes: number }[];
}

const RANK_ICON: Record<number, React.ReactNode> = {
  1: <Crown size={26} className="text-amber-400" />,
  2: <Medal size={26} className="text-slate-300" />,
  3: <Award size={26} className="text-orange-400" />,
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

function fmtDuration(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function Tile({
  icon: Icon, value, label, accent,
}: { icon: React.ElementType; value: number; label: string; accent: string }) {
  return (
    <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl px-8 py-7 flex flex-col items-center justify-center">
      <Icon size={32} style={{ color: accent }} className="mb-3" />
      <div className="text-7xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="text-sm uppercase tracking-[0.2em] text-white/40 mt-2">{label}</div>
    </div>
  );
}

export default function DepartmentTV() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<TVData | null>(null);
  const [error, setError] = useState(false);
  const now = useClock();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.getDepartmentTV(id);
      setData(res);
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
  const maxHour = Math.max(1, ...(data?.hourly.map(h => h.count) ?? [1]));

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-12 py-7 border-b border-white/10">
        <div className="flex items-center gap-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: `${accent}33`, color: accent }}
          >
            <Building2 size={32} />
          </div>
          <div>
            <h1 className="text-5xl font-bold tracking-tight">{data?.department.name ?? 'Department'}</h1>
            <p className="text-white/40 mt-1 flex items-center gap-3">
              {data?.department.manager_name && <span>{data.department.manager_name}</span>}
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="text-5xl font-mono font-bold tabular-nums">
              {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-sm text-white/40">
              {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <Link to={`/departments/${id ?? ''}`} className="text-white/30 hover:text-white/70 transition-colors">
            <X size={26} />
          </Link>
        </div>
      </div>

      {error && !data ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-2xl">
          Unable to load department display.
        </div>
      ) : !data ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-2xl">Loading…</div>
      ) : (
        <div className="flex-1 grid grid-cols-3 gap-8 p-12">
          {/* Left + center column: tiles, chart, issues */}
          <div className="col-span-2 flex flex-col gap-8">
            {/* Status tiles */}
            <div className="flex gap-8">
              <Tile icon={Activity} value={data.status.running} label="Running Now" accent="#38bdf8" />
              <Tile icon={CheckCircle2} value={data.status.completed_today} label="Completed Today" accent="#34d399" />
              <Tile icon={Calendar} value={data.status.upcoming} label="Upcoming" accent="#fbbf24" />
            </div>

            {/* Hourly throughput chart */}
            <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
              <h2 className="text-xl font-semibold text-white/70 mb-4">Hourly Throughput</h2>
              <div className="flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hourly} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                    <XAxis
                      dataKey="hour"
                      stroke="#ffffff40"
                      tick={{ fill: '#ffffff60', fontSize: 13 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: '#ffffff10' }}
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, color: '#fff' }}
                      formatter={(v: number) => [v, 'Completions']}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {data.hourly.map((h, i) => (
                        <Cell key={i} fill={h.count >= maxHour ? accent : `${accent}99`} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Issues */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
              <div className="flex items-center gap-3 mb-4">
                <AlertTriangle size={22} className="text-red-400" />
                <h2 className="text-xl font-semibold text-white/70">Active Issues</h2>
                {data.issues.length > 0 && (
                  <span className="bg-red-500/20 text-red-300 text-sm font-bold px-3 py-0.5 rounded-full">
                    {data.issues.length}
                  </span>
                )}
              </div>
              {data.issues.length === 0 ? (
                <div className="flex items-center gap-3 text-emerald-400 text-xl">
                  <CheckCircle2 size={24} />
                  <span>All clear — no active issues.</span>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {data.issues.slice(0, 6).map((iss, i) => (
                    <div key={i} className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-2xl px-5 py-4">
                      <AlertTriangle size={20} className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-red-200 text-lg">{iss.label}</div>
                        <div className="text-red-300/70 text-sm truncate">{iss.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column: leaderboard */}
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
            <div className="flex items-center gap-3 mb-6">
              <Crown size={26} className="text-amber-400" />
              <h2 className="text-2xl font-bold">Fastest Today</h2>
            </div>
            {data.leaderboard.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-white/30 text-center text-lg">
                No completed runs yet today.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {data.leaderboard.map((l, i) => {
                  const rank = i + 1;
                  return (
                    <div
                      key={`${l.operator_name}-${i}`}
                      className={`flex items-center gap-4 rounded-2xl border px-5 py-4 ${
                        RANK_RING[rank] ?? 'border-white/10 bg-white/5'
                      }`}
                    >
                      <div className="w-10 flex items-center justify-center flex-shrink-0">
                        {RANK_ICON[rank] ?? <span className="text-2xl font-bold text-white/30">{rank}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xl font-semibold truncate">{l.operator_name}</div>
                        {l.app_name && <div className="text-sm text-white/40 truncate">{l.app_name}</div>}
                      </div>
                      <div
                        className="text-2xl font-bold tabular-nums flex-shrink-0"
                        style={{ color: rank === 1 ? '#fbbf24' : '#fff' }}
                      >
                        {fmtDuration(l.duration_minutes)}
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
