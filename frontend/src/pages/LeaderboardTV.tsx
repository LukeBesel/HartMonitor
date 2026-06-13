import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { LeaderboardBoard, LeaderboardPeriod, LeaderboardResponse } from '../types';
import { Trophy, Crown, Medal, Award, X, Sparkles } from 'lucide-react';
import { formatDuration } from './Leaderboard';
import { useBranding } from '../context/BrandingContext';

const ROTATE_MS = 10000;
const REFRESH_MS = 60000;

const RANK_STYLE: Record<number, { icon: React.ReactNode; ring: string }> = {
  1: { icon: <Crown size={28} />, ring: 'border-amber-400 bg-amber-400/10' },
  2: { icon: <Medal size={28} />, ring: 'border-slate-400 bg-slate-400/10' },
  3: { icon: <Award size={28} />, ring: 'border-orange-400 bg-orange-400/10' },
};

function boardTitle(board: LeaderboardBoard): string {
  return board.product_type_name ? `${board.app_name} — ${board.product_type_name}` : board.app_name;
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function LeaderboardTV() {
  const [params] = useSearchParams();
  const period = (['today', 'week', 'month', 'all'].includes(params.get('period') ?? '')
    ? params.get('period')
    : 'week') as LeaderboardPeriod;

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [index, setIndex] = useState(0);
  const { companyName } = useBranding();
  const now = useClock();

  useEffect(() => {
    const load = () => api.getLeaderboard(period).then(setData).catch(() => {});
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => clearInterval(refresh);
  }, [period]);

  const boards = (data?.boards ?? []).filter(b => b.leaders.length > 0);

  useEffect(() => {
    if (boards.length <= 1) { setIndex(0); return; }
    const t = setInterval(() => setIndex(i => (i + 1) % boards.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [boards.length]);

  const board = boards[Math.min(index, boards.length - 1)];

  return (
    <div className="min-h-screen w-full bg-slate-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-10 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
            <Trophy size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{companyName || 'HartMonitor'} Leaderboard</h1>
            <p className="text-sm text-white/50">{data?.period_label ?? ''} · fastest clean runs</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-2xl font-mono font-bold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
            <div className="text-xs text-white/40">{now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          </div>
          <Link to="/leaderboard" className="text-white/30 hover:text-white/70 transition-colors">
            <X size={22} />
          </Link>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-10 py-8">
        {!data ? (
          <div className="text-white/40 text-lg">Loading…</div>
        ) : !board ? (
          <div className="text-center text-white/40">
            <Trophy size={56} className="mx-auto mb-4 opacity-20" />
            <p className="text-xl font-medium">No qualifying runs yet</p>
            <p className="text-sm mt-1">Leaderboards appear once published apps log clean completions.</p>
          </div>
        ) : (
          <div key={`${board.app_id}-${board.product_type_id ?? 'd'}`} className="w-full max-w-4xl animate-[fadeIn_0.4s_ease-out]">
            <div className="text-center mb-8">
              <div className="text-sm uppercase tracking-[0.2em] text-white/40 mb-1">{boardTitle(board)}</div>
              <div className="flex items-center justify-center gap-4 text-white/50 text-sm">
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
                const style = RANK_STYLE[l.rank];
                return (
                  <div
                    key={l.operator_name}
                    className={`flex items-center gap-5 px-6 py-4 rounded-2xl border transition-all ${
                      style ? style.ring : 'border-white/10 bg-white/5'
                    }`}
                  >
                    <div className="w-10 flex items-center justify-center text-white/70 flex-shrink-0">
                      {style ? style.icon : <span className="text-xl font-bold text-white/30">{l.rank}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xl font-semibold truncate flex items-center gap-2">
                        {l.operator_name}
                        {l.is_record && <Sparkles size={18} className="text-amber-300 flex-shrink-0" />}
                      </div>
                      <div className="text-sm text-white/40">{l.completions} run{l.completions === 1 ? '' : 's'} · avg {formatDuration(l.avg_minutes)}</div>
                    </div>
                    <div className="text-3xl font-bold tabular-nums flex-shrink-0" style={{ color: l.rank === 1 ? '#fbbf24' : 'white' }}>
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
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-8 bg-white/80' : 'w-1.5 bg-white/20'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
