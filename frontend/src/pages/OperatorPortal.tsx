import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import {
  Factory, ChevronRight, Package, Clock, AlertTriangle, CheckCircle, User, Tablet,
  Briefcase, History as HistoryIcon, LogOut, RefreshCw, Send, ArrowLeft, ScanLine, WifiOff,
  MessageSquare, Lock, Delete, Users as UsersIcon, KeyRound, LayoutDashboard,
} from 'lucide-react';
import { timeAgo } from '../utils/time';
import {
  fmtMinutes, fmtDuration, durationBasisLabel, runDurationSeconds,
} from '../components/apps/appModel';
import { getFloorSnapshot, type FloorSnapshot, type DispatchRow } from '../api/floor';
import {
  getOperatorQueue, getOperatorRuns, dedupeRuns, stampIn, dispatchRowLabel,
  type OperatorRun,
} from '../api/operator';
import { tintedChipOn } from '../utils/contrast';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getQueuedNCRs, queueNCR, syncQueuedNCRs } from '../utils/offlineQueue';
import { useMessages } from '../context/MessagesContext';
import { useAuth } from '../context/AuthContext';
import { buildPlayLink } from '../components/player/runtime';
import type { MessageSeverity, Station } from '../types';

/** A floor identity, as far as it is actually known. `id` is a real user this
 *  work can be booked to; null means the person typed a name and nothing more,
 *  and the run will carry no user id rather than a made-up one. */
export interface OperatorIdentity {
  id: string | null;
  display_name: string;
}

interface RosterEntry {
  id: string;
  display_name: string;
  job_title?: string;
  has_pin: number;
  has_badge: number;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_name: string;
  part_number: string;
  quantity: number;
  quantity_completed: number;
  takt_time_minutes: number;
  priority: string;
  status: string;
  app_id: string | null;
  app_name?: string;
  department_name?: string;
  department_color?: string;
  scheduled_end?: string;
}

interface Completion {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  work_order_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  /** Per-step timers. The canonical duration comes from appModel's
   *  runDurationSeconds, which prefers these and falls back to the wall clock —
   *  the same rule the run-history endpoint applies in SQL. */
  step_times?: Record<string, unknown> | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#3b82f6', low: '#9ca3af',
};

const COMPLETION_STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-500/15 text-green-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  abandoned: 'bg-red-500/15 text-red-300',
};

const SEVERITY_OPTIONS: { value: 'minor' | 'major' | 'critical'; label: string; activeClass: string }[] = [
  { value: 'minor', label: 'Minor', activeClass: 'border-blue-400 bg-blue-500/20 text-blue-300' },
  { value: 'major', label: 'Major', activeClass: 'border-amber-400 bg-amber-500/20 text-amber-300' },
  { value: 'critical', label: 'Critical', activeClass: 'border-red-400 bg-red-500/20 text-red-300' },
];

/** The lightest surface a job card presents in this portal: `bg-blue-600/20`
 *  over the light end of the page's fixed navy gradient. Department chips derive
 *  their ink against this, so the darker card states clear by more. */
const CARD_SURFACE_LIGHTEST = '#324a73';

/**
 * A due DATE — 'YYYY-MM-DD', a calendar day with no time in it.
 *
 * Formatted in UTC on purpose: a date-only string is midnight UTC to
 * `new Date()`, so rendering it in any zone west of Greenwich prints the day
 * before. The plant promised the customer a DAY, and this prints that day.
 */
