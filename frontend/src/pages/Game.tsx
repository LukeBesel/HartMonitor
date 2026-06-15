import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Trophy, Timer, Zap, RotateCcw, ArrowRight, Medal } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type MachineStatus = 'ok' | 'down' | 'fixing';
type GamePhase = 'menu' | 'playing' | 'entry' | 'leaderboard';

interface Machine { id: number; status: MachineStatus; emoji: string; }
interface LeaderScore { id: string; player_name: string; company: string; score: number; created_at: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const COLS = 5;
const ROWS = 4;
const TOTAL = COLS * ROWS;
const GAME_SECS = 60;
const FIX_ANIM_MS = 300;
const MACHINE_EMOJIS = ['⚙️', '🔩', '🏭', '⚡', '🔧', '🔨', '🪛', '🔬', '💡', '🔌', '🛠️', '🪝', '🔗', '📡', '🖥️', '🔋', '🌡️', '🏗️', '🚂', '🔄'];

function makeGrid(): Machine[] {
  return Array.from({ length: TOTAL }, (_, i) => ({
    id: i,
    status: 'ok',
    emoji: MACHINE_EMOJIS[i % MACHINE_EMOJIS.length],
  }));
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchLeaderboard(): Promise<LeaderScore[]> {
  const r = await fetch('/api/game/leaderboard');
  if (!r.ok) return [];
  return r.json();
}

async function submitScore(player_name: string, company: string, score: number) {
  const r = await fetch('/api/game/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name, company, score }),
  });
  if (!r.ok) throw new Error('Submit failed');
  return r.json() as Promise<{ id: string; rank: number }>;
}

// ─── Machine card ─────────────────────────────────────────────────────────────

function MachineCard({ machine, onClick, gameActive }: {
  machine: Machine; onClick: () => void; gameActive: boolean;
}) {
  const { status, emoji } = machine;

  const bg = status === 'down'
    ? 'bg-red-500/20 border-red-500/50 shadow-red-500/20'
    : status === 'fixing'
    ? 'bg-yellow-500/20 border-yellow-500/50 shadow-yellow-500/20'
    : 'bg-slate-700/50 border-slate-600/50';

  const pulse = status === 'down' ? 'animate-pulse' : '';
  const spin  = status === 'fixing' ? 'animate-spin' : '';

  return (
    <button
      onClick={gameActive && status === 'down' ? onClick : undefined}
      disabled={!gameActive || status !== 'down'}
      className={`relative aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1 transition-all duration-150 shadow-lg
        ${bg} ${pulse}
        ${status === 'down' ? 'cursor-pointer hover:scale-105 active:scale-95 hover:shadow-xl' : 'cursor-default'}
        ${status === 'ok' ? 'opacity-70' : 'opacity-100'}
      `}
    >
      <span className={`text-2xl sm:text-3xl ${spin}`}>
        {status === 'down' ? '❌' : status === 'fixing' ? '⚙️' : emoji}
      </span>
      {status === 'down' && (
        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 border-2 border-slate-900 animate-ping" />
      )}
      {status === 'ok' && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-sm shadow-green-400" />
      )}
    </button>
  );
}

// ─── Leaderboard table ────────────────────────────────────────────────────────