function dueLabel(due?: string | null) {
  if (!due) return '';
  const d = new Date(`${due}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return due;
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
}

/**
 * NOTE — there is no `isToday` here any more, and there must never be one
 * again. This screen used to decide what "today" meant from the TABLET's
 * browser clock, so a second-shift crew's counter reset at their own midnight
 * while every management screen carried on with the plant's day, and a kiosk
 * nobody had set the region on was simply in the wrong week. "Today" is
 * `finished_today_for_operator` on the floor snapshot, measured by the server
 * against the plant's calendar — the same day the Command Center reports.
 */

/** One dispatch row's identity — the operation it offers, or the standing app.
 *  Used to keep a selection alive across a refresh without holding a stale
 *  object under the Start button. */
function rowKey(row: DispatchRow): string {
  return row.work_order_operation_id ?? `app:${row.app_id ?? ''}`;
}

/** How many resume rows a tablet shows before it asks. Five is a glance; the
 *  uncapped list this replaces was however many times the shift had dropped
 *  signal, all of them looking identical. */
const RESUME_VISIBLE = 5;

type Tab = 'jobs' | 'history' | 'report' | 'profile';

/** Where a verified clock-in is remembered for the length of this tab's shift.
 *  sessionStorage, deliberately: it dies with the tab, and it is what stops a
 *  hand-typed ?uid= from clocking somebody else in — the id in the URL is only
 *  honoured when it matches the identity THIS tab actually verified. */
const IDENTITY_KEY = 'hm_operator_identity';

function rememberIdentity(who: OperatorIdentity) {
  try {
    if (who.id) sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(who));
    else sessionStorage.removeItem(IDENTITY_KEY);
  } catch { /* private mode — the operator just clocks in again */ }
}

function verifiedIdentity(): OperatorIdentity | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OperatorIdentity;
    return parsed && parsed.id && parsed.display_name ? parsed : null;
  } catch {
    return null;
  }
}

export default function OperatorPortal() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const [step, setStep] = useState<'name' | 'main'>('name');
  const [activeTab, setActiveTab] = useState<Tab>('jobs');
  const [operatorName, setOperatorName] = useState('');
  /** The verified user behind the name, when there is one. Carried into every
   *  run this portal starts so completions.operator_user_id is a real person. */
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [identifyError, setIdentifyError] = useState('');

  // ── What this operator should actually run next ─────────────────────────────
  // The queue is the SERVER's answer (/api/floor/dispatch) for the station this
  // tablet is standing at: the ready and running operations, in priority → due
  // date → sequence order, PLUS the published apps that need no work order.
  // The portal used to list work orders, so a published app attached to no job
  // was unreachable from the tablet meant to run it.
  const [queue, setQueue] = useState<DispatchRow[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<DispatchRow | null>(null);

  /** The station this tablet is at. Written by the player and by the return
   *  deep link; chosen here so an operator can move without an admin. */
  const [stations, setStations] = useState<Station[]>([]);
  const [stationId, setStationId] = useState<string>(() => {
    try { return localStorage.getItem('hm_station') || ''; } catch { return ''; }
  });

  /** The plant's own day, and the zone every stamp on this screen is printed
   *  in. Never the tablet's. */
  const [snapshot, setSnapshot] = useState<FloorSnapshot | null>(null);

  /** Runs this operator left open, one row per piece of work. */
  const [openRuns, setOpenRuns] = useState<OperatorRun[] | null>(null);

  // Floor identity (clock-in) state.
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  const [completions, setCompletions] = useState<Completion[] | null>(null);
  const [completionsLoading, setCompletionsLoading] = useState(false);

  const online = useOnlineStatus();
  const [pendingReports, setPendingReports] = useState(() => getQueuedNCRs().length);

  useEffect(() => {
    const saved = localStorage.getItem('hm_operator_name');
    if (saved) setOperatorName(saved);
  }, []);

  // Load the operator roster so staff can tap their name and verify with a PIN.
  useEffect(() => {
    api.getOperatorRoster()
      .then(rows => setRoster(rows))
      .catch(() => setRoster([]))
      .finally(() => setRosterLoaded(true));
  }, []);

  // The stations this tablet could be standing at. Best-effort: a company with
  // none simply has no picker and gets the whole plant's queue.
  useEffect(() => {
    api.getStations()
      .then((rows: Station[]) => setStations(Array.isArray(rows) ? rows.filter(st => st.status === 'active') : []))
      .catch(() => setStations([]));
  }, []);

  // Finalize a verified identity and enter the portal. The whole identity is
  // kept — the id as well as the name — because the id is what attributes the
  // work; a name alone is just text that happens to look like a person.
  const identify = async (who: OperatorIdentity) => {
    const name = who.display_name;
    setOperatorName(name);
    setOperatorUserId(who.id);
    rememberIdentity(who);
    localStorage.setItem('hm_operator_name', name);
    setLoading(true);
    setIdentifyError('');
    try {
      await loadQueue();
      setStep('main');
      setActiveTab('jobs');
      // Everything else fills in behind the first screen — an operator waits
      // for their queue, not for four round trips.
      void loadWorkOrders();
      void loadSnapshot(name, who.id);
      void loadOpenRuns(name);
    } catch (err: any) {
      setIdentifyError(err?.message || "Couldn't load your jobs — please try again.");
    } finally {
      setLoading(false);
    }
  };

  // When connectivity returns, flush any quality reports that were queued while offline.
  useEffect(() => {
    if (!online || pendingReports === 0) return;
    syncQueuedNCRs().then(() => setPendingReports(getQueuedNCRs().length));
  }, [online, pendingReports]);

  // The work orders behind the Report tab's job picker. NOT the jobs list any
  // more — that is the dispatch queue below, which knows about operations and
  // about the apps that need no work order at all.
  const loadWorkOrders = async () => {
    const wos: WorkOrder[] = await api.getWorkOrders();
    const active = wos.filter(wo =>
      wo.app_id &&
      wo.status !== 'completed' &&
      wo.status !== 'cancelled' &&
      wo.quantity_completed < wo.quantity
    );
    setWorkOrders(active);
  };

  /** The queue for this station. The server derives the DEPARTMENT from the
   *  station, so one parameter says both — and a station in no department gets
   *  only the work that names it, rather than the whole plant's. */
  const loadQueue = async (station = stationId) => {
    try {
      const res = await getOperatorQueue({ station_id: station || undefined });
      setQueue(res.rows);
      setQueueError(null);
      // A row that vanished from the queue cannot stay selected under the
      // Start button.
      setSelectedRow(prev => prev && res.rows.some(r => rowKey(r) === rowKey(prev)) ? prev : null);
    } catch (err: any) {
      setQueue([]);
      setQueueError(err?.message || "Couldn't load your jobs");
    }
  };

  /** The plant's day, and this operator's share of it. One call, one answer —
   *  the tile prints it verbatim. */
  const loadSnapshot = async (name = operatorName, userId = operatorUserId) => {
    try {
      setSnapshot(await getFloorSnapshot({
        operator_user_id: userId || undefined,
        operator_name: name.trim() || undefined,
      }));
    } catch {
      setSnapshot(null);
    }
  };

  /** Runs this operator left open, deduplicated to one row per piece of work. */
  const loadOpenRuns = async (name = operatorName) => {
    if (!name.trim()) { setOpenRuns([]); return; }
    try {
      setOpenRuns(dedupeRuns(await getOperatorRuns(name.trim())));
    } catch {
      setOpenRuns([]);
    }
  };

  const loadCompletions = async () => {
    setCompletionsLoading(true);
    try {
      const rows = await api.getCompletions({ operator_name: operatorName.trim(), limit: 50 });
      setCompletions(rows);
    } finally {
      setCompletionsLoading(false);
    }
  };

  const handleNameSubmit = async () => {
    if (!operatorName.trim()) return;
    // Typed by hand: a name, no verified user behind it.
    await identify({ id: null, display_name: operatorName.trim() });
  };

  const handleStartJob = () => {
    if (!selectedRow?.app_id) return;
    navigate(buildPlayLink({
      appId: selectedRow.app_id,
      workOrderId: selectedRow.work_order_id,
      // The exact operation this row offered. Sending only the job would let
      // the player infer which operation that was from the job's pointer — a
      // different answer the moment a colleague advances it.
      operationId: selectedRow.work_order_operation_id,
      operatorName,
      operatorUserId,
      stationId: stationId || null,
      // The way back: this run belongs to the floor, so Done, Exit and
      // Back all return here rather than dropping a tablet into /apps.
      fromOperator: true,
    }));
  };

  /** Back to a run this operator left open, on the unit they left it on. */
  const handleResume = (run: OperatorRun) => {
    navigate(buildPlayLink({
      appId: run.app_id,
      workOrderId: run.work_order_id,
      operationId: run.work_order_operation_id ?? null,
      // THE run, by id. Without it the player has only the job to go on, and a
      // job with two open runs on it is a guess — so it asks, or worse, starts
      // a third. This row is an offer to carry on with a specific unit, and the
      // link says which one.
      runId: run.id,
      operatorName,
      operatorUserId,
      stationId: run.station_id || stationId || null,
      fromOperator: true,
    }));
  };

  /** Move the tablet to another station: the queue is the station's, so it is
   *  reloaded, and the choice is remembered the way the player remembers it. */
  const chooseStation = (next: string) => {
    setStationId(next);
    try {
      if (next) localStorage.setItem('hm_station', next);
      else localStorage.removeItem('hm_station');
    } catch { /* private mode — the choice lasts this visit */ }
    void loadQueue(next);
  };

  const switchOperator = () => {
    setOperatorUserId(null);
    rememberIdentity({ id: null, display_name: '' });
    setStep('name');
    setSelectedRow(null);
    setCompletions(null);
    setSnapshot(null);
    setOpenRuns(null);
    setActiveTab('jobs');
    setManualMode(false);
  };

  // Coming back from a finished unit (/operator?uid=…&station=…): pick the
  // operator back up instead of asking who they are after every single unit.
  // Two locks, because a URL is typed as easily as it is followed: the id must
  // be on the roster this portal already loaded, AND it must be the identity
  // this tab verified with a PIN or badge. Anything else falls through to the
  // normal clock-in screen.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || step !== 'name' || !rosterLoaded) return;
    const uid = searchParams.get('uid');
    if (!uid) return;
    restoredRef.current = true;
    const station = searchParams.get('station');
    if (station) {
      try { localStorage.setItem('hm_station', station); } catch { /* private mode */ }
      setStationId(station);
    }
    const onRoster = roster.find(r => r.id === uid);
    const verified = verifiedIdentity();
    if (!onRoster || !verified || verified.id !== uid) return;
    void identify({ id: onRoster.id, display_name: onRoster.display_name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterLoaded, roster, step, searchParams]);

  // Lazy-load completion history the first time that tab is opened.
  useEffect(() => {
    if (activeTab === 'history' && completions === null && operatorName) {
      loadCompletions();
      // The TODAY tile is the server's count for the plant's day; opening the
      // tab is when it needs to be current.
      void loadSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (step === 'name') {
    return (
      <IdentifyScreen
        roster={roster}
        rosterLoaded={rosterLoaded}
        loading={loading}
        currentUser={user}
        manualMode={manualMode}
        setManualMode={setManualMode}
        operatorName={operatorName}
        setOperatorName={setOperatorName}
        onManualSubmit={handleNameSubmit}
        onIdentify={identify}
        onExit={() => navigate('/dashboard')}
        identifyError={identifyError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
      {/* Compact top bar */}
      <header className="px-4 sm:px-6 pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg flex-shrink-0">
          <Tablet size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-white font-bold text-base leading-tight truncate">Hi, {operatorName}</div>
          <div className="text-blue-200/80 text-xs">
            {activeTab === 'jobs' && 'Your assigned jobs'}
            {activeTab === 'history' && 'Your recent activity'}
            {activeTab === 'report' && 'Report a quality issue'}
            {activeTab === 'profile' && 'Profile & settings'}
          </div>
        </div>
      </header>

      {!online && (
        <div className="px-4 sm:px-6 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-xs font-medium">
            <WifiOff size={14} />
            You're offline — showing cached jobs. New reports will be saved and sent once you're back online.
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 pb-28">
        {activeTab === 'jobs' && (
          <JobsTab
            rows={queue}
            error={queueError}
            selectedRow={selectedRow}
            setSelectedRow={setSelectedRow}
            onStartJob={handleStartJob}
            onRefresh={async () => { await Promise.all([loadQueue(), loadOpenRuns()]); }}
            stations={stations}
            stationId={stationId}
            onChooseStation={chooseStation}
            openRuns={openRuns}
            onResume={handleResume}
            timezone={snapshot?.timezone ?? null}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            completions={completions}
            loading={completionsLoading}
            onRefresh={loadCompletions}
            snapshot={snapshot}
          />
        )}
        {activeTab === 'report' && (
          <ReportTab
            operatorName={operatorName}
            workOrders={workOrders}
            online={online}
            onQueue={() => setPendingReports(getQueuedNCRs().length)}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileTab
            operatorName={operatorName}
            jobCount={queue.length}
            onSwitchOperator={switchOperator}
            pendingReports={pendingReports}
          />
        )}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}

// ── Identify (clock-in) screen ────────────────────────────────────────────────
// Operators verify their floor identity with a PIN or badge so their work is
// attributed to a real account — not free-typed text. Falls back gracefully to
// a name entry when no PINs are set up yet.

function IdentifyScreen({
  roster, rosterLoaded, loading, currentUser, manualMode, setManualMode,
  operatorName, setOperatorName, onManualSubmit, onIdentify, onExit,
  identifyError,
}: {
  roster: RosterEntry[];
  rosterLoaded: boolean;
  loading: boolean;
  currentUser: { id?: string; display_name?: string; role?: string } | null;
  manualMode: boolean;
  setManualMode: (v: boolean) => void;
  operatorName: string;
  setOperatorName: (v: string) => void;
  onManualSubmit: () => void;
  onIdentify: (who: OperatorIdentity) => void;
  onExit: () => void;
  identifyError?: string;
}) {
  const [selectedOp, setSelectedOp] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanError, setScanError] = useState('');

  const anyBadges = roster.some(r => r.has_badge);
  const isSelfOperator = currentUser?.role === 'operator' && !!currentUser.display_name;

  const tapTile = (op: RosterEntry) => {
    setScanError('');
    if (op.has_pin) {
      setSelectedOp(op); setPin(''); setPinError(false);
    } else {
      // No PIN configured for this account — the tile IS the identification the
      // company has set up, so the run is still booked to that real user.
      onIdentify({ id: op.id, display_name: op.display_name });
    }
  };

  const submitPin = async () => {
    if (!selectedOp || pin.length < 4 || verifying) return;
    setVerifying(true); setPinError(false);
    try {
      // { id, display_name } — the id is the point of verifying at all.
      const res = await api.verifyOperatorPin({ user_id: selectedOp.id, pin });
      await onIdentify({ id: res.id, display_name: res.display_name });
    } catch {
      setPinError(true); setPin('');
    } finally {
      setVerifying(false);
    }
  };

  const handleBadge = async (code: string) => {
    setShowScanner(false);
    setScanError('');
    setVerifying(true);
    try {
      const res = await api.verifyOperatorPin({ badge_code: code });
      await onIdentify({ id: res.id, display_name: res.display_name });
    } catch {
      setScanError(`Badge "${code}" not recognized`);
    } finally {
      setVerifying(false);
    }
  };

  const brandBar = (
    <div className="px-6 pt-6 pb-2 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg">
        <Tablet size={20} className="text-white" />
      </div>
      <div>
        <div className="text-white font-bold text-lg leading-tight">HartMonitor</div>
        <div className="text-blue-200/80 text-xs">Operator Portal</div>
      </div>
      {/* The way out, where someone looks for it. The only exit used to be a
          faint line of text at the bottom of the page, which is fine for
          an operator on a locked tablet — they are meant to stay here — and no
          use at all to the person setting the floor up, who bounces between
          this and the management side all day. */}
      <button
        onClick={onExit}
        className="ml-auto shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm font-semibold transition-colors"
      >
        <LayoutDashboard size={16} />
        <span className="hidden sm:inline">Dashboard</span>
      </button>
    </div>
  );

  const footer = (
    <div className="px-6 pb-6 text-center">
      <button onClick={onExit} className="text-xs text-blue-200/80 hover:text-white transition-colors">
        Management Dashboard →
      </button>
    </div>
  );

  // ── PIN keypad for a selected operator ──
  if (selectedOp) {
    const Key = ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
      <button
        onClick={onClick}
        disabled={disabled}
        className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 disabled:opacity-30 text-white text-2xl font-semibold transition-colors flex items-center justify-center"
      >
        {children}
      </button>
    );
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
        {brandBar}
        {showScanner && (
          <BarcodeScannerModal title="Scan Badge" hint="Scan your operator badge" onClose={() => setShowScanner(false)} onScan={handleBadge} />
        )}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-xs">
            <button onClick={() => setSelectedOp(null)} className="flex items-center gap-1.5 text-blue-200/80 hover:text-blue-200 text-sm mb-5 transition-colors">
              <ArrowLeft size={16} /> Choose someone else
            </button>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold">
                {selectedOp.display_name.trim()[0]?.toUpperCase() ?? '?'}
              </div>
              <h1 className="text-xl font-bold text-white">{selectedOp.display_name}</h1>
              <p className="text-blue-200/80 text-sm mt-1 flex items-center justify-center gap-1.5">
                <Lock size={13} /> Enter your PIN
              </p>
            </div>
            {/* PIN dots */}
            <div className={`flex items-center justify-center gap-3 mb-6 ${pinError ? 'animate-pulse' : ''}`}>
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
                <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 ${i < pin.length ? 'bg-blue-400 border-blue-400' : 'border-white/30'}`} />
              ))}
            </div>
            {pinError && <p className="text-center text-sm text-red-300 mb-4">Incorrect PIN — try again</p>}
            <div className="grid grid-cols-3 gap-3">
              {['1','2','3','4','5','6','7','8','9'].map(d => (
                <Key key={d} onClick={() => { setPinError(false); setPin(p => (p.length < 8 ? p + d : p)); }}>{d}</Key>
              ))}
              <Key onClick={() => setPin('')}>
                <span className="text-sm font-medium text-blue-200/80">Clear</span>
              </Key>
              <Key onClick={() => { setPinError(false); setPin(p => (p.length < 8 ? p + '0' : p)); }}>0</Key>
              <Key onClick={() => setPin(p => p.slice(0, -1))}><Delete size={22} /></Key>
            </div>
            {/* Fading the whole button to 40% took its own label down to 2.8:1,
                and an operator on a bright floor is looking straight at it while
                they punch the PIN. The fill alone says "not yet" — deep navy in
                place of the vivid enabled blue — and the label stays readable. */}
            <button
              onClick={submitPin}
              disabled={pin.length < 4 || verifying}
              className="mt-5 w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-2"
            >
              {verifying ? <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Clock In <ChevronRight size={20} /></>}
            </button>
            {selectedOp.has_badge && (
              <button onClick={() => setShowScanner(true)} className="mt-3 w-full text-sm text-blue-200/80 hover:text-blue-200 flex items-center justify-center gap-1.5 transition-colors">
                <ScanLine size={14} /> Scan badge instead
              </button>
            )}
          </div>
        </div>
        {footer}
      </div>
    );
  }

  // ── Manual fallback: free-text name entry ──
  if (manualMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
        {brandBar}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            {roster.length > 0 && (
              <button onClick={() => setManualMode(false)} className="flex items-center gap-1.5 text-blue-200/80 hover:text-blue-200 text-sm mb-5 transition-colors">
                <ArrowLeft size={16} /> Back to operator list
              </button>
            )}
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-blue-500/30">
                <User size={36} className="text-blue-400" />
              </div>
              <h1 className="text-3xl font-bold text-white">Welcome</h1>
              <p className="text-blue-200/80 text-sm mt-2">Enter your name to see your assigned jobs</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-blue-200 mb-2">Your Name</label>
                <input
                  className="w-full h-14 rounded-xl bg-white/10 border border-white/20 text-white text-lg px-4 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
                  placeholder="Enter your name..."
                  value={operatorName}
                  onChange={e => setOperatorName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onManualSubmit()}
                  autoComplete="name"
                />
              </div>
              <button
                onClick={onManualSubmit}
                disabled={!operatorName.trim() || loading}
                className="w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-blue-900/50"
              >
                {loading ? <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>See My Jobs <ChevronRight size={20} /></>}
              </button>
            </div>
          </div>
        </div>
        {footer}
      </div>
    );
  }

  // ── Primary: operator roster picker ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
      {brandBar}
      {showScanner && (
        <BarcodeScannerModal title="Scan Badge" hint="Scan your operator badge to clock in" onClose={() => setShowScanner(false)} onScan={handleBadge} />
      )}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="w-full max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-3 border-2 border-blue-500/30">
              <UsersIcon size={30} className="text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">Who's working?</h1>
            <p className="text-blue-200/80 text-sm mt-1">Tap your name to clock in</p>
          </div>

          {isSelfOperator && (
            <button
              onClick={() => onIdentify({ id: currentUser!.id ?? null, display_name: currentUser!.display_name! })}
              disabled={loading}
              className="w-full mb-4 h-14 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-base transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40"
            >
              Continue as {currentUser!.display_name} <ChevronRight size={18} />
            </button>
          )}

          {scanError && (
            <div className="mb-4 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-sm text-center">{scanError}</div>
          )}

          {identifyError && (
            <div className="mb-4 bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl px-3 py-2 text-sm text-center">{identifyError}</div>
          )}

          {!rosterLoaded ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-20 bg-white/5 rounded-2xl animate-pulse" />)}
            </div>
          ) : roster.length === 0 ? (
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-8 text-center">
              <KeyRound size={32} className="mx-auto mb-3 text-blue-200/80" />
              <div className="text-white font-semibold">No operators set up yet</div>
              <div className="text-blue-200/80 text-sm mt-1">Ask your manager to add operators (with PINs) in Settings → Users.</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {roster.map(op => (
                <button
                  key={op.id}
                  onClick={() => tapTile(op)}
                  disabled={verifying}
                  className="h-20 rounded-2xl border-2 border-white/10 bg-white/10 hover:bg-white/15 hover:border-white/25 active:bg-white/20 transition-all p-3 flex flex-col items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {op.display_name.trim()[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span className="text-white text-sm font-semibold truncate">{op.display_name}</span>
                  </div>
                  {op.has_pin
                    ? <span className="flex items-center gap-1 text-[11px] text-blue-200/80"><Lock size={10} /> PIN</span>
                    : <span className="text-[11px] text-blue-200/80">Tap to start</span>}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-3">
            {anyBadges && (
              <button
                onClick={() => { setScanError(''); setShowScanner(true); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-blue-200 text-sm font-medium transition-colors"
              >
                <ScanLine size={16} /> Scan badge
              </button>
            )}
            <button onClick={() => { setOperatorName(''); setManualMode(true); }} className="text-xs text-blue-200/80 hover:text-white transition-colors">
              Continue without a PIN
            </button>
          </div>
        </div>
      </div>
      {footer}
    </div>
  );
}

// ── Bottom tab navigation ──────────────────────────────────────────────────────

function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'jobs', label: 'Jobs', icon: Briefcase },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'report', label: 'Report', icon: AlertTriangle },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-[#0a1628]/95 backdrop-blur-sm border-t border-white/10 grid grid-cols-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
              isActive ? 'text-blue-400' : 'text-blue-200/80 hover:text-white'
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Jobs tab ─────────────────────────────────────────────────────────────────
//
// What THIS operator should run next, at the station this tablet is standing
// at — the server's dispatch queue, in priority → due date → sequence order.
//
// It used to list WORK ORDERS, which had two consequences on every floor that
// runs anything but one app per job:
//
//   * 'Final QC Inspection' — published, runnable, attached to no work order —
//     could not appear at all, so the header said "2 jobs available" about a
//     floor with three things to do, and the tablet meant to run it had no way
//     in.
//   * A seven-operation job read as one row with no idea which operation was
//     next, so an operator started whatever the job's app happened to be.
//
// Every row now says which operation it is ("Op 3 of 7 · Weld") or that it
// needs no work order, and Start carries the operation id through to the
// player so the booking lands where the queue said it would.

function JobsTab({
  rows, error, selectedRow, setSelectedRow, onStartJob, onRefresh,
  stations, stationId, onChooseStation, openRuns, onResume, timezone,
}: {
  rows: DispatchRow[];
  error: string | null;
  selectedRow: DispatchRow | null;
  setSelectedRow: (row: DispatchRow | null) => void;
  onStartJob: () => void;
  onRefresh: () => Promise<void>;
  stations: Station[];
  stationId: string;
  onChooseStation: (id: string) => void;
  openRuns: OperatorRun[] | null;
  onResume: (run: OperatorRun) => void;
  /** The zone the SERVER reports the plant in. Every stamp below is printed in
   *  it — never the tablet's own, which on an unboxed kiosk is a guess. */
  timezone: string | null;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [allResume, setAllResume] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const handleScan = (code: string) => {
    setShowScanner(false);
    const normalized = code.trim().toLowerCase();
    const match = rows.find(row =>
      (row.work_order_number ?? '').toLowerCase() === normalized ||
      (row.part_number ?? '').toLowerCase() === normalized
    );
    if (match) {
      setSelectedRow(match);
      setScanMessage('');
    } else {
      setScanMessage(`No job found matching "${code}"`);
    }
  };

  const resumable = openRuns ?? [];
  const resumeShown = allResume ? resumable : resumable.slice(0, RESUME_VISIBLE);
  const resumeHidden = resumable.length - resumeShown.length;

  return (
    <div>
      {showScanner && (
        <BarcodeScannerModal
          title="Scan Job Barcode"
          hint="Scan a work order or part barcode to select that job"
          onClose={() => setShowScanner(false)}
          onScan={handleScan}
        />
      )}

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        {/* The count is what the LIST shows. It used to count work orders while
            the list showed something else. */}
        <p className="text-blue-200/80 text-sm" data-testid="jobs-count">
          {rows.length > 0
            ? `${rows.length} job${rows.length !== 1 ? 's' : ''} available`
            : 'No jobs scheduled yet'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setScanMessage(''); setShowScanner(true); }}
            className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors min-h-[44px]"
          >
            <ScanLine size={13} />
            Scan
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors disabled:opacity-50 min-h-[44px]"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Where this tablet is standing. The queue is the STATION's — and the
          server reads the department off the station, so one choice says both. */}
      {stations.length > 0 && (
        <label className="flex items-center gap-2 mb-3">
          <Tablet size={14} className="text-blue-300 flex-shrink-0" aria-hidden="true" />
          <span className="sr-only">Station</span>
          <select
            aria-label="Station"
            value={stationId}
            onChange={e => onChooseStation(e.target.value)}
            className="dark flex-1 min-w-0 h-11 rounded-xl bg-white/10 border border-white/15 text-white text-sm px-3"
          >
            <option value="">All stations</option>
            {stations.map(st => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
        </label>
      )}

      {scanMessage && (
        <div className="mb-3 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-sm">
          {scanMessage}
        </div>
      )}

      {error && (
        <div className="mb-3 bg-red-500/15 border border-red-500/30 text-red-200 rounded-xl px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {/* ── Jobs in progress ────────────────────────────────────────────────
          One row per piece of work, not one per row nobody has closed. A tablet
          that reloads mid-run leaves a second completion open behind it, and
          the reaper only closes an abandoned run after twelve hours — so this
          used to be an uncapped pile of identical rows stamped in raw UTC.
          These rows HIDE duplicates; nothing here closes anybody's run, least
          of all another operator's. */}
      {resumable.length > 0 && (
        <div className="mb-4" data-testid="jobs-in-progress">
          <div className="text-white font-semibold text-sm mb-2">Jobs in progress</div>
          <div className="space-y-2">
            {resumeShown.map(run => (
              <div
                key={run.id}
                data-testid="resume-row"
                className="bg-blue-500/10 border border-blue-400/30 rounded-xl p-3 flex items-center gap-3 min-h-[44px]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{run.app_name}</div>
                  <div className="text-blue-200/80 text-xs truncate">
                    Started {stampIn(run.started_at, timezone ?? 'UTC')}
                  </div>
                </div>
                <button
                  onClick={() => onResume(run)}
                  className="flex-shrink-0 min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-colors"
                >
                  Resume
                </button>
              </div>
            ))}
          </div>
          {(resumeHidden > 0 || allResume) && (
            <button
              onClick={() => setAllResume(v => !v)}
              className="w-full min-h-[44px] mt-2 text-xs font-semibold text-blue-300 hover:text-white transition-colors"
            >
              {allResume ? 'Show fewer' : `Show all ${resumable.length}`}
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-10 text-center">
          <CheckCircle size={40} className="mx-auto mb-3 text-green-400" />
          <div className="text-white font-semibold text-lg">All caught up!</div>
          <div className="text-blue-200/80 text-sm mt-1">
            {stationId
              ? 'Nothing is ready at this station right now'
              : 'Nothing is ready to run right now'}
          </div>
          <div className="text-blue-200/80 text-xs mt-3">Check with your supervisor for new assignments</div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const required = row.quantity_required ?? 0;
            const done = row.quantity_completed ?? 0;
            const pct = required > 0 ? Math.round((done / required) * 100) : null;
            const isSelected = selectedRow ? rowKey(selectedRow) === rowKey(row) : false;
            const title = row.no_work_order
              ? (row.app_name ?? 'Standing job')
              : (row.part_name || row.work_order_number || row.app_name || 'Job');
            return (
              <button
                key={rowKey(row)}
                data-testid="job-row"
                onClick={() => setSelectedRow(isSelected ? null : row)}
                className={`w-full text-left rounded-2xl border-2 p-4 min-h-[44px] transition-all ${
                  isSelected
                    ? 'border-blue-400 bg-blue-600/20 shadow-lg shadow-blue-900/30'
                    : 'border-white/10 bg-white/10 hover:bg-white/15 hover:border-white/20'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
                    style={{ backgroundColor: PRIORITY_COLORS[row.priority ?? ''] || '#9ca3af' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-white font-bold text-base leading-tight truncate">{title}</div>
                        {/* The job's identity. A standing app has none — and
                            printing its own name twice reads as two facts. */}
                        {row.work_order_number && (
                          <div className="text-blue-200/80 text-xs mt-0.5 font-mono truncate">
                            {row.work_order_number}{row.part_number ? ` · ${row.part_number}` : ''}
                          </div>
                        )}
                      </div>
                      {isSelected && (
                        <div className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                          <CheckCircle size={14} className="text-white" />
                        </div>
                      )}
                    </div>

                    {/* Which operation this is — a fact the job carries, not a
                        caption this screen invented. */}
                    <div className="mt-2 text-xs font-semibold text-blue-100">
                      {dispatchRowLabel(row)}
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs flex-wrap">
                      {required > 0 && (
                        <div className="flex items-center gap-1 text-blue-200/80">
                          <Package size={12} />
                          {done} / {required} units
                        </div>
                      )}
                      {row.status === 'running' && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/20 text-green-200">
                          Running now
                        </span>
                      )}
                      {row.department_name && (
                        // A department's colour is picked from a colour well and
                        // then written on a chip tinted with itself, which for a
                        // mid-blue landed at 2.4:1. The tint stays; only the ink
                        // moves, and only as far as AA needs.
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={tintedChipOn(row.department_color, CARD_SURFACE_LIGHTEST)}
                        >
                          {row.department_name}
                        </span>
                      )}
                      {row.app_id ? (
                        row.app_name && !row.no_work_order && (
                          <span className="text-blue-200/80 truncate">{row.app_name}</span>
                        )
                      ) : (
                        // A routing step with no app is a gap somebody has to
                        // fix, not a row to hide.
                        <span className="text-amber-300">{row.app_reason ?? 'no app on this operation'}</span>
                      )}
                      {row.due_date && (
                        <div className="flex items-center gap-1 text-blue-200/80 ml-auto">
                          <AlertTriangle size={11} />
                          Due {dueLabel(row.due_date)}
                        </div>
                      )}
                    </div>

                    {pct !== null && (
                      <div className="mt-2.5">
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-400 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-xs text-blue-200/80 mt-0.5">{pct}% complete</div>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {/* Keep the last card reachable above the floating Start bar */}
          {selectedRow && <div className="h-24" aria-hidden="true" />}
        </div>
      )}

      {/* Start button — floats above the tab bar; on notched phones the tab bar
          grows by the safe-area inset, so the offset has to follow it. */}
      {selectedRow && (
        <div className="fixed inset-x-4 sm:inset-x-6 z-30" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
          <button
            onClick={onStartJob}
            disabled={!selectedRow.app_id}
            className="w-full h-16 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-2xl font-bold text-xl transition-colors flex items-center justify-center gap-3 shadow-2xl shadow-blue-900/50"
          >
            <Factory size={24} className="flex-shrink-0" />
            <span className="truncate min-w-0">
              Start: {selectedRow.no_work_order
                ? (selectedRow.app_name ?? 'this app')
                : (selectedRow.part_name || selectedRow.work_order_number || 'this job')}
            </span>
            <ChevronRight size={22} className="flex-shrink-0" />
          </button>
          {!selectedRow.app_id && (
            <p className="text-center text-xs text-amber-300 mt-2">
              {selectedRow.app_reason ?? 'No app on this operation'} — contact your supervisor
            </p>
          )}
        </div>
      )}
    </div>
  );
}


// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({
  completions, loading, onRefresh, snapshot,
}: {
  completions: Completion[] | null;
  loading: boolean;
  onRefresh: () => void;
  /** The plant's own day, and this operator's share of it. The tile prints the
   *  server's number verbatim; it does not count rows for itself. */
  snapshot: FloorSnapshot | null;
}) {
  const list = completions ?? [];
  const totalCompleted = list.filter(c => c.status === 'completed').length;
  // TODAY is the PLANT's day, measured server-side. This screen counted it off
  // the tablet's browser clock, so a second-shift crew's tile reset at their
  // own midnight while the Command Center carried on with the plant's — the
  // same minute, two different answers, and the tablet's was the wrong one.
  const finishedToday = snapshot?.finished_today_for_operator ?? null;
  const todayReason = snapshot?.finished_today_for_operator_reason
    ?? (snapshot ? null : 'today\u2019s count has not loaded yet');

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4" data-testid="today-tile">
          <div className="text-blue-200/80 text-xs font-medium uppercase tracking-wide">Today</div>
          <div className="text-white text-3xl font-bold mt-1">{finishedToday ?? '—'}</div>
          <div className="text-blue-200/80 text-xs mt-0.5">
            {finishedToday != null
              ? `units completed${snapshot?.plant_date ? ` · ${snapshot.plant_date}` : ''}`
              : (todayReason ?? 'not measured yet')}
          </div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
          <div className="text-blue-200/80 text-xs font-medium uppercase tracking-wide">Recent</div>
          <div className="text-white text-3xl font-bold mt-1">{totalCompleted}</div>
          <div className="text-blue-200/80 text-xs mt-0.5">total in history</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold text-sm">Recent activity</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && completions === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-10 text-center">
          <HistoryIcon size={36} className="mx-auto mb-3 text-blue-200/80" />
          <div className="text-white font-semibold">No activity yet</div>
          <div className="text-blue-200/80 text-sm mt-1">Completed and started jobs will show up here</div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(c => {
            // How long the run took, by the ONE definition in appModel — the
            // same one the run's own page and the app history print. A run
            // nobody timed says so; it does not print 0s, and it does not print
            // a bare dash either.
            const seconds = runDurationSeconds(c);
            const basis = durationBasisLabel(c.step_times && Object.keys(c.step_times).length > 0 ? 'hands_on' : 'elapsed');
            return (
              <div key={c.id} className="bg-white/10 rounded-xl border border-white/10 p-3 flex items-center gap-3 min-h-[44px]" data-testid="history-row">
                <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Factory size={16} className="text-blue-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{c.app_name}</div>
                  <div className="text-blue-200/80 text-xs">
                    {c.status === 'completed' ? timeAgo(c.completed_at || c.started_at) : `Started ${timeAgo(c.started_at)}`}
                  </div>
                  <div className="text-blue-200/80 text-xs" data-testid="history-duration">
                    {seconds != null
                      ? `${fmtDuration(seconds)}${basis ? ` · ${basis}` : ''}`
                      : `— · ${c.status === 'in_progress' ? 'still running' : 'no timing was recorded'}`}
                  </div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full capitalize flex-shrink-0 ${COMPLETION_STATUS_BADGE[c.status] || 'bg-gray-500/15 text-gray-300'}`}>
                  {c.status.replace('_', ' ')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Report Issue tab ────────────────────────────────────────────────────────

function ReportTab({
  operatorName, workOrders, online, onQueue,
}: {
  operatorName: string;
  workOrders: WorkOrder[];
  online: boolean;
  onQueue: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('minor');
  const [workOrderId, setWorkOrderId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setSeverity('minor');
    setWorkOrderId('');
    setSubmitted(null);
    setQueuedOffline(false);
    setError('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Please describe the issue in the title.'); return; }
    setSaving(true);
    setError('');
    const wo = workOrders.find(w => w.id === workOrderId);
    const descPrefix = `Reported by ${operatorName.trim()} from the shop floor.`;
    const payload = {
      title: title.trim(),
      description: description.trim() ? `${descPrefix}\n\n${description.trim()}` : descPrefix,
      severity,
      source: 'production',
      work_order_id: workOrderId || undefined,
      app_id: wo?.app_id || undefined,
    };
    if (!online) {
      queueNCR(payload);
      onQueue();
      setQueuedOffline(true);
      setSubmitted('queued');
      setSaving(false);
      return;
    }
    try {
      const ncr = await api.createNCR(payload);
      setSubmitted(ncr.ncr_number);
    } catch (e: any) {
      setError(e.message || 'Failed to submit report');
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-8 text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-2 ${queuedOffline ? 'bg-amber-500/20 border-amber-400/30' : 'bg-green-500/20 border-green-400/30'}`}>
          {queuedOffline ? <WifiOff size={32} className="text-amber-400" /> : <CheckCircle size={32} className="text-green-400" />}
        </div>
        {queuedOffline ? (
          <>
            <div className="text-white font-bold text-lg">Saved offline</div>
            <div className="text-blue-200/80 text-sm mt-1">Your report will be submitted automatically once you're back online.</div>
          </>
        ) : (
          <>
            <div className="text-white font-bold text-lg">Issue reported</div>
            <div className="text-blue-200/80 text-sm mt-1">NCR <span className="font-mono">{submitted}</span> has been created</div>
            <div className="text-blue-200/80 text-xs mt-2">Your supervisor and quality team will follow up.</div>
          </>
        )}
        <button
          onClick={reset}
          className="mt-6 w-full h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
        >
          Report another issue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">What's wrong? *</label>
        <input
          className="w-full h-12 rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
          placeholder="e.g. Bad weld on bracket"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">Details</label>
        <textarea
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 py-3 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15 resize-none"
          rows={4}
          placeholder="Describe what happened, what part, what station..."
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">Severity</label>
        <div className="grid grid-cols-3 gap-2">
          {SEVERITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSeverity(opt.value)}
              className={`h-11 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
                severity === opt.value ? opt.activeClass : 'border-white/10 bg-white/5 text-blue-200/80 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {workOrders.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-blue-200 mb-1.5">Related Job (optional)</label>
          <select
            className="w-full h-12 rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
            value={workOrderId}
            onChange={e => setWorkOrderId(e.target.value)}
          >
            <option value="" className="text-gray-900">No specific job</option>
            {workOrders.map(wo => (
              <option key={wo.id} value={wo.id} className="text-gray-900">
                {wo.work_order_number} — {wo.part_name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Same as Clock In: a half-faded button takes its own label down with it
          (3.7:1 here). The deep fill carries "not yet"; the label stays readable
          so an operator can see what they are about to do. */}
      <button
        onClick={handleSubmit}
        disabled={!title.trim() || saving}
        className="w-full h-14 bg-red-600 hover:bg-red-500 disabled:bg-red-950 disabled:cursor-not-allowed text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-red-900/30"
      >
        {saving ? (
          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : online ? (
          <>Submit Report <Send size={18} /></>
        ) : (
          <>Save Offline <WifiOff size={18} /></>
        )}
      </button>
    </div>
  );
}

// ── Messages card ───────────────────────────────────────────────────────────

const MESSAGE_SEVERITY_DOT: Record<MessageSeverity, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
};

function MessagesCard() {
  const { messages, unreadCount, markAllRead } = useMessages();
  const recent = messages.slice(0, 5);

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare size={16} className="text-blue-300" />
        <div className="text-white font-semibold text-sm">Messages</div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="ml-auto text-[11px] font-medium text-blue-300 hover:text-blue-200 transition-colors"
          >
            Mark {unreadCount} read
          </button>
        )}
      </div>
      {recent.length === 0 ? (
        <div className="text-blue-200/80 text-xs py-2">No messages yet</div>
      ) : (
        <div className="space-y-2">
          {recent.map(m => (
            <div key={m.id} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${MESSAGE_SEVERITY_DOT[m.severity] ?? MESSAGE_SEVERITY_DOT.info}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-white text-xs font-medium truncate">{m.sender_name}</span>
                  <span className="text-blue-200/80 text-[10px] flex-shrink-0">{timeAgo(m.created_at)}</span>
                </div>
                <div className="text-blue-200/80 text-xs break-words">{m.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profile tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  operatorName, jobCount, onSwitchOperator, pendingReports,
}: {
  operatorName: string;
  jobCount: number;
  onSwitchOperator: () => void;
  pendingReports: number;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold">
          {operatorName.trim()[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="text-white font-bold text-lg">{operatorName}</div>
        <div className="text-blue-200/80 text-xs mt-1">Shop Floor Operator</div>
      </div>

      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
          <Briefcase size={18} className="text-blue-300" />
        </div>
        <div>
          <div className="text-white font-semibold">{jobCount} job{jobCount !== 1 ? 's' : ''} assigned</div>
          <div className="text-blue-200/80 text-xs">Visible on the Jobs tab</div>
        </div>
      </div>

      {pendingReports > 0 && (
        <div className="bg-amber-500/10 backdrop-blur-sm rounded-2xl border border-amber-500/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <WifiOff size={18} className="text-amber-400" />
          </div>
          <div>
            <div className="text-white font-semibold">{pendingReports} report{pendingReports !== 1 ? 's' : ''} pending sync</div>
            <div className="text-amber-300/70 text-xs">Will be submitted automatically once you're online</div>
          </div>
        </div>
      )}

      <MessagesCard />

      <div className="space-y-2 pt-2">
        <button
          onClick={onSwitchOperator}
          className="w-full h-12 bg-white/10 hover:bg-white/15 border border-white/10 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft size={16} />
          Switch operator
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-blue-200/80 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={16} />
          Management Dashboard
        </button>
      </div>
    </div>
  );
}