function LeaderboardTable({ scores, highlightId }: { scores: LeaderScore[]; highlightId?: string }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div className="w-full">
      {scores.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">No scores yet — be the first!</p>
      ) : (
        <div className="space-y-1.5">
          {scores.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all ${
                s.id === highlightId
                  ? 'bg-yellow-500/20 border border-yellow-500/40 shadow-sm'
                  : i < 3
                  ? 'bg-slate-700/40'
                  : 'bg-slate-800/30'
              }`}
            >
              <span className="w-7 text-center text-sm font-bold text-slate-300 flex-shrink-0">
                {medals[i] || `#${i + 1}`}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white text-sm truncate">{s.player_name}</div>
                {s.company && <div className="text-xs text-slate-400 truncate">{s.company}</div>}
              </div>
              <span className="font-bold text-blue-300 text-base flex-shrink-0">{s.score.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main game component ──────────────────────────────────────────────────────

export default function Game() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [machines, setMachines] = useState<Machine[]>(makeGrid());
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_SECS);
  const [combo, setCombo] = useState(1);
  const [comboLabel, setComboLabel] = useState('');
  const [alarm, setAlarm] = useState(false);
  const [totalFixed, setTotalFixed] = useState(0);

  // Entry form
  const [playerName, setPlayerName] = useState('');
  const [playerCompany, setPlayerCompany] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [finalRank, setFinalRank] = useState<number | null>(null);
  const [newEntryId, setNewEntryId] = useState('');

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderScore[]>([]);
  const [loadingLB, setLoadingLB] = useState(false);

  const lastFixTime = useRef<number>(0);
  const comboCount  = useRef<number>(0);
  const breakTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const countTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalScore  = useRef(0);

  // ─── Game loop ──────────────────────────────────────────────────────────────

  const stopTimers = useCallback(() => {
    if (breakTimer.current) { clearInterval(breakTimer.current); breakTimer.current = null; }
    if (countTimer.current) { clearInterval(countTimer.current); countTimer.current = null; }
  }, []);

  const endGame = useCallback(() => {
    stopTimers();
    setPhase('entry');
  }, [stopTimers]);

  const startGame = useCallback(() => {
    stopTimers();
    const grid = makeGrid();
    setMachines(grid);
    setScore(0);
    setTimeLeft(GAME_SECS);
    setCombo(1);
    setComboLabel('');
    setAlarm(false);
    setTotalFixed(0);
    finalScore.current = 0;
    lastFixTime.current = 0;
    comboCount.current = 0;
    setPhase('playing');

    // Countdown
    let t = GAME_SECS;
    countTimer.current = setInterval(() => {
      t -= 1;
      setTimeLeft(t);
      if (t <= 0) endGame();
    }, 1000);

    // Random machine breakdowns — rate increases as time runs out
    const scheduleBreak = () => {
      const elapsed = GAME_SECS - t;
      const rate = Math.max(900, 2400 - elapsed * 25);
      breakTimer.current = setTimeout(() => {
        setMachines(prev => {
          const ok = prev.filter(m => m.status === 'ok');
          if (ok.length === 0) { scheduleBreak(); return prev; }
          const target = ok[Math.floor(Math.random() * ok.length)];
          const next = prev.map(m => m.id === target.id ? { ...m, status: 'down' as MachineStatus } : m);
          const downCount = next.filter(m => m.status === 'down').length;
          setAlarm(downCount >= 5);
          return next;
        });
        scheduleBreak();
      }, rate);
    };
    scheduleBreak();
  }, [stopTimers, endGame]);

  // Clean up on unmount
  useEffect(() => () => stopTimers(), [stopTimers]);

  // ─── Fix a machine ──────────────────────────────────────────────────────────

  const fixMachine = useCallback((id: number) => {
    const now = Date.now();
    const timeSinceLast = now - lastFixTime.current;
    lastFixTime.current = now;

    // Combo calculation
    if (timeSinceLast < 1800) {
      comboCount.current = Math.min(comboCount.current + 1, 5);
    } else {
      comboCount.current = 0;
    }

    const multiplier = comboCount.current >= 4 ? 3
      : comboCount.current >= 2 ? 2
      : 1;
    const pts = 10 * multiplier;

    setCombo(multiplier);
    if (multiplier > 1) setComboLabel(`×${multiplier} COMBO!`);
    else setComboLabel('');

    setScore(s => { finalScore.current = s + pts; return s + pts; });
    setTotalFixed(n => n + 1);

    // Animate: down → fixing → ok
    setMachines(prev => prev.map(m => m.id === id ? { ...m, status: 'fixing' as MachineStatus } : m));
    setTimeout(() => {
      setMachines(prev => {
        const next = prev.map(m => m.id === id ? { ...m, status: 'ok' as MachineStatus } : m);
        const downCount = next.filter(m => m.status === 'down').length;
        setAlarm(downCount >= 5);
        return next;
      });
    }, FIX_ANIM_MS);
  }, []);

  // ─── Submit score ───────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!playerName.trim()) { setSubmitError('Please enter your name'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const { rank, id } = await submitScore(playerName.trim(), playerCompany.trim(), finalScore.current);
      setFinalRank(rank);
      setNewEntryId(id);
      await loadLeaderboard();
      setPhase('leaderboard');
    } catch {
      setSubmitError('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const loadLeaderboard = async () => {
    setLoadingLB(true);
    try { setLeaderboard(await fetchLeaderboard()); } finally { setLoadingLB(false); }
  };

  // Load leaderboard for the menu
  useEffect(() => { if (phase === 'menu') loadLeaderboard(); }, [phase]);

  // ─── Timer ring ─────────────────────────────────────────────────────────────

  const timerPct = timeLeft / GAME_SECS;
  const timerColor = timeLeft > 20 ? '#3b82f6' : timeLeft > 10 ? '#f59e0b' : '#ef4444';

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#060c1a] text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}>
              <Activity size={15} className="text-white" strokeWidth={2.5} />
            </span>
            <span className="font-bold text-white text-sm">HartMonitor</span>
          </Link>
          <div className="flex items-center gap-1 text-yellow-400 font-bold text-sm">
            <Trophy size={15} />
            <span>DOWNTIME Buster</span>
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-6">

        {/* ─── MENU ─────────────────────────────────────────────────────────── */}
        {phase === 'menu' && (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="text-5xl mb-2">🏭</div>
              <h1 className="text-3xl font-extrabold tracking-tight">DOWNTIME Buster</h1>
              <p className="text-slate-400 text-sm max-w-xs mx-auto leading-relaxed">
                Machines are breaking down on the factory floor! Click them before downtime
                spirals out of control. How many can you fix in 60 seconds?
              </p>
              <div className="flex justify-center gap-4 text-xs text-slate-400 pt-1">
                <span>⚡ Fast fixes = combos</span>
                <span>❌ Click to fix</span>
                <span>🏆 Beat the leaderboard</span>
              </div>
            </div>

            <button
              onClick={startGame}
              className="w-full py-4 rounded-2xl text-white font-bold text-lg flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 shadow-xl"
              style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}
            >
              <Zap size={20} />
              Start Game
            </button>

            {/* Leaderboard preview */}
            <div>
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                <Trophy size={14} className="text-yellow-400" /> Top Scores
              </h2>
              {loadingLB ? (
                <div className="text-center py-6">
                  <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <LeaderboardTable scores={leaderboard} />
              )}
            </div>
          </div>
        )}

        {/* ─── PLAYING ──────────────────────────────────────────────────────── */}
        {phase === 'playing' && (
          <div className="space-y-4">
            {/* HUD */}
            <div className="flex items-center justify-between">
              {/* Score */}
              <div>
                <div className="text-2xl font-extrabold tabular-nums text-white">{score.toLocaleString()}</div>
                <div className="text-xs text-slate-400">{totalFixed} fixed</div>
              </div>

              {/* Combo badge */}
              <div className="text-center min-w-[80px]">
                {combo > 1 && (
                  <div className="text-sm font-bold text-yellow-400 animate-bounce">{comboLabel}</div>
                )}
              </div>

              {/* Timer ring */}
              <div className="relative w-14 h-14">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                  <circle
                    cx="22" cy="22" r="18" fill="none"
                    stroke={timerColor}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${113 * timerPct} 113`}
                    style={{ transition: 'stroke-dasharray 0.5s linear, stroke 0.5s' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold tabular-nums" style={{ color: timerColor }}>{timeLeft}</span>
                </div>
              </div>
            </div>

            {/* DOWNTIME alarm */}
            {alarm && (
              <div className="bg-red-600/20 border border-red-500/50 rounded-xl px-4 py-2.5 text-center animate-pulse">
                <span className="text-red-400 font-bold text-sm">⚠️ DOWNTIME ALERT — fix machines now!</span>
              </div>
            )}

            {/* Machine grid */}
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
            >
              {machines.map(m => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  onClick={() => fixMachine(m.id)}
                  gameActive={true}
                />
              ))}
            </div>

            <p className="text-center text-xs text-slate-500">Tap red machines to fix them!</p>
          </div>
        )}

        {/* ─── ENTRY ────────────────────────────────────────────────────────── */}
        {phase === 'entry' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-5xl">🏆</div>
              <h2 className="text-2xl font-extrabold">Time's up!</h2>
              <div className="text-4xl font-extrabold text-blue-400">{finalScore.current.toLocaleString()}</div>
              <p className="text-sm text-slate-400">{totalFixed} machines fixed</p>
            </div>

            <div className="bg-slate-800/60 rounded-2xl p-5 space-y-4 border border-white/10">
              <p className="text-sm font-semibold text-slate-200">Submit your score to the leaderboard</p>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Your name *</label>
                <input
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Alex Chen"
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  maxLength={80}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Company (optional)</label>
                <input
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-700 border border-slate-600 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Acme Manufacturing"
                  value={playerCompany}
                  onChange={e => setPlayerCompany(e.target.value)}
                  maxLength={80}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>
              {submitError && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{submitError}</p>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}
              >
                {submitting ? 'Submitting…' : <><Trophy size={15} /> Submit Score</>}
              </button>
            </div>

            <button
              onClick={startGame}
              className="w-full py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:border-white/20 text-sm flex items-center justify-center gap-1.5 transition-all"
            >
              <RotateCcw size={13} /> Play again without submitting
            </button>
          </div>
        )}

        {/* ─── LEADERBOARD ──────────────────────────────────────────────────── */}
        {phase === 'leaderboard' && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="text-4xl">🏆</div>
              <h2 className="text-xl font-extrabold">Leaderboard</h2>
              {finalRank !== null && (
                <div className="inline-flex items-center gap-1.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-full px-4 py-1.5 text-sm font-semibold">
                  <Medal size={14} />
                  You ranked #{finalRank} with {finalScore.current.toLocaleString()} pts!
                </div>
              )}
            </div>

            <LeaderboardTable scores={leaderboard} highlightId={newEntryId} />

            <div className="flex gap-3">
              <button
                onClick={startGame}
                className="flex-1 py-3 rounded-xl border border-white/10 text-slate-300 hover:text-white hover:border-white/20 text-sm flex items-center justify-center gap-1.5 transition-all"
              >
                <RotateCcw size={14} /> Play Again
              </button>
              <Link
                to="/login"
                className="flex-1 py-3 rounded-xl text-white font-semibold text-sm flex items-center justify-center gap-1.5 transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #2563eb, #7c3aed)' }}
              >
                Try HartMonitor <ArrowRight size={14} />
              </Link>
            </div>

            <button
              onClick={() => { setPhase('menu'); setFinalRank(null); setNewEntryId(''); }}
              className="w-full text-xs text-slate-500 hover:text-slate-300 py-2 transition-colors"
            >
              ← Back to menu
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
