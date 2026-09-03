// ─── Operator Player (remodeled — spec §5) ────────────────────────────────────
// Dark full-screen tablet runtime. All navigation flows through one pipeline:
// standing validation gate → step_exit triggers → commit → step_enter triggers.
// Legacy v1 apps (normalized via normalizeApp) play with identical outcomes:
// required-field gating, takt alarms, work-order advance and completion data
// keys are unchanged. Preview mode (?preview=1) writes nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, BadgeCheck, ChevronDown, ChevronUp, Factory,
  Hash, Loader2, Lock, MessageSquare, Package, ScanLine, ShieldCheck, Tag, X, Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { getAppDraft } from '../api/revisions';
import {
  startRun as startRunRequest, notQualified, verifyOverrideAuthorizer, mintOverrideToken,
} from '../api/training';
import type { NotQualified, StartRunPayload } from '../api/training';
import { fmtDuration, pluralize } from '../components/apps/appModel';
import { useAuth } from '../context/AuthContext';
import { setRunActive } from '../utils/staleChunk';
import type { CompletionFlushPayload, CompletionSession, JobInProgress, KitLineUpdate } from '../api/client';
import type {
  App, Step, Widget, WorkOrder, ProductType, Station,
  Kit, KitLine, KitStatus, BOM, BOMLine, NCRSeverity,
  AndonCall, Department,
} from '../types';
import { normalizeApp, runTriggers } from '../engine';
import type { TriggerEffect, TriggerRuntimeState } from '../engine';
import {
  getOutbox, removeOutboxItem, enqueueOutbox, flushOutbox, pendingCount,
  queueNCR, subscribeOutbox,
} from '../utils/offlineQueue';
import { CanvasStage } from '../components/app/WidgetView';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import PlayerShell from '../components/player/PlayerShell';
import type { PlayerToast } from '../components/player/PlayerShell';
import PlayerHeader from '../components/player/PlayerHeader';
import PlayerFooter from '../components/player/PlayerFooter';
import BlockBanner from '../components/player/BlockBanner';
import KitPanel, { KitSummaryBar } from '../components/player/KitPanel';
import RunSummary from '../components/player/RunSummary';
import PlayerWidget from '../components/player/PlayerWidgets';
import RequestHelpSheet from '../components/player/RequestHelpSheet';
import QualificationSheet from '../components/player/QualificationSheet';
import AlertBanner from '../components/player/AlertBanner';
import { targetLabel, targetPayload } from '../config/andonTeams';
import type { AlertTarget } from '../config/andonTeams';
import { subscribeRealtime, isAndonEvent } from '../utils/realtime';
import {
  claimSideEffect, collectStepTriggers, concurrentHoldReason, concurrentRun, evaluateKitScan,
  exitTarget, formatDur,
  getStepBlocks, kitProgress, kitWidgetFor, legacyKey, operatorAttribution,
  operatorDisplayName, operatorReturnLink, playableWorkOrders, routedLookupCandidates,
  runContextGate, runContextRequired, setupNeeded,
  sideEffectKey, stepHidesFooterNav, stepShowsKit, stepTaktSeconds as taktOfStep,
  resumeTarget, stepValueSignature, summarizeBlocks, taktBarState, unitsBalance, unitsSummary,
  valueInputFor,
} from '../components/player/runtime';
import type { BlockItem } from '../components/player/runtime';
import { getReasonCodes } from '../api/andon';
import type { ReasonCode } from '../api/andon';
import { getOperations } from '../api/operations';
import { getDemoHints } from '../api/operator';
import type { DemoHints } from '../api/operator';
import { displayId, hasCompanyTag } from '../utils/ids';
import '../player.css';

// Work-order fields added by the v2 backend (list returns wo.*).
interface WorkOrderExt extends WorkOrder {
  product_type_id?: string | null;
}

/** What the finish step counted. Only ever sent when somebody typed it. */
interface RunCounts {
  good: number;
  scrap: number;
  rework: number;
  scrapReasonCodeId: string;
}

/** The finishing PUT: the flush payload plus the counts. The count fields are
 *  added here rather than in api/client.ts because they are only ever sent by
 *  this one screen, on one request, at the end of a run. */
type FinishPayload = CompletionFlushPayload & {
  quantity_good?: number;
  quantity_scrap?: number;
  quantity_rework?: number;
  scrap_reason_code_id?: string;
};

// App field written by the builder's run-context toggle (contract:
// app.require_run_context; absent → enforce only for schema_version ≥ 2).
// The backend column is a nullable SQLite INTEGER, so the wire value is 0 / 1.
interface AppExt extends App {
  require_run_context?: boolean | number | null;
}

type RunStatus = 'setup' | 'running' | 'completed' | 'abandoned';
type NavIntent = { to: 'next' | 'prev' | 'step' | 'complete'; stepId?: string };

type KitState = Kit & { lines: KitLine[] };
type BOMState = BOM & { lines: BOMLine[] };

interface DebugEntry { id: number; ts: string; text: string; }

function toPrimitive(v: unknown): string | number | boolean {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

let debugSeq = 0;
let toastSeq = 0;

export default function AppPlayer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get('preview') === '1';
  const { user, canAccessReportPortal } = useAuth();
  // How this run was entered decides where it lets go. A tablet that came from
  // the Operator Portal goes back to the Operator Portal — never to /apps,
  // which is an unlocked manager console with a builder in it.
  const enteredFromOperator = searchParams.get('from') === 'operator';
  /**
   * A dispatch-board link (?from=dispatch). It carries no uid — a uid in a URL
   * is a claim anybody can copy, and the Operator Portal's uid is one a badge
   * reader verified. Whoever followed this link is signed in, and their session
   * is proof the server already checked, so THEY are the operator.
   */
  const enteredFromDispatch = searchParams.get('from') === 'dispatch';
  const exitPath = exitTarget({ fromOperator: enteredFromOperator, role: user?.role });

  // ── Loading / catalog state ────────────────────────────────────────────────
  const [app, setApp] = useState<App | null>(null);
  /** Every open work order the server returned — the LOOKUP table. A run's job
   *  is named from here whatever list the picker happens to offer, so a routed
   *  job never reads "No work order" on a screen that is running it. */
  const [allWorkOrders, setAllWorkOrders] = useState<WorkOrderExt[]>([]);
  /** Work orders whose OPERATIONS run this app (resolved from
   *  GET /work-orders/:id/operations). A routed job carries its app there, not
   *  on the work order row, so this is the only way to recognise one. */
  const [routedWorkOrderIds, setRoutedWorkOrderIds] = useState<ReadonlySet<string>>(() => new Set());
  /** The PINs a sandbox hands out, when the server says this is one. Null on
   *  every real company — see api/operator.getDemoHints. */
  const [demoHints, setDemoHints] = useState<DemoHints | null>(null);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Setup state ────────────────────────────────────────────────────────────
  const [operatorName, setOperatorName] = useState('');
  const [operatorUserId, setOperatorUserId] = useState<string | null>(null);
  const [badgeInput, setBadgeInput] = useState('');
  const [badgeError, setBadgeError] = useState('');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [selectedProductTypeId, setSelectedProductTypeId] = useState('');
  const [productTypeLocked, setProductTypeLocked] = useState(false);
  const [selectedStationId, setSelectedStationId] = useState(() => localStorage.getItem('hm_station') || '');
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Run context (player batch B): typed part number when no work order is chosen,
  // and whether this app enforces context (raw require_run_context / schema_version).
  const [manualPartNumber, setManualPartNumber] = useState('');
  const [requireContext, setRequireContext] = useState(false);
  // Qualification gate (only ever engaged when the company set Warn or Block).
  // qualBlock holds the server's refusal verbatim so the sheet can name the
  // app, the operator and the expiry date rather than paraphrasing them.
  const [qualBlock, setQualBlock] = useState<NotQualified | null>(null);
  const [qualSubmitting, setQualSubmitting] = useState(false);
  const [qualError, setQualError] = useState('');
  /** A single-use supervisor proof, spent by the very next start attempt. */
  const overrideProofRef = useRef<string | null>(null);
  /** The run is skipped straight past setup at most once per visit. */
  const autoStartedRef = useRef(false);
  /** A ?run= link is followed at most once, whether or not it resolved. */
  const resumeParamRef = useRef(false);
  /**
   * Something the LINK asked for could not be done — the named run has since
   * been finished or handed on. Not an error the operator caused, so it is said
   * plainly and the normal flow carries on underneath it.
   */
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  /**
   * Did the deep link name the station, or is this just the last station this
   * browser happened to use? Only the first is a fact about where the operator
   * is standing. hm_station is a helpful default to PRESELECT; silently booking
   * a run to it — on a tablet that was carried to another cell, or a spare
   * picked off a bench — attributes work to the wrong machine and nobody sees
   * a screen that says so.
   */
  const stationFromLink = searchParams.get('station') !== null;
  /** The work order the link named, if any. The portal already decided which
   *  job this tablet is running; the picker believes it rather than re-deriving
   *  it from a column a routed job leaves NULL. */
  const woFromLink = searchParams.get('wo');
  /** The operation of that job the dispatch queue sent this tablet to. */
  const opFromLink = searchParams.get('op');
  /** The operator has seen the concurrent-run warning and chosen to go on. */
  const [concurrentAck, setConcurrentAck] = useState(false);
  /** Abandoning is a destructive choice, so it gets a sheet that says what is
   *  lost — not a browser confirm() next to "Leave job (save progress)". */
  const [abandonOpen, setAbandonOpen] = useState(false);
  // Multi-operator sessions (player batch C)
  const [jobs, setJobs] = useState<JobInProgress[]>([]);
  /** Whether the in-progress list has come back yet. Auto-start waits for it,
   *  so a silent skip can never step over a concurrent run on the same unit. */
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Takt polish (player batch A3): one-time full-screen flash at takt zero
  const [taktFlash, setTaktFlash] = useState(false);

  // ── Units this run (finish step) ───────────────────────────────────────────
  // The operation of the job these units book against, carried by the dispatch
  // deep link as ?op=. Absent for a run started from the app library, which is
  // exactly the pre-existing behaviour: the run books against the job's current
  // operation server-side, or against nothing at all when there is no job.
  const [operationId, setOperationId] = useState('');
  /** The finish sheet is open: one screen, four numbers, two taps. */
  const [finishOpen, setFinishOpen] = useState(false);
  const [unitsRun, setUnitsRun] = useState(1);
  const [unitsGood, setUnitsGood] = useState(1);
  const [unitsScrap, setUnitsScrap] = useState(0);
  const [unitsRework, setUnitsRework] = useState(0);
  const [unitsReasonId, setUnitsReasonId] = useState('');
  /** Nobody touched the control ⇒ the run sends NO counts and the server
   *  stores NULLs. "Nobody counted" and "counted zero" are different facts. */
  const [unitsTouched, setUnitsTouched] = useState(false);
  const [unitsError, setUnitsError] = useState('');
  const [scrapCodes, setScrapCodes] = useState<ReasonCode[]>([]);
  /** What the finished run recorded, for the summary line. */
  const [unitsLabel, setUnitsLabel] = useState('');

  // ── Run state ──────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<RunStatus>('setup');
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [variables, setVariables] = useState<Record<string, string | number | boolean>>({});
  const [stepTimes, setStepTimes] = useState<Record<number, number>>({});
  const [stepElapsed, setStepElapsed] = useState(0);
  const [taktExceededSteps, setTaktExceededSteps] = useState<number[]>([]);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [kit, setKit] = useState<KitState | null>(null);
  const [bomFallback, setBomFallback] = useState<BOMState | null>(null);
  const [photoGates, setPhotoGates] = useState<Record<string, string>>({});
  const [blockBanner, setBlockBanner] = useState<string | null>(null);
  /** The widget the last refused forward tap pointed at — scrolled to, ringed
   *  and named. Cleared as soon as the step is satisfied or changes. */
  const [blockedWidgetId, setBlockedWidgetId] = useState<string | null>(null);
  /** The block the banner is currently explaining, so the banner can retire
   *  itself the moment that block is answered — a red bar still demanding a
   *  result the operator has already given is the player lying to them. */
  const [gateBlock, setGateBlock] = useState<BlockItem | null>(null);
  /** A forward tap has been refused on this step: required fields may now show
   *  their ring. Before the first tap, an untouched form is not "wrong" yet. */
  const [navAttempted, setNavAttempted] = useState(false);
  const [toasts, setToasts] = useState<PlayerToast[]>([]);
  const [poppedLineId, setPoppedLineId] = useState<string | null>(null);
  const [showPartsOverlay, setShowPartsOverlay] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<{ widget: Widget | null } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  // ── Help requests (Andon): alert a team without leaving the run ────────────
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSubmitting, setHelpSubmitting] = useState(false);
  const [helpError, setHelpError] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  /** Requests raised from THIS run that are still open — an operator can
   *  legitimately need two teams at once, so each gets its own banner. */
  const [activeCalls, setActiveCalls] = useState<AndonCall[]>([]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [cancellingCallId, setCancellingCallId] = useState<string | null>(null);
  const callRaisedAtRef = useRef<Record<string, number>>({});
  const [outboxDepth, setOutboxDepth] = useState(() => pendingCount());
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Refs mirroring state for synchronous engine dispatch ──────────────────
  const appRef = useRef<App | null>(null); appRef.current = app;
  const stepIdxRef = useRef(0); stepIdxRef.current = currentStepIdx;
  const formDataRef = useRef<Record<string, unknown>>({});
  const variablesRef = useRef<Record<string, string | number | boolean>>({});
  const widgetValuesRef = useRef<Record<string, unknown>>({});
  const stepTimesRef = useRef<Record<number, number>>({});
  const stepElapsedRef = useRef(0);
  const taktExceededRef = useRef<number[]>([]); taktExceededRef.current = taktExceededSteps;
  const kitRef = useRef<KitState | null>(null); kitRef.current = kit;
  const completionIdRef = useRef<string | null>(null); completionIdRef.current = completionId;
  const photoGatesRef = useRef<Record<string, string>>({}); photoGatesRef.current = photoGates;
  const operatorNameRef = useRef(''); operatorNameRef.current = operatorName;
  const historyRef = useRef<number[]>([]);
  const stepStartTimeRef = useRef(Date.now());
  const pausedAtRef = useRef<number | null>(null);
  const valuesBufferRef = useRef<Map<string, ReturnType<typeof valueInputFor>>>(new Map());
  const dirtyRef = useRef(false);
  const capturedRef = useRef<Set<string>>(new Set());
  const timerElapsedRef = useRef<Record<string, number>>({});
  const firedTaktRef = useRef<Set<number>>(new Set());
  const popTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<RunStatus>('setup'); statusRef.current = status;
  const manualPartNumberRef = useRef(''); manualPartNumberRef.current = manualPartNumber;
  const taktFlashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Side-effecting step_exit actions already carried out in this run
   *  (step + answers + action). One failure files one NCR, however many times
   *  the operator presses the button it was blocked on. */
  const firedSideEffectsRef = useRef<Set<string>>(new Set());

  /** What the picker OFFERS: this app's own jobs, the one the link named, and
   *  every routed job whose operations run this app. */
  const workOrders = useMemo(
    () => playableWorkOrders(allWorkOrders, id ?? '', woFromLink, routedWorkOrderIds),
    [allWorkOrders, id, woFromLink, routedWorkOrderIds],
  );
  // Named from the FULL list, never from the picker's: the job a run is bound
  // to is a fact about the run, not a row that has to have survived a filter.
  const selectedWO = allWorkOrders.find(w => w.id === selectedWorkOrderId);
  const selectedPT = productTypes.find(p => p.id === selectedProductTypeId);
  const currentStep: Step | undefined = app?.steps[currentStepIdx];

  // ── Dark shell mount (spec §1.4) ───────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    root.classList.add('dark');
    root.setAttribute('data-player', '1');
    return () => {
      if (!hadDark) root.classList.remove('dark');
      root.removeAttribute('data-player');
    };
  }, []);

  // ── Outbox / connectivity ──────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeOutbox(() => setOutboxDepth(pendingCount()));
    const goOnline = () => {
      setIsOffline(false);
      void flushOutbox().then(() => setOutboxDepth(pendingCount()));
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      unsub();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  /**
   * Which of these work orders are ROUTED through this app.
   *
   * A job released against a routing has `work_orders.app_id` NULL and names an
   * app on each operation instead, so nothing on the work order row says it can
   * be run here. One GET /work-orders/:id/operations per released job that does
   * not already name this app answers it; the list is capped so a plant with a
   * thousand open jobs does not turn a setup screen into a thousand requests.
   *
   * Entirely best-effort. The picker is already usable without it (this app's
   * own jobs, plus whatever the link named), so a failure narrows the list
   * rather than breaking the screen.
   */
  const resolveRoutedWorkOrders = useCallback(async (wos: WorkOrderExt[]) => {
    if (!id || previewMode) return;
    const candidates = routedLookupCandidates(wos, id);
    if (candidates.length === 0) { setRoutedWorkOrderIds(new Set()); return; }
    const found = await Promise.all(candidates.map(async w => {
      try {
        const ops = await getOperations(w.id);
        return Array.isArray(ops) && ops.some(op => op.app_id === id) ? w.id : null;
      } catch {
        return null;
      }
    }));
    setRoutedWorkOrderIds(new Set(found.filter((x): x is string => !!x)));
  }, [id, previewMode]);

  // ── Load app + catalogs ────────────────────────────────────────────────────
  const loadAll = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([previewMode ? getAppDraft(id) : api.getApp(id), api.getWorkOrders(), api.getProductTypes(id), api.getStations()])
      .then(([a, wos, pts, sts]: [AppExt, WorkOrderExt[], ProductType[], Station[]]) => {
        // Compute the run-context rule from the RAW blob — normalizeApp
        // force-upgrades schema_version in memory (spec: absent flag → enforce
        // only for schema_version ≥ 2; explicit false → never; true → always).
        setRequireContext(runContextRequired(a));
        setApp(normalizeApp(a));
        setAllWorkOrders(Array.isArray(wos) ? wos : []);
        void resolveRoutedWorkOrders(Array.isArray(wos) ? wos : []);
        setProductTypes(pts);
        setStations(sts.filter(s => s.status === 'active'));
        const woParam = searchParams.get('wo');
        const nameParam = searchParams.get('name');
        const stationParam = searchParams.get('station');
        // The verified identity the Operator Portal signed in — carried through
        // so the run is booked to the person, not to their typing.
        const uidParam = searchParams.get('uid');
        const partParam = searchParams.get('part') || searchParams.get('pn');
        // Which operation of the job the dispatch stream sent this tablet to.
        // Only meaningful alongside a work order — the run's units book against
        // an operation OF that job, and the server refuses any other.
        const opParam = searchParams.get('op');
        if (opParam && woParam) setOperationId(opParam);
        if (woParam) setSelectedWorkOrderId(woParam);
        if (!woParam && partParam) setManualPartNumber(partParam);
        if (nameParam) setOperatorName(nameParam);
        if (uidParam) setOperatorUserId(uidParam);
        if (stationParam) setSelectedStationId(stationParam);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load app');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // A dispatch link names no operator, because the person who followed it is
  // signed in: take their identity from the session rather than asking a
  // manager to type their own name into a player they opened themselves.
  // Anything the link DID carry wins — this only fills a gap.
  useEffect(() => {
    if (!enteredFromDispatch || !user) return;
    setOperatorUserId(prev => prev || user.id);
    setOperatorName(prev => (prev.trim() ? prev : (user.display_name || '').trim()));
  }, [enteredFromDispatch, user]);

  // Whether this is a sandbox, and the PINs it hands out. The server answers;
  // this screen never infers a demo from a hostname or a flag of its own.
  useEffect(() => {
    if (previewMode) return;
    let live = true;
    void getDemoHints().then(h => { if (live) setDemoHints(h); });
    return () => { live = false; };
  }, [previewMode]);

  // The coded scrap reasons the finish step picks from. Loaded once; a company
  // that has none gets a control that says so rather than an empty select.
  useEffect(() => {
    if (previewMode) return;
    getReasonCodes({ kind: 'scrap' }).then(setScrapCodes).catch(() => setScrapCodes([]));
  }, [previewMode]);

  // Departments are offered as help-request targets alongside the four function
  // teams. Best-effort: a company with none simply sees the four teams.
  useEffect(() => {
    api.getDepartments().then(setDepartments).catch(() => setDepartments([]));
  }, []);

  // "Jobs in progress" for the setup screen — this app's in_progress runs, any
  // operator can pick one up at its saved position. Refreshed whenever the
  // setup screen shows (start, next-unit context change, leave-job return).
  const refreshJobs = useCallback(() => {
    if (!id || previewMode) return;
    api.getJobsInProgress(id)
      .then(list => { setJobs(list); setJobsLoaded(true); })
      .catch(() => { setJobs([]); setJobsLoaded(true); });
  }, [id, previewMode]);

  useEffect(() => {
    if (status === 'setup') refreshJobs();
  }, [status, refreshJobs]);

  // WO with a product type auto-selects + locks it (spec §6.4)
  useEffect(() => {
    const wo = workOrders.find(w => w.id === selectedWorkOrderId);
    if (wo?.product_type_id) {
      setSelectedProductTypeId(wo.product_type_id);
      setProductTypeLocked(true);
    } else {
      setProductTypeLocked(false);
    }
  }, [selectedWorkOrderId, workOrders]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const debug = useCallback((text: string) => {
    setDebugLog(prev => [...prev.slice(-49), { id: ++debugSeq, ts: new Date().toLocaleTimeString(), text }]);
  }, []);

  const pushToast = useCallback((level: PlayerToast['level'], text: string) => {
    const t: PlayerToast = { id: `t${++toastSeq}`, level, text };
    setToasts(prev => [...prev.slice(-3), t]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 4500);
  }, []);

  const getStepTakt = useCallback((idx: number): number => {
    const step = appRef.current?.steps[idx];
    if (!step) return 0;
    const pt = productTypes.find(p => p.id === selectedProductTypeId);
    if (pt) {
      if (pt.takt_overrides[idx] !== undefined) return Number(pt.takt_overrides[idx]);
      if (pt.takt_overrides[String(idx)] !== undefined) return Number(pt.takt_overrides[String(idx)]);
    }
    return taktOfStep(step);
  }, [productTypes, selectedProductTypeId]);

  const buildAppInfo = useCallback((): Record<string, string | number> => {
    const wo = workOrders.find(w => w.id === selectedWorkOrderId);
    const pt = productTypes.find(p => p.id === selectedProductTypeId);
    const st = stations.find(s => s.id === selectedStationId);
    const totalElapsed = Object.values(stepTimesRef.current).reduce((a, b) => a + b, 0) + stepElapsedRef.current;
    return {
      operator: operatorDisplayName(operatorNameRef.current),
      work_order_number: wo?.work_order_number ?? '',
      part_number: wo?.part_number ?? manualPartNumberRef.current ?? '',
      quantity: wo?.quantity ?? 0,
      quantity_completed: wo?.quantity_completed ?? 0,
      product_type: pt?.name ?? '',
      station: st?.name ?? '',
      elapsed_seconds: totalElapsed,
      step_elapsed_seconds: stepElapsedRef.current,
    };
  }, [workOrders, productTypes, stations, selectedWorkOrderId, selectedProductTypeId, selectedStationId]);

  const buildState = useCallback((scanned?: string): TriggerRuntimeState => {
    const a = appRef.current;
    return {
      variables: { ...variablesRef.current },
      widgetValues: { ...widgetValuesRef.current },
      currentStepId: a?.steps[stepIdxRef.current]?.id ?? '',
      steps: (a?.steps ?? []).map((s, i) => ({ id: s.id, order: s.order ?? i })),
      kit: kitRef.current
        ? { status: kitRef.current.status, lines: kitRef.current.lines.map(l => ({ status: l.status, step_id: l.step_id })) }
        : null,
      appInfo: buildAppInfo(),
      scannedCode: scanned,
    };
  }, [buildAppInfo]);

  // ── Rich capture (spec §5.3) ───────────────────────────────────────────────

  const bufferValue = useCallback((step: Step, widget: Widget, value: unknown) => {
    const input = valueInputFor(step, widget, value);
    if (!input) return;
    valuesBufferRef.current.set(widget.id, input);
    capturedRef.current.add(widget.id);
    dirtyRef.current = true;
  }, []);

  const removeQueuedFlush = useCallback((key: string) => {
    const item = getOutbox().find(i => i.coalesceKey === key);
    if (item) removeOutboxItem(item.id);
  }, []);

  const flushValues = useCallback((reason: string) => {
    const cid = completionIdRef.current;
    if (previewMode) {
      if (valuesBufferRef.current.size > 0 && reason !== 'autosave') {
        debug(`flush (${reason}) suppressed — ${valuesBufferRef.current.size} value(s)`);
      }
      return;
    }
    if (!cid) return;
    if (!dirtyRef.current && valuesBufferRef.current.size === 0) return;
    // Snapshot exactly what this request carries. The operator keeps working
    // while the PUT is in flight, and bufferValue writes a NEW object into the
    // live map for every edit — so on success we retire only the entries whose
    // object identity is still the one we sent. Clearing the whole map here
    // used to silently drop any value captured mid-flight, and unless the
    // operator touched that field again it never reached completion_values.
    const sent = new Map(valuesBufferRef.current);
    const values = [...sent.values()].filter((v): v is NonNullable<typeof v> => v !== null);
    const body: CompletionFlushPayload = {
      data: { ...formDataRef.current },
      step_times: { ...stepTimesRef.current },
      values,
      partial: true,
    };
    api.flushCompletion(cid, body)
      .then(() => {
        for (const [widgetId, input] of sent) {
          if (valuesBufferRef.current.get(widgetId) === input) valuesBufferRef.current.delete(widgetId);
        }
        dirtyRef.current = valuesBufferRef.current.size > 0;
        removeQueuedFlush(`completion:${cid}`);
      })
      .catch(() => {
        enqueueOutbox(
          'completion_update',
          { completionId: cid, body } as unknown as Record<string, unknown>,
          `completion:${cid}`,
        );
      });
  }, [previewMode, debug, removeQueuedFlush]);

  // 20s autosave interval (spec §5.3)
  useEffect(() => {
    if (status !== 'running' || previewMode) return;
    const iv = setInterval(() => flushValues('autosave'), 20_000);
    return () => clearInterval(iv);
  }, [status, previewMode, flushValues]);


  // ── Effect application ─────────────────────────────────────────────────────

  const handleEnqueueEffect = useCallback((eff: Extract<TriggerEffect, { kind: 'enqueue' }>) => {
    if (previewMode) {
      debug(`${eff.op}: ${JSON.stringify(eff.payload)}`);
      return;
    }
    if (eff.op === 'save_record') {
      const p = eff.payload as { tableId: string; fields: Record<string, unknown> };
      api.createRecord(p.tableId, p.fields).catch(() => pushToast('warning', 'Could not save record — check connection'));
    } else {
      const p = eff.payload as { severity: NCRSeverity; title: string; description: string };
      const ncr = {
        title: p.title, description: p.description, severity: p.severity,
        source: 'production',
        app_id: id ?? null,
        completion_id: completionIdRef.current,
        work_order_id: selectedWorkOrderId || null,
        operator_name: operatorNameRef.current,
      };
      api.createNCR(ncr)
        .then(() => pushToast('info', 'Problem report created'))
        .catch(() => { queueNCR(ncr); pushToast('warning', 'Problem report queued — will sync'); });
    }
  }, [previewMode, debug, pushToast, id, selectedWorkOrderId]);

  const applyNonNavEffect = useCallback((eff: TriggerEffect) => {
    switch (eff.kind) {
      case 'set_variable':
        variablesRef.current = { ...variablesRef.current, [eff.name]: eff.value };
        setVariables(variablesRef.current);
        break;
      case 'toast':
        pushToast(eff.level, eff.text);
        break;
      case 'block':
        setBlockBanner(eff.text);
        break;
      case 'require_photo': {
        const sid = appRef.current?.steps[stepIdxRef.current]?.id;
        if (sid) setPhotoGates(prev => ({ ...prev, [sid]: eff.message }));
        break;
      }
      case 'enqueue':
        handleEnqueueEffect(eff);
        break;
      case 'navigate':
        break; // handled by callers
    }
  }, [pushToast, handleEnqueueEffect]);

  // ── Standing validation (spec §5.5) ────────────────────────────────────────

  const computeBlocks = useCallback((): BlockItem[] => {
    const a = appRef.current;
    const step = a?.steps[stepIdxRef.current];
    if (!step) return [];
    const kitW = kitWidgetFor(step);
    const k = kitRef.current;
    const gated = stepShowsKit(step) && k !== null && k.status !== 'cancelled';
    return getStepBlocks(
      step,
      formDataRef.current,
      photoGatesRef.current[step.id] ?? null,
      gated && k ? { gated: true, lines: k.lines, requireScan: kitW?.config.requireScan ?? false } : null,
    );
  }, []);

  /**
   * A refused forward tap has to say why and show where. Scrolls the first
   * blocking widget into view, moves focus to its CONTAINER (never to the input
   * itself — focusing a text field opens the phone keyboard over the very thing
   * we just scrolled to) and names it in the banner. Widgets without a place on
   * screen (kit, photo gate) still get their line.
   */
  const explainBlocks = useCallback((blocks: BlockItem[]) => {
    if (blocks.length === 0) return;
    setNavAttempted(true);
    // Prefer a blocker that is actually rendered (flow widgets and canvas
    // widgets both carry a pw-<id> container); fall back to the first one with
    // a widget, then to whatever is blocking at all (kit, photo gate).
    const locatable = (b: BlockItem) => !!b.widgetId && !!document.getElementById(`pw-${b.widgetId}`);
    const first = blocks.find(locatable) ?? blocks.find(b => b.widgetId) ?? blocks[0];
    setBlockBanner(first.message);
    setGateBlock(first);
    const el = first.widgetId ? document.getElementById(`pw-${first.widgetId}`) : null;
    // "Show me" only appears when there is somewhere to go — a button that
    // does nothing is the thing this whole change is about.
    setBlockedWidgetId(el ? first.widgetId ?? null : null);
    if (!el) return;
    // After paint, so a widget that only just gained its ring is measurable.
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    });
  }, []);

  /** An authored kit_has_short trigger may route around the standing kit gate
   *  (the shortage path, spec §3.2). */
  const hasShortRouting = useCallback((step: Step): boolean => {
    const k = kitRef.current;
    if (!k || !k.lines.some(l => l.status === 'short')) return false;
    return collectStepTriggers(step).some(t =>
      t.enabled !== false &&
      t.conditions.some(c => c.op === 'kit_has_short') &&
      t.actions.some(ac => ac.type === 'go_to_step' || ac.type === 'next_step' || ac.type === 'prev_step' || ac.type === 'complete_app'));
  }, []);

  // ── Navigation pipeline (spec §5.2) ────────────────────────────────────────

  // Step time ACCUMULATES across every stint on that step. Assigning would
  // erase whatever was already banked, which happens in two ordinary flows:
  // a job resumed after a handoff (the previous operator's minutes on the
  // step in progress) and any back-navigation that revisits a step. Both
  // silently understated cycle time and takt history. The stint clock is reset
  // here so a double call can never double-count.
  const recordStepTime = useCallback((idx: number) => {
    const elapsed = Math.round((Date.now() - stepStartTimeRef.current) / 1000);
    const banked = Number(stepTimesRef.current[idx]) || 0;
    stepTimesRef.current = { ...stepTimesRef.current, [idx]: banked + Math.max(0, elapsed) };
    setStepTimes(stepTimesRef.current);
    stepStartTimeRef.current = Date.now();
    stepElapsedRef.current = 0;
  }, []);

  // ── Last flush before the page goes away ───────────────────────────────────
  // Autosave banks every 20s and step navigation banks the rest, so anything
  // entered since the last of those lives only in this tab. A closed tab, a
  // browser Back, an OS-killed tab on a shop-floor tablet — or the automatic
  // reload the stale-chunk recovery can trigger — all took it with them.
  //
  // Worse than the values: `step_times` only banks a stint on step CHANGE, so
  // an operator eight minutes into a step lost all eight minutes, quietly
  // understating cycle time and takt history. Bank the in-flight stint first,
  // then send with keepalive so the request outlives the document.
  //
  // `pagehide` is the reliable signal (mobile Safari often skips `beforeunload`),
  // and hidden-visibility covers the tablet being backgrounded mid-shift.
  useEffect(() => {
    if (status !== 'running' || previewMode) return;

    const flushNow = () => {
      const cid = completionIdRef.current;
      if (!cid) return;
      recordStepTime(stepIdxRef.current);   // bank the stint in progress
      const values = [...valuesBufferRef.current.values()]
        .filter((v): v is NonNullable<typeof v> => v !== null);
      if (!dirtyRef.current && values.length === 0) {
        // Nothing new to send, but the stint we just banked still matters.
        api.flushCompletionOnUnload(cid, {
          data: { ...formDataRef.current }, step_times: { ...stepTimesRef.current },
          values: [], partial: true,
        }).catch(() => { /* the tab is going away; the outbox replays on return */ });
        return;
      }
      api.flushCompletionOnUnload(cid, {
        data: { ...formDataRef.current }, step_times: { ...stepTimesRef.current },
        values, partial: true,
      }).catch(() => { /* same */ });
    };

    const onPageHide = () => flushNow();
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status, previewMode, recordStepTime]);

  // Tell the stale-chunk recovery that a run is live, so it never reloads out
  // from under an operator mid-job — it falls back to the boundary's visible
  // "A new version is available" screen and lets them pick the moment.
  useEffect(() => {
    if (status !== 'running' || previewMode) return;
    setRunActive(true);
    return () => setRunActive(false);
  }, [status, previewMode]);

  const captureStepExitValues = useCallback((step: Step | undefined) => {
    if (!step) return;
    for (const w of step.widgets) {
      if (w.type === 'timer') {
        const el = timerElapsedRef.current[w.id];
        if (el !== undefined && el > 0) bufferValue(step, w, el);
      }
    }
  }, [bufferValue]);

  /**
   * Finish the run.
   *
   * `counts` is null for a run whose units control was never touched — it sends
   * NO count fields at all, so the server stores NULLs and the run behaves
   * exactly as every run did before this control existed. NULL is "nobody
   * counted"; 0 is "counted, and the answer was zero".
   */
  const doComplete = useCallback(async (counts: RunCounts | null = null) => {
    const cid = completionIdRef.current;
    setCompleting(true);
    const values = [...valuesBufferRef.current.values()].filter((v): v is NonNullable<typeof v> => v !== null);
    const body: FinishPayload = {
      status: 'completed',
      data: { ...formDataRef.current },
      step_times: { ...stepTimesRef.current },
      takt_exceeded_steps: taktExceededRef.current,
      values,
      ...(counts ? {
        quantity_good: counts.good,
        quantity_scrap: counts.scrap,
        quantity_rework: counts.rework,
        ...(counts.scrap > 0 ? { scrap_reason_code_id: counts.scrapReasonCodeId } : {}),
      } : {}),
    };
    try {
      if (previewMode) {
        debug('complete — suppressed (preview writes nothing)');
        setStatus('completed');
        return;
      }
      if (!cid) { setStatus('completed'); return; }
      try {
        await api.flushCompletion(cid, body);
        valuesBufferRef.current.clear();
        dirtyRef.current = false;
        removeQueuedFlush(`completion:${cid}`);
        // Completing a run ends the operator's session stint (best-effort).
        api.closeCompletionSession(cid).catch(() => undefined);
        setStatus('completed');
      } catch (err) {
        const hasStatus = typeof (err as { status?: number }).status === 'number';
        if (!navigator.onLine || !hasStatus) {
          // Offline / network failure: enqueue the final PUT (spec §5.7)
          enqueueOutbox('completion_update', { completionId: cid, body } as unknown as Record<string, unknown>, `completion:${cid}`);
          setSavedLocally(true);
          api.closeCompletionSession(cid).catch(() => undefined);
          setStatus('completed');
        } else {
          pushToast('error', err instanceof Error ? err.message : 'Failed to save completion — please try again');
        }
      }
    } finally {
      setCompleting(false);
    }
  }, [previewMode, debug, pushToast, removeQueuedFlush]);

  /**
   * The finish step's Complete.
   *
   * Two taps on the happy path: Complete opens the sheet with one good unit
   * already filled in, Complete again closes the run. A run whose numbers were
   * never touched sends NO counts — the server stores NULLs and the job
   * advances by one, exactly as it always has.
   *
   * The sheet is deliberately NOT closed here. A server refusal ("only 3 left
   * on this operation") has to land back on the numbers that caused it, with
   * them still on screen; the completed screen replaces this one on success.
   */
  const confirmFinish = useCallback(() => {
    if (completing) return;
    if (!unitsTouched) {
      setUnitsLabel('');
      void doComplete(null);
      return;
    }
    const check = unitsBalance({
      unitsRun, good: unitsGood, scrap: unitsScrap, rework: unitsRework,
      scrapReasonCodeId: unitsReasonId,
      // A company whose manager has not set the list up has nothing to pick.
      scrapCodesOffered: scrapCodes.length,
    });
    if (!check.ok) { setUnitsError(check.reason); return; }
    setUnitsError('');
    const label = scrapCodes.find(c => c.id === unitsReasonId)?.label ?? '';
    setUnitsLabel(unitsSummary({ good: unitsGood, scrap: unitsScrap, rework: unitsRework }, label));
    void doComplete({
      good: unitsGood, scrap: unitsScrap, rework: unitsRework, scrapReasonCodeId: unitsReasonId,
    });
  }, [completing, unitsTouched, unitsRun, unitsGood, unitsScrap, unitsRework, unitsReasonId,
    scrapCodes, doComplete]);

  /** Any edit to any of the four numbers arms the balance rule. */
  const editUnits = useCallback((patch: Partial<{ run: number; good: number; scrap: number; rework: number; reason: string }>) => {
    setUnitsTouched(true);
    setUnitsError('');
    if (patch.run !== undefined) setUnitsRun(patch.run);
    if (patch.good !== undefined) setUnitsGood(patch.good);
    if (patch.scrap !== undefined) setUnitsScrap(patch.scrap);
    if (patch.rework !== undefined) setUnitsRework(patch.rework);
    if (patch.reason !== undefined) setUnitsReasonId(patch.reason);
  }, []);

  const commitNavigate = useCallback((intent: NavIntent, depth = 0) => {
    if (depth > 8) return;
    const a = appRef.current;
    if (!a) return;
    const idx = stepIdxRef.current;

    recordStepTime(idx);
    captureStepExitValues(a.steps[idx]);

    // Preview writes nothing, so asking a builder to count units they did not
    // make is a screen with no purpose and no consequence.
    if (intent.to === 'complete') {
      if (previewMode) { void doComplete(null); return; }
      setUnitsError(''); setFinishOpen(true); return;
    }

    let target = idx;
    if (intent.to === 'next') target = idx + 1;
    else if (intent.to === 'prev') {
      target = historyRef.current.length > 0 ? historyRef.current.pop()! : Math.max(0, idx - 1);
    } else if (intent.to === 'step') {
      const t = a.steps.findIndex(s => s.id === intent.stepId);
      if (t === -1) return;
      target = t;
    }
    if (intent.to === 'next' && target >= a.steps.length) {
      if (previewMode) { void doComplete(null); return; }
      setUnitsError(''); setFinishOpen(true); return;
    }
    if (intent.to !== 'prev') historyRef.current.push(idx);

    // Saved position for resume-by-another-operator (jobs in progress).
    formDataRef.current = { ...formDataRef.current, _step_index: target };
    setFormData(formDataRef.current);
    dirtyRef.current = true;

    flushValues('step');

    stepIdxRef.current = target;
    setCurrentStepIdx(target);
    stepStartTimeRef.current = Date.now();
    stepElapsedRef.current = 0;
    setStepElapsed(0);
    setBlockBanner(null);
    setBlockedWidgetId(null);
    setGateBlock(null);
    setNavAttempted(false);
    setShowPartsOverlay(false);

    // step_enter triggers of the target (may chain-navigate)
    const effects = runTriggers(collectStepTriggers(a.steps[target]), 'step_enter', buildState());
    let nav: NavIntent | null = null;
    let blocked = false;
    for (const eff of effects) {
      if (eff.kind === 'navigate') {
        nav = { to: eff.to, stepId: eff.stepId };
      } else if (eff.kind === 'block') {
        blocked = true;
        setBlockBanner(eff.text);
      } else {
        applyNonNavEffect(eff);
      }
    }
    if (nav && !blocked) commitNavigate(nav, depth + 1);
  }, [recordStepTime, captureStepExitValues, doComplete, flushValues, buildState, applyNonNavEffect, previewMode]);

  const requestNavigate = useCallback((intent: NavIntent) => {
    const a = appRef.current;
    if (!a || statusRef.current !== 'running') return;
    const step = a.steps[stepIdxRef.current];
    const forward = intent.to !== 'prev';

    // 1. Standing validation gate (forward only). A refused tap is never
    //    silent: it says what is missing and takes the operator to it.
    if (forward && step) {
      const blocks = computeBlocks();
      if (blocks.length > 0) {
        const onlyKit = blocks.every(b => b.kind === 'kit');
        if (!(onlyKit && hasShortRouting(step))) { explainBlocks(blocks); return; }
      }
    }

    // 2. step_exit triggers — may block or redirect
    const effects = runTriggers(collectStepTriggers(step), 'step_exit', buildState());
    // A step_exit trigger that blocks leaves the operator on the step with the
    // forward button still live, so they press again — and an authored
    // create_ncr used to file a fresh quality record on every single press.
    // The record belongs to the FAILURE, not to the press: an action already
    // carried out for this step with these answers is not carried out twice.
    const valueSig = stepValueSignature(step, formDataRef.current);
    let enqueueSeen = 0;
    let finalIntent = intent;
    let blocked = false;
    for (const eff of effects) {
      if (eff.kind === 'navigate') {
        finalIntent = { to: eff.to, stepId: eff.stepId };
      } else if (eff.kind === 'block') {
        blocked = true;
        setBlockBanner(eff.text);
      } else {
        if (eff.kind === 'enqueue') {
          const key = sideEffectKey(step?.id ?? '', valueSig, eff.op, enqueueSeen++);
          if (!claimSideEffect(firedSideEffectsRef.current, key)) {
            debug(`${eff.op} skipped — already done for this step and these answers`);
            continue;
          }
        }
        applyNonNavEffect(eff);
      }
    }
    if (blocked) return;

    // 3–4. commit + step_enter of target
    commitNavigate(finalIntent);
  }, [computeBlocks, hasShortRouting, explainBlocks, buildState, applyNonNavEffect, commitNavigate, debug]);

  const applyEffects = useCallback((effects: TriggerEffect[]) => {
    let nav: NavIntent | null = null;
    for (const eff of effects) {
      if (eff.kind === 'navigate') nav = { to: eff.to, stepId: eff.stepId };
      else applyNonNavEffect(eff);
    }
    if (nav) requestNavigate(nav);
  }, [applyNonNavEffect, requestNavigate]);

  // ── Field updates + input_change triggers ──────────────────────────────────

  const setField = useCallback((widget: Widget, value: unknown, fireInputChange = true) => {
    const a = appRef.current;
    const step = a?.steps[stepIdxRef.current];
    if (!step) return;
    const key = legacyKey(widget);
    formDataRef.current = { ...formDataRef.current, [key]: value };
    setFormData(formDataRef.current);
    widgetValuesRef.current = { ...widgetValuesRef.current, [widget.id]: value };
    variablesRef.current = { ...variablesRef.current, [key]: toPrimitive(value) };
    setVariables(variablesRef.current);
    bufferValue(step, widget, value);
    dirtyRef.current = true;
    if (fireInputChange && (widget.triggers?.length || step.triggers?.length)) {
      applyEffects(runTriggers([...(widget.triggers ?? []), ...(step.triggers ?? [])], 'input_change', buildState()));
    }
  }, [bufferValue, applyEffects, buildState]);

  // ── Widget events ──────────────────────────────────────────────────────────

  const onButtonPress = useCallback((widget: Widget) => {
    const step = appRef.current?.steps[stepIdxRef.current];
    applyEffects(runTriggers([...(widget.triggers ?? []), ...(step?.triggers ?? [])], 'button_press', buildState()));
  }, [applyEffects, buildState]);

  const onTimerDone = useCallback((widget: Widget) => {
    const step = appRef.current?.steps[stepIdxRef.current];
    if (step) bufferValue(step, widget, timerElapsedRef.current[widget.id] ?? widget.config.duration ?? 0);
    applyEffects(runTriggers([...(widget.triggers ?? []), ...(step?.triggers ?? [])], 'timer_done', buildState()));
  }, [applyEffects, buildState, bufferValue]);

  const onTimerTick = useCallback((widgetId: string, elapsedSeconds: number) => {
    timerElapsedRef.current[widgetId] = elapsedSeconds;
  }, []);

  // ── Kit operations (spec §5.4) ─────────────────────────────────────────────

  const setKitState = useCallback((k: KitState | null) => {
    kitRef.current = k;
    setKit(k);
  }, []);

  const applyLineUpdate = useCallback((lineId: string, data: KitLineUpdate) => {
    const k = kitRef.current;
    if (!k) return;
    // Optimistic local update + status rollup
    const lines = k.lines.map(l => {
      if (l.id !== lineId) return l;
      const qty = data.qty_picked !== undefined
        ? data.qty_picked
        : (data.status === 'picked' || data.status === 'verified') && l.qty_picked === 0
          ? l.qty_required
          : l.qty_picked;
      return {
        ...l,
        status: data.status,
        qty_picked: qty,
        short_reason: data.status === 'short' ? (data.short_reason ?? '') : l.short_reason,
      };
    });
    const p = kitProgress(lines, false);
    const rollup: KitStatus = p.short > 0 ? 'short' : p.complete ? 'complete' : 'picking';
    setKitState({ ...k, status: rollup, lines });

    if (previewMode) {
      debug(`kit line ${lineId.slice(0, 8)} → ${data.status} (suppressed)`);
      return;
    }
    // No name yet? The server falls back to the signed-in user rather than
    // stamping a phantom called "Operator" on the kit line.
    const payload: KitLineUpdate = { ...data, actor: operatorNameRef.current };
    api.updateKitLine(k.id, lineId, payload)
      .then(res => {
        const cur = kitRef.current;
        if (!cur) return;
        // Task A's server returns the full kit ({ ...kit, status, line });
        // Task B's client types it as { line, kit_status } — accept either.
        const r = res as unknown as { line: KitLine; kit_status?: string; status?: string };
        const serverStatus = (r.kit_status ?? r.status) as KitStatus | undefined;
        setKitState({
          ...cur,
          status: serverStatus ?? cur.status,
          lines: cur.lines.map(l => (l.id === lineId ? r.line : l)),
        });
      })
      .catch((err: unknown) => {
        const httpStatus = (err as { status?: number }).status;
        if (navigator.onLine && typeof httpStatus === 'number') {
          // Server rejected (illegal transition etc.) — reload the truth
          pushToast('warning', err instanceof Error ? err.message : 'Kit update rejected');
          void api.getKit(k.id).then(fresh => setKitState(fresh)).catch(() => undefined);
        } else {
          enqueueOutbox(
            'kit_line',
            { kitId: k.id, lineId, data: payload } as unknown as Record<string, unknown>,
            `kit_line:${lineId}`,
          );
        }
      });
  }, [previewMode, debug, pushToast, setKitState]);

  const popLine = useCallback((lineId: string) => {
    setPoppedLineId(lineId);
    if (popTimeoutRef.current) clearTimeout(popTimeoutRef.current);
    popTimeoutRef.current = setTimeout(() => setPoppedLineId(null), 800);
  }, []);

  const verifyLine = useCallback((line: KitLine) => {
    applyLineUpdate(line.id, { status: 'verified' });
    popLine(line.id);
  }, [applyLineUpdate, popLine]);

  const markShort = useCallback((line: KitLine, qty: number, reason: string) => {
    applyLineUpdate(line.id, { status: 'short', qty_picked: qty, short_reason: reason });
  }, [applyLineUpdate]);

  const undoShort = useCallback((line: KitLine) => {
    applyLineUpdate(line.id, { status: 'picked' });
  }, [applyLineUpdate]);

  /** Scan validation chain (spec §5.4). Returns true when the code was
   *  recognized as a kit code (even if already verified / wrong step). */
  const handleKitScan = useCallback((code: string): boolean => {
    const a = appRef.current;
    const k = kitRef.current;
    const step = a?.steps[stepIdxRef.current];
    if (!k || !step) return false;
    const kitW = kitWidgetFor(step);
    const scope = kitW?.config.kitScope ?? 'all';
    const res = evaluateKitScan(k.lines, code, scope === 'step' ? step.id : null);
    switch (res.type) {
      case 'verified':
        verifyLine(res.line);
        pushToast('info', `Verified — ${res.line.item_name || res.line.sku}`);
        return true;
      case 'already':
        pushToast('warning', 'Already verified');
        return true;
      case 'wrong_step': {
        const stepIdx = a ? a.steps.findIndex(s => s.id === res.line.step_id) : -1;
        pushToast('warning', stepIdx >= 0 ? `Needed at step ${stepIdx + 1} — ${a?.steps[stepIdx]?.name ?? ''}` : 'Needed at another step');
        return true;
      }
      case 'unknown':
        pushToast('error', 'Not on this kit');
        return false;
    }
  }, [verifyLine, pushToast]);

  // ── Scan events (spec §3.1 'scan') ─────────────────────────────────────────

  const onWidgetScan = useCallback((widget: Widget, code: string) => {
    const step = appRef.current?.steps[stepIdxRef.current];
    if (!step) return;
    if (widget.config.scanTarget === 'kit') {
      handleKitScan(code);
    } else {
      setField(widget, code, false);
    }
    applyEffects(runTriggers([...(widget.triggers ?? []), ...(step.triggers ?? [])], 'scan', buildState(code)));
  }, [handleKitScan, setField, applyEffects, buildState]);

  const onGlobalScan = useCallback((code: string) => {
    const step = appRef.current?.steps[stepIdxRef.current];
    if (!step) return;
    if (stepShowsKit(step) && kitRef.current) handleKitScan(code);
    applyEffects(runTriggers(step.triggers ?? [], 'scan', buildState(code)));
  }, [handleKitScan, applyEffects, buildState]);

  // Global keyboard-wedge scanner (fast Enter-terminated bursts outside inputs)
  useEffect(() => {
    if (status !== 'running') return;
    const buf = { chars: '', first: 0, last: 0 };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const now = Date.now();
      if (now - buf.last > 120) buf.chars = '';
      if (e.key === 'Enter') {
        if (buf.chars.length >= 3 && now - buf.first <= Math.max(500, buf.chars.length * 60)) {
          e.preventDefault();
          onGlobalScan(buf.chars);
        }
        buf.chars = '';
      } else if (e.key.length === 1) {
        if (buf.chars === '') buf.first = now;
        buf.chars += e.key;
        buf.last = now;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, onGlobalScan]);

  // ── Step elapsed / takt (legacy behavior preserved, restyled) ─────────────
  useEffect(() => {
    if (status !== 'running' || paused) return;
    const iv = setInterval(() => {
      const el = Math.round((Date.now() - stepStartTimeRef.current) / 1000);
      stepElapsedRef.current = el;
      setStepElapsed(el);
    }, 1000);
    return () => clearInterval(iv);
  }, [status, paused, currentStepIdx]);

  const stepTaktSeconds = getStepTakt(currentStepIdx);
  const isOverTakt = stepTaktSeconds > 0 && stepElapsed > stepTaktSeconds;

  useEffect(() => {
    if (!isOverTakt || status !== 'running') return;
    if (!taktExceededRef.current.includes(currentStepIdx)) {
      setTaktExceededSteps(prev => (prev.includes(currentStepIdx) ? prev : [...prev, currentStepIdx]));
    }
    // Step-level timer_done fires once per step when the takt expires
    if (!firedTaktRef.current.has(currentStepIdx)) {
      firedTaktRef.current.add(currentStepIdx);
      // One-time full-screen red flash at takt zero (skipped for
      // prefers-reduced-motion; the persistent banner still shows).
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        setTaktFlash(true);
        if (taktFlashTimeoutRef.current) clearTimeout(taktFlashTimeoutRef.current);
        taktFlashTimeoutRef.current = setTimeout(() => setTaktFlash(false), 1000);
      }
      const step = appRef.current?.steps[currentStepIdx];
      if (step?.triggers?.length) {
        applyEffects(runTriggers(step.triggers, 'timer_done', buildState()));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOverTakt, currentStepIdx, status]);

  const togglePause = useCallback(() => {
    setPaused(p => {
      if (!p) {
        pausedAtRef.current = Date.now();
      } else if (pausedAtRef.current !== null) {
        stepStartTimeRef.current += Date.now() - pausedAtRef.current;
        pausedAtRef.current = null;
      }
      return !p;
    });
  }, []);

  // ── Run lifecycle ──────────────────────────────────────────────────────────

  const resetRunState = useCallback(() => {
    const a = appRef.current;
    historyRef.current = [];
    stepIdxRef.current = 0;
    setCurrentStepIdx(0);
    formDataRef.current = {};
    setFormData({});
    widgetValuesRef.current = {};
    const vars: Record<string, string | number | boolean> = {};
    for (const v of a?.variables ?? []) {
      if (v.defaultValue !== undefined) vars[v.name] = v.defaultValue;
    }
    variablesRef.current = vars;
    setVariables(vars);
    stepTimesRef.current = {};
    setStepTimes({});
    setTaktExceededSteps([]);
    firedTaktRef.current = new Set();
    valuesBufferRef.current = new Map();
    dirtyRef.current = false;
    capturedRef.current = new Set();
    firedSideEffectsRef.current = new Set();
    timerElapsedRef.current = {};
    setPhotoGates({});
    photoGatesRef.current = {};
    setBlockBanner(null);
    setBlockedWidgetId(null);
    setGateBlock(null);
    setNavAttempted(false);
    setPaused(false);
    pausedAtRef.current = null;
    setSavedLocally(false);
    setShowPartsOverlay(false);
    // A new unit is counted from scratch: back to one good, untouched, so the
    // next run does not inherit the last one's scrap.
    setFinishOpen(false);
    setUnitsRun(1); setUnitsGood(1); setUnitsScrap(0); setUnitsRework(0);
    setUnitsReasonId(''); setUnitsTouched(false); setUnitsError(''); setUnitsLabel('');
    // A new run starts with a clean slate — requests raised during the previous
    // one stay on the Andon Board, they just stop banner-ing here.
    setActiveCalls([]);
    callRaisedAtRef.current = {};
    stepStartTimeRef.current = Date.now();
    stepElapsedRef.current = 0;
    setStepElapsed(0);
  }, []);

  const loadKitForWO = useCallback((workOrderId: string) => {
    api.getKits({ work_order_id: workOrderId })
      .then(kits => {
        const active = kits.find(k => k.status !== 'cancelled');
        if (active) {
          return api.getKit(active.id).then(full => { setKitState(full); });
        }
        setKitState(null);
        // No kit was generated for this job, so the bill of materials itself is
        // the next best parts list — when the job has one. Most routed jobs do
        // not, and /boms/resolve says so with a 200 and an empty body (see
        // routes/boms.js): a null id is nothing to render, and rendering
        // nothing is the whole answer. It used to be a 404, which printed a red
        // failure in the console of every ordinary job and fired this catch.
        return api.resolveBOM(workOrderId)
          .then(b => setBomFallback(b?.id ? b : null))
          .catch(() => setBomFallback(null));
      })
      .catch(() => undefined);
  }, [setKitState]);

  const startRun = useCallback(async () => {
    const a = appRef.current;
    if (!a || !id || starting) return;
    // Run-context gate (player batch B): a work order OR a typed part number.
    const gate = runContextGate(requireContext && !previewMode, selectedWorkOrderId, manualPartNumber);
    if (!gate.ok) { setActionError(gate.reason); return; }
    // What this tablet is standing at, kept for the next run. An EMPTY station
    // is an answer too — "the whole plant" — so once somebody has answered the
    // question it is overwritten, never deleted: deleting it reads downstream
    // as "nobody has ever been asked", and the portal then derives a cell for
    // an operator who deliberately chose not to have one. Absent stays absent,
    // because starting a run without a station is not an answer to a question
    // nobody put.
    if (selectedStationId) localStorage.setItem('hm_station', selectedStationId);
    else if (localStorage.getItem('hm_station') !== null) localStorage.setItem('hm_station', '');
    setStarting(true);
    setActionError(null);
    try {
      if (!previewMode) {
        // Whoever actually ran it, or nobody — never an invented "Operator".
        const who = operatorAttribution(operatorName, operatorUserId);
        // Same POST /completions the player has always made. The only
        // difference is an optional one-shot supervisor proof in a header,
        // which is absent for every company that has not turned the gate on.
        // Widened locally rather than in api/training.ts: the operation id is a
        // field of THIS request, and the start-run helper is shared.
        const payload: StartRunPayload & { work_order_operation_id?: string } = {
          app_id: id,
          ...who,
          work_order_id: selectedWorkOrderId || undefined,
          work_order_operation_id: (selectedWorkOrderId && operationId) ? operationId : undefined,
          product_type_id: selectedProductTypeId || undefined,
          station_id: selectedStationId || undefined,
        };
        const c = await startRunRequest<{ id: string }>(payload, overrideProofRef.current);
        overrideProofRef.current = null;   // single use — the server spent it
        setQualBlock(null);
        setQualError('');
        setCompletionId(c.id);
        completionIdRef.current = c.id;
        // Open this operator's session stint (best-effort). A stint belongs to
        // a named person, so an unnamed run simply has none.
        if (who.operator_name) {
          api.openCompletionSession(c.id, {
            operator_name: who.operator_name,
            operator_user_id: who.operator_user_id,
          }).catch(() => undefined);
        }
      } else {
        setCompletionId(null);
        completionIdRef.current = null;
        debug('run started — preview mode, no completion created');
      }
      resetRunState();
      // Seed run context + operator roster into the data blob. A manual part
      // number is stored in data._part_number AND as a completion_values row
      // (widget_id '_part_number', labeled 'Part number').
      const seeded: Record<string, unknown> = {
        _operators: operatorName.trim() ? [operatorName.trim()] : [],
      };
      const pn = manualPartNumber.trim();
      if (!selectedWorkOrderId && pn) {
        seeded._part_number = pn;
        valuesBufferRef.current.set('_part_number', {
          step_id: '', widget_id: '_part_number', variable_name: 'Part number',
          value_type: 'text', value_text: pn,
        });
        dirtyRef.current = true;
      }
      formDataRef.current = { ...formDataRef.current, ...seeded };
      setFormData(formDataRef.current);
      setHandoffNote(null);
      if (selectedWorkOrderId) loadKitForWO(selectedWorkOrderId);
      else { setKitState(null); setBomFallback(null); }
      setStatus('running');
      statusRef.current = 'running';
      // step_enter triggers of the first step
      if (a.steps[0]) {
        applyEffects(runTriggers(collectStepTriggers(a.steps[0]), 'step_enter', buildState()));
      }
    } catch (err) {
      // The plant has training enforcement on Block and this person is not
      // signed off. That is not an error to apologise for — it is a decision
      // the company made, and the sheet says whose sign-off is missing.
      const refused = notQualified(err);
      if (refused) {
        overrideProofRef.current = null;
        setQualError('');
        setQualBlock(refused);
        return;
      }
      // Starting a run is a server round trip (it books the completion row), so
      // it is one of the few things offline genuinely cannot do. Say that,
      // instead of a bare network error.
      const networkDown = !navigator.onLine || typeof (err as { status?: number }).status !== 'number';
      setActionError(networkDown
        ? "You're offline — a new run can't be started until you reconnect. A run already going keeps working."
        : err instanceof Error ? err.message : 'Failed to start process');
    } finally {
      setStarting(false);
    }
  }, [id, starting, previewMode, operatorName, operatorUserId, selectedWorkOrderId, selectedProductTypeId,
    selectedStationId, operationId, requireContext, manualPartNumber, resetRunState, loadKitForWO, setKitState,
    applyEffects, buildState, debug]);

  /**
   * A supervisor types their PIN on the blocked-start sheet. The PIN is
   * verified server-side by POST /api/operators/verify-authorizer — the same
   * mechanism an in-run NCR uses, and the only place in the product that
   * compares a PIN. What comes back is a single-use proof; the retry carries it
   * and the server writes the permanent override record itself.
   */
  const approveQualification = useCallback(async (pin: string) => {
    if (qualSubmitting || !id) return;
    setQualSubmitting(true);
    setQualError('');
    try {
      // Two bound steps, not one loose credential. The PIN is verified FOR THIS
      // app and this operator (the purpose string carries both), and the grant
      // that comes back is immediately exchanged for a token scoped to the same
      // pair. Nothing the tablet holds afterwards would start anything else.
      const who = { appId: id, userId: operatorUserId, operatorName };
      const auth = await verifyOverrideAuthorizer(pin, who);
      const minted = await mintOverrideToken({
        appId: id,
        userId: operatorUserId,
        operatorName,
        authorizerProof: auth.authorization_id,
      });
      overrideProofRef.current = minted.token;
      await startRun();
      pushToast('info', `Approved by ${auth.display_name}`);
    } catch (err) {
      overrideProofRef.current = null;
      setQualError(err instanceof Error ? err.message : 'Authorization failed');
    } finally {
      setQualSubmitting(false);
    }
  }, [qualSubmitting, id, operatorUserId, operatorName, startRun, pushToast]);

  // ── Nothing the portal already knows is asked twice ───────────────────────
  // The Operator Portal deep link carries who (uid), where (station) and what
  // (wo). When it carries all three and the app has no further choice to make,
  // the setup screen has nothing left to ask, so it is not shown at all: one
  // tap on a job and the operator is on step one.
  //
  // It waits for the in-progress list, because skipping setup must never skip
  // the concurrent-run warning — a silent auto-start onto a unit that already
  // has a run open on it, the operator's own after a tablet reload as often as
  // a colleague's, would be worse than the screen it replaces. And it counts
  // only a station the LINK named: a station merely remembered in this
  // browser's localStorage is offered as a preselected default on the setup
  // screen, never used to book a run nobody was shown.
  // ── ?run= — pick this exact job back up ───────────────────────────────────
  // The Operator Portal's Resume link names the run itself. Without this the
  // operator lands on setup and is shown the concurrent-run warning about their
  // OWN job, which is both wrong and the exact thing the link was avoiding.
  //
  // The list this checks against is the server's own in-progress runs FOR THIS
  // APP AND COMPANY, so an id that is finished, abandoned, from another app or
  // from another tenant simply is not in it: it falls through to the normal
  // flow with a plain notice, and never resumes anything it should not.
  useEffect(() => {
    if (resumeParamRef.current) return;
    if (loading || !app || previewMode || status !== 'setup' || !jobsLoaded) return;
    const runParam = searchParams.get('run');
    if (!runParam) { resumeParamRef.current = true; return; }
    if (!operatorName.trim()) return;   // wait for the identity to settle
    resumeParamRef.current = true;
    const target = resumeTarget(jobs, runParam, { operatorUserId, operatorName });
    // Somebody else's run, or a run that has closed: land on setup and say so.
    // The concurrent-run card below offers the run back — joining a job is a
    // decision two people share, not something a link does quietly.
    if (target.kind === 'gone' || target.kind === 'theirs') { setLinkNotice(target.notice); return; }
    if (target.kind !== 'resume') return;
    void resumeJob(target.job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, app, previewMode, status, jobsLoaded, jobs, operatorName, operatorUserId, searchParams]);

  useEffect(() => {
    if (autoStartedRef.current) return;
    if (loading || !app || previewMode || status !== 'setup' || starting) return;
    if (!jobsLoaded) return;
    // A link that names a run is asking to RESUME, not to start: let that
    // resolve first, or a fresh run would be booked over the top of it.
    if (searchParams.get('run') && !resumeParamRef.current) return;
    if (resumingId) return;
    const needed = setupNeeded(
      {
        operatorUserId,
        stationId: stationFromLink ? selectedStationId : '',
        workOrderId: selectedWorkOrderId,
        // A routed job: the operation the dispatch queue linked to. It is what
        // makes the product type optional — see setupNeeded.
        operationId: opFromLink && woFromLink ? opFromLink : null,
        partNumber: manualPartNumber,
        productTypeId: selectedProductTypeId,
      },
      {
        productTypeCount: productTypes.length,
        productTypeLocked,
        preview: previewMode,
        // A signed-in manager on a dispatch link is identified by their
        // session; the link carries no uid on purpose.
        selfIdentified: enteredFromDispatch && !!user,
      },
    );
    if (needed) return;
    if (concurrentRun(jobs, selectedWorkOrderId, manualPartNumber)) return;
    autoStartedRef.current = true;
    void startRun();
  }, [
    loading, app, previewMode, status, starting, jobsLoaded, jobs, stationFromLink,
    opFromLink, woFromLink,
    operatorUserId, selectedStationId, selectedWorkOrderId, manualPartNumber,
    selectedProductTypeId, productTypes.length, productTypeLocked, startRun,
    enteredFromDispatch, user, resumingId, searchParams,
  ]);

  // ── Request help (Andon alerts) ────────────────────────────────────────────
  // One andon_call carries the whole run context, so the responder knows where
  // to go and what is running before they walk over. The run is never paused.

  const callContext = useMemo(() => {
    const st = stations.find(s => s.id === selectedStationId);
    return [
      st?.name,
      selectedWO?.work_order_number ? `WO ${displayId(selectedWO.work_order_number)}` : (manualPartNumber.trim() || undefined),
      app?.name,
      currentStep?.name,
      operatorName || undefined,
    ].filter(Boolean).join(' · ');
  }, [stations, selectedStationId, selectedWO, manualPartNumber, app?.name, currentStep?.name, operatorName]);

  const raiseCall = useCallback(async (target: AlertTarget, note: string) => {
    if (helpSubmitting) return;
    const station = stations.find(s => s.id === selectedStationId);
    const who = targetLabel(target);
    if (previewMode) {
      debug(`andon alert: ${who}${note ? ` — ${note}` : ''} (suppressed)`);
      pushToast('info', `${who} would be notified — preview mode writes nothing`);
      setHelpOpen(false);
      return;
    }
    setHelpSubmitting(true);
    setHelpError('');
    try {
      const call = await api.createAndonCall({
        ...targetPayload(target),
        note,
        app_id: id ?? null,
        completion_id: completionIdRef.current,
        work_order_id: selectedWorkOrderId || null,
        station_id: selectedStationId || null,
        // A team alert inherits the station's department as its location; a
        // department alert already carries the department it is aimed at.
        ...(target.kind === 'team' ? { department_id: station?.department_id || null } : {}),
        step_name: appRef.current?.steps[stepIdxRef.current]?.name ?? '',
        // Omitted when unknown: the server falls back to the signed-in user.
        ...operatorAttribution(operatorName, null),
      });
      callRaisedAtRef.current[call.id] = Date.now() - (call.age_seconds ?? 0) * 1000;
      setActiveCalls(prev => [...prev.filter(c => c.id !== call.id), call]);
      setNowTick(Date.now());
      setHelpOpen(false);
      pushToast('info', `${who} has been notified — keep working`);
    } catch (err) {
      setHelpError(err instanceof Error ? err.message : 'Could not send the request. Try again.');
    } finally {
      setHelpSubmitting(false);
    }
  }, [helpSubmitting, previewMode, stations, selectedStationId, selectedWorkOrderId, id, operatorName, debug, pushToast]);

  const cancelCall = useCallback(async (call: AndonCall) => {
    if (cancellingCallId) return;
    setCancellingCallId(call.id);
    try {
      await api.cancelAndonCall(call.id);
      setActiveCalls(prev => prev.filter(c => c.id !== call.id));
      pushToast('info', `${call.target_label || call.team_label || 'Request'} stood down`);
    } catch {
      pushToast('warning', 'Could not stand the request down — it is still open on the board');
    } finally {
      setCancellingCallId(null);
    }
  }, [cancellingCallId, pushToast]);

  // Banner ages tick locally so they move every second without re-fetching.
  useEffect(() => {
    if (activeCalls.length === 0) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeCalls.length]);

  // A responder acknowledging or resolving on the board updates these banners
  // live over the same WebSocket the dashboards use.
  useEffect(() => {
    if (activeCalls.length === 0) return;
    return subscribeRealtime(evt => {
      if (!isAndonEvent(evt) || !evt.call?.id) return;
      const known = activeCalls.find(c => c.id === evt.call.id);
      if (!known) return;
      if (evt.action === 'resolved' || evt.action === 'cancelled' || evt.action === 'deleted') {
        setActiveCalls(prev => prev.filter(c => c.id !== evt.call.id));
        pushToast('info', `${known.target_label || known.team_label || 'Request'} closed`);
        return;
      }
      setActiveCalls(prev => prev.map(c => (c.id === evt.call.id ? evt.call : c)));
      if (evt.action === 'acknowledged') {
        pushToast('info', `${evt.call.assigned_to || evt.call.target_label || evt.call.team_label} is on the way`);
      }
    });
  }, [activeCalls, pushToast]);

  const abandonRun = useCallback(() => {
    const cid = completionIdRef.current;
    recordStepTime(stepIdxRef.current);
    if (cid && !previewMode) {
      const values = [...valuesBufferRef.current.values()].filter((v): v is NonNullable<typeof v> => v !== null);
      api.flushCompletion(cid, {
        status: 'abandoned',
        data: { ...formDataRef.current },
        step_times: { ...stepTimesRef.current },
        values,
      }).catch(() => {
        // Still exit the run locally — the operator asked to stop.
      });
      api.closeCompletionSession(cid).catch(() => undefined);
    }
    if (previewMode) debug('abandon — suppressed (preview)');
    setStatus('abandoned');
  }, [previewMode, debug, recordStepTime]);

  // Pause-and-leave (player batch C): save progress at the current step, close
  // this operator's session with an optional handoff comment, and return to
  // setup so the job shows under "Jobs in progress" for anyone to resume.
  const leaveJob = useCallback((handoffComment: string) => {
    const cid = completionIdRef.current;
    if (!cid || previewMode) { setLeaveOpen(false); return; }
    setLeaving(true);
    recordStepTime(stepIdxRef.current);
    captureStepExitValues(appRef.current?.steps[stepIdxRef.current]);
    formDataRef.current = { ...formDataRef.current, _step_index: stepIdxRef.current };
    setFormData(formDataRef.current);
    dirtyRef.current = true;
    flushValues('leave');
    api.closeCompletionSession(cid, { handoff_comment: handoffComment })
      .catch(() => undefined)
      .finally(() => {
        setLeaving(false);
        setLeaveOpen(false);
        setCompletionId(null);
        completionIdRef.current = null;
        setKitState(null);
        setBomFallback(null);
        resetRunState();
        setStatus('setup');
        statusRef.current = 'setup';
        refreshJobs();
      });
  }, [previewMode, recordStepTime, captureStepExitValues, flushValues, resetRunState, setKitState, refreshJobs]);

  // Resume an in-progress job (any operator) at its saved position.
  const resumeJob = useCallback(async (job: JobInProgress) => {
    const a = appRef.current;
    if (!a || previewMode || resumingId) return;
    if (!operatorName.trim()) {
      setActionError('Enter your name (or badge in) before resuming a job');
      return;
    }
    setResumingId(job.id);
    setActionError(null);
    try {
      await api.openCompletionSession(job.id, {
        operator_name: operatorName.trim(),
        operator_user_id: operatorUserId || undefined,
      });
      const full = await api.getCompletionWithSessions(job.id);

      resetRunState();
      const data: Record<string, unknown> =
        full.data && typeof full.data === 'object' ? { ...(full.data as Record<string, unknown>) } : {};
      formDataRef.current = data;
      setFormData(data);
      // Rebuild widget values + variables from the saved blob so triggers and
      // interpolation see the previous operator's inputs.
      const vars = { ...variablesRef.current };
      for (const s of a.steps) {
        for (const w of s.widgets) {
          const v = data[legacyKey(w)];
          if (v !== undefined) {
            widgetValuesRef.current[w.id] = v;
            vars[legacyKey(w)] = toPrimitive(v);
          }
        }
      }
      variablesRef.current = vars;
      setVariables(vars);
      const st: Record<number, number> = {};
      for (const [k, v] of Object.entries((full.step_times ?? {}) as Record<string, number>)) {
        const n = Number(k);
        if (Number.isFinite(n)) st[n] = Number(v) || 0;
      }
      stepTimesRef.current = st;
      setStepTimes(st);
      let exceeded: number[] = [];
      try {
        const raw = typeof full.takt_exceeded_steps === 'string'
          ? JSON.parse(full.takt_exceeded_steps) : full.takt_exceeded_steps;
        if (Array.isArray(raw)) exceeded = raw.map(Number).filter(Number.isFinite);
      } catch { /* keep [] */ }
      setTaktExceededSteps(exceeded);
      taktExceededRef.current = exceeded;

      setSelectedWorkOrderId(full.work_order_id ?? '');
      if (full.product_type_id) setSelectedProductTypeId(full.product_type_id);
      setManualPartNumber(typeof data._part_number === 'string' ? data._part_number : '');

      const savedIdx = Number(data._step_index ?? 0);
      const idx = Number.isFinite(savedIdx) ? Math.min(Math.max(0, savedIdx), a.steps.length - 1) : 0;
      stepIdxRef.current = idx;
      setCurrentStepIdx(idx);
      stepStartTimeRef.current = Date.now();

      setCompletionId(job.id);
      completionIdRef.current = job.id;
      if (full.work_order_id) loadKitForWO(full.work_order_id);
      else { setKitState(null); setBomFallback(null); }

      // Handoff banner: the most recent closed stint that left a comment.
      const sessions: CompletionSession[] = Array.isArray(full.sessions) ? full.sessions : [];
      const prev = [...sessions].reverse().find(s => s.ended_at && s.handoff_comment && s.operator_name !== operatorName.trim());
      setHandoffNote(prev ? `${prev.operator_name}: ${prev.handoff_comment}` : null);

      setStatus('running');
      statusRef.current = 'running';
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resume job');
    } finally {
      setResumingId(null);
    }
  }, [previewMode, resumingId, operatorName, operatorUserId, resetRunState, loadKitForWO, setKitState]);

  const nextUnit = useCallback(async () => {
    setKitState(null);
    setBomFallback(null);
    // Refresh WO quantities so appInfo stays truthful for the next unit
    if (!previewMode) {
      try {
        const wos = await api.getWorkOrders();
        setAllWorkOrders(Array.isArray(wos) ? wos : []);
      } catch { /* non-fatal */ }
    }
    setStatus('setup');
    statusRef.current = 'setup';
    setCompletionId(null);
    completionIdRef.current = null;
    resetRunState();
    // Same setup retained (work order / part number carried forward) —
    // immediately start the next run.
    setTimeout(() => { void startRun(); }, 0);
  }, [previewMode, id, resetRunState, setKitState, startRun]);

  // One-tap "Change" from the summary: back to setup with the fields retained.
  const changeContext = useCallback(() => {
    setKitState(null);
    setBomFallback(null);
    setStatus('setup');
    statusRef.current = 'setup';
    setCompletionId(null);
    completionIdRef.current = null;
    resetRunState();
  }, [resetRunState, setKitState]);

  // ── Badge login (spec §5.1) ────────────────────────────────────────────────

  const tryBadge = useCallback(async () => {
    const code = badgeInput.trim();
    if (!code) return;
    setBadgeError('');
    try {
      const res = await api.badgeLogin({ badge_code: code });
      setOperatorUserId(res.user_id);
      setOperatorName(res.display_name);
      setBadgeInput('');
    } catch {
      // Fall back to free text exactly as today
      setBadgeError('Badge not recognized — enter your name instead');
      setOperatorUserId(null);
    }
  }, [badgeInput]);

  /**
   * The way out. Going back to the floor carries the verified identity and the
   * station with it: without them the portal asks "Who's working?" and demands
   * the PIN again after every single unit, which is how a floor learns to stop
   * signing in at all.
   */
  const leavePlayer = useCallback(() => {
    navigate(exitPath === '/operator'
      ? operatorReturnLink(operatorUserId, selectedStationId)
      : exitPath);
  }, [navigate, exitPath, operatorUserId, selectedStationId]);

  // ── Derived render state ───────────────────────────────────────────────────

  const blocks = useMemo(
    () => (status === 'running' ? computeBlocks() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, currentStepIdx, formData, kit, photoGates, app],
  );
  const blockReason = summarizeBlocks(blocks);
  const kitOnlyBypass = blocks.length > 0 && blocks.every(b => b.kind === 'kit') && currentStep !== undefined && hasShortRouting(currentStep);
  const navBlocked = blocks.length > 0 && !kitOnlyBypass;
  const invalidByWidget = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of blocks) {
      if (!b.widgetId) continue;
      // A value that is WRONG is called out on sight; a value that is merely
      // still missing waits until the operator tries to move on, so an
      // untouched step does not open covered in red.
      if (b.kind === 'range' || b.kind === 'pattern') m[b.widgetId] = b.message;
      else if (b.kind === 'required' && navAttempted) m[b.widgetId] = b.message;
    }
    return m;
  }, [blocks, navAttempted]);

  // The gate's banner is only true while its block is: answering the field
  // retires the red bar on its own. A banner raised by an authored
  // block_with_error trigger is left alone — that one is the author's message
  // and only a tap dismisses it.
  useEffect(() => {
    if (!gateBlock) return;
    const stillBlocked = blocks.some(b => b.kind === gateBlock.kind && b.widgetId === gateBlock.widgetId);
    if (stillBlocked) return;
    setGateBlock(null);
    setBlockedWidgetId(null);
    setBlockBanner(prev => (prev === gateBlock.message ? null : prev));
  }, [blocks, gateBlock]);

  /** Re-run the explanation for the current step — the footer reason line and
   *  the banner's "Show me" both land here. */
  const showBlockers = useCallback(() => { explainBlocks(computeBlocks()); },
    [explainBlocks, computeBlocks]);

  const kitW = kitWidgetFor(currentStep);
  const showKitChrome = stepShowsKit(currentStep);

  const renderKitPanel = useCallback((widget: Widget | null) => (
    <KitPanel
      lines={kit ? kit.lines : null}
      kitStatus={kit ? kit.status : null}
      bomLines={bomFallback ? bomFallback.lines : null}
      partsList={currentStep?.parts_list ?? null}
      scope={widget?.config.kitScope ?? 'all'}
      currentStepId={currentStep?.id ?? ''}
      allowShort={widget?.config.allowShort ?? true}
      requireScan={widget?.config.requireScan ?? false}
      poppedLineId={poppedLineId}
      onRequestScan={() => setScannerTarget({ widget: null })}
      onVerify={verifyLine}
      onMarkShort={markShort}
      onUndoShort={undoShort}
    />
  ), [kit, bomFallback, currentStep, poppedLineId, verifyLine, markShort, undoShort]);

  // ── Screens ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-root items-center justify-center">
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--p-accent)' }} />
      </div>
    );
  }

  if (loadError || !app) {
    return (
      <div className="p-root items-center justify-center">
        <div className="text-center">
          <AlertTriangle size={40} className="mx-auto mb-3" style={{ color: 'var(--p-bad)' }} />
          <p style={{ fontSize: 20, fontWeight: 650 }}>{loadError ? "Couldn't load app" : 'App not found'}</p>
          {loadError && <p style={{ fontSize: 14, color: 'var(--p-muted)', marginTop: 4 }}>{loadError}</p>}
          <div className="flex items-center justify-center gap-3 mt-5">
            {loadError && <button className="p-btn p-btn-ghost" onClick={loadAll}>Retry</button>}
            <button className="p-btn p-btn-ghost" onClick={leavePlayer}>{exitPath === '/operator' ? 'Back to jobs' : 'Back to Library'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup screen ───────────────────────────────────────────────────────────
  // Only reached when something genuinely still has to be asked (see
  // setupNeeded in components/player/runtime.ts). Everything below is laid out
  // so that Start Process is INSIDE a 1024x768 viewport without scrolling: the
  // fields sit two-up, the app's shape is a chip row rather than a panel, and
  // "Jobs in progress" — a list, not a decision — comes after the button.
  if (status === 'setup') {
    const setupGate = runContextGate(requireContext && !previewMode, selectedWorkOrderId, manualPartNumber);
    // A run already open on THIS unit. Joining it is legitimate and often
    // right, but it must be a decision made before starting, not something
    // discovered afterwards — so it sits above the button and holds it.
    const concurrent = previewMode
      ? null
      : concurrentRun(jobs, selectedWorkOrderId, manualPartNumber, { operatorUserId, operatorName });
    // Acknowledged is answered: the card stays on screen, but it stops holding.
    const holding = concurrentAck ? null : concurrent;
    const heldByConcurrent = !!holding;
    const startBlockedReason = !setupGate.ok
      ? setupGate.reason
      : holding
        ? concurrentHoldReason(holding)
        : '';

    return (
      <div className="p-root p-3 sm:p-5" style={{ overflowY: 'auto' }}>
        <div className="p-card w-full max-w-3xl mx-auto my-auto p-4 sm:p-6">
          {/* Compact header: name, description and the app's shape on one
              band. The old 56px badge plus a three-tile panel cost ~180px of
              a 768px screen and told the operator nothing they act on. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
            <Factory size={20} className="flex-shrink-0" style={{ color: 'var(--p-accent)' }} />
            <h1 className="flex-1 min-w-0" style={{ fontSize: 22, fontWeight: 800, color: 'var(--p-ink)' }}>
              {app.name}
            </h1>
            <span className="p-chip tnum" style={{ fontSize: 12.5 }}>
              {pluralize(app.steps.length, 'step')} · {pluralize(app.steps.reduce((a, s) => a + s.widgets.length, 0), 'field')}
              {app.steps.filter(s => s.takt_time_seconds).length > 0
                ? ` · ${app.steps.filter(s => s.takt_time_seconds).length} timed`
                : ''}
            </span>
            {previewMode && <span className="p-chip p-chip-gold" style={{ fontWeight: 750, fontSize: 12.5 }}>PREVIEW — nothing saved</span>}
          </div>
          {app.description && (
            <p style={{ fontSize: 13.5, color: 'var(--p-muted)', marginTop: -8, marginBottom: 14 }}>{app.description}</p>
          )}

          {/* Two-up fields. Each cell is one question; on a phone they stack. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <label className="p-label" htmlFor="setup-operator">Operator</label>
              {operatorUserId ? (
                <div className="p-well flex items-center gap-2.5 px-4" style={{ minHeight: 56 }}>
                  <BadgeCheck size={19} style={{ color: 'var(--p-good)' }} />
                  <span style={{ fontSize: 17, fontWeight: 650, color: 'var(--p-ink)' }} className="flex-1 truncate">{operatorName}</span>
                  <button
                    onClick={() => { setOperatorUserId(null); setOperatorName(''); }}
                    style={{ color: 'var(--p-muted)' }} aria-label="Clear operator"
                  ><X size={18} /></button>
                </div>
              ) : (
                <input
                  id="setup-operator"
                  className="p-input" placeholder="Enter your name…" value={operatorName}
                  onChange={e => setOperatorName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void startRun(); }}
                />
              )}
            </div>

            {!operatorUserId && (
              <div>
                <label className="p-label">Badge code (optional)</label>
                <div className="relative">
                  <ScanLine size={17} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--p-accent)' }} />
                  <input
                    className="p-input p-mono" style={{ paddingLeft: 42 }}
                    placeholder="Scan or type, then Enter" value={badgeInput}
                    onChange={e => { setBadgeInput(e.target.value); setBadgeError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void tryBadge(); } }}
                  />
                </div>
                {badgeError && <div className="p-field-error">{badgeError}</div>}
              </div>
            )}

            {stations.length > 0 && (
              <div>
                <label className="p-label" htmlFor="setup-station">Station (optional)</label>
                <select id="setup-station" className="p-input" value={selectedStationId} onChange={e => setSelectedStationId(e.target.value)}>
                  <option value="">— No station —</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.location ? ` · ${s.location}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {workOrders.length > 0 && (
              <div>
                <label className="p-label" htmlFor="setup-work-order">Work Order {requireContext ? '' : '(optional)'}</label>
                <select id="setup-work-order" className="p-input" value={selectedWorkOrderId} onChange={e => { setSelectedWorkOrderId(e.target.value); setConcurrentAck(false); }}>
                  <option value="">— No work order —</option>
                  {workOrders.map(wo => (
                    <option key={wo.id} value={wo.id} title={hasCompanyTag(wo.work_order_number) ? wo.work_order_number : undefined}>
                      {displayId(wo.work_order_number)} · {wo.part_name} ({wo.quantity_completed}/{wo.quantity})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Run context (player batch B): no work order → typed part number.
                Scan-friendly: mono font, Enter starts the run. */}
            {!selectedWorkOrderId && (
              <div>
                <label className="p-label">
                  <span className="inline-flex items-center gap-1.5">
                    <Hash size={14} style={{ color: 'var(--p-accent)' }} /> Part number
                    {requireContext && !previewMode && <span style={{ color: 'var(--p-bad)' }}>*</span>}
                  </span>
                </label>
                <div className="relative">
                  <ScanLine size={17} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--p-accent)' }} />
                  <input
                    className="p-input p-mono"
                    style={{ paddingLeft: 42 }}
                    placeholder="Scan or type a part number…"
                    value={manualPartNumber}
                    onChange={e => { setManualPartNumber(e.target.value); setActionError(null); setConcurrentAck(false); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void startRun(); } }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  />
                </div>
              </div>
            )}

            {productTypes.length > 0 && (
              <div>
                <label className="p-label flex flex-wrap items-center gap-x-1.5 gap-y-1" htmlFor="setup-product-type">
                  <span className="inline-flex items-center gap-1.5">
                    <Tag size={14} style={{ color: 'var(--p-accent)' }} /> Product Type
                  </span>
                  {productTypeLocked && <span className="p-chip p-chip-gold" style={{ fontSize: 11 }}><Lock size={10} /> from work order</span>}
                </label>
                <select
                  id="setup-product-type"
                  className="p-input" value={selectedProductTypeId} disabled={productTypeLocked}
                  onChange={e => setSelectedProductTypeId(e.target.value)}
                >
                  <option value="">— Standard (default takt) —</option>
                  {productTypes.map(pt => (
                    <option key={pt.id} value={pt.id}>{pt.name}{pt.description ? ` — ${pt.description}` : ''}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {linkNotice && (
            <div className="p-well flex items-center gap-2 px-4 py-3 mt-4" style={{ color: 'var(--p-warn)', fontSize: 14 }}>
              <AlertCircle size={15} className="flex-shrink-0" />
              {linkNotice}
            </div>
          )}

          {actionError && (
            <div className="p-well flex items-center gap-2 px-4 py-3 mt-4" style={{ color: 'var(--p-bad)', fontSize: 14 }}>
              <AlertCircle size={15} className="flex-shrink-0" />
              {actionError}
            </div>
          )}

          {/* The concurrent-run warning. ABOVE the button, and it holds the
              button, because "two people are on this unit" is a fact you have
              to answer before starting — not one to find out afterwards. */}
          {concurrent && (
            <div
              className="mt-4 p-3 sm:p-4"
              data-testid="concurrent-run-warning"
              style={{
                background: 'var(--p-gold-wash)',
                border: '1px solid rgba(245, 194, 74, 0.45)',
                borderRadius: 'var(--p-r-ctrl)',
                color: 'var(--p-warn-ink)',
              }}
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={17} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--p-gold)' }} />
                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: 15, fontWeight: 650 }}>
                    {concurrent.isMine ? 'You started this' : `${concurrent.operatorName || 'Someone'} started this`}
                    {concurrent.ageSeconds === null ? '' : ` ${fmtDuration(concurrent.ageSeconds)} ago`}
                    {concurrent.isMine ? ' — and it is still open' : ' — joining will share the run'}
                  </p>
                  <p style={{ fontSize: 13.5, marginTop: 3 }}>
                    {concurrent.isMine
                      ? 'Resume it to carry on where you left off, or start a separate run to record this unit twice.'
                      : 'Resume it to carry on where they left off, or start a separate run to record this unit twice.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="p-btn p-btn-ghost"
                  style={{ minHeight: 48, fontSize: 15, minWidth: 0 }}
                  onClick={() => void resumeJob(concurrent.job)}
                  disabled={resumingId !== null}
                >
                  {resumingId === concurrent.job.id ? 'Resuming…' : concurrent.isMine ? 'Resume your run' : 'Resume their run'}
                </button>
                {!concurrentAck && (
                  <button
                    className="p-btn p-btn-ghost"
                    style={{ minHeight: 48, fontSize: 15, minWidth: 0 }}
                    onClick={() => setConcurrentAck(true)}
                  >Start a separate run anyway</button>
                )}
              </div>
            </div>
          )}

          <button
            className="p-btn p-btn-primary w-full mt-4"
            onClick={() => void startRun()}
            disabled={starting || !setupGate.ok || heldByConcurrent}
            title={startBlockedReason || undefined}
          >
            {starting ? 'Starting…' : previewMode ? 'Start Preview' : 'Start Process'}
          </button>
          {startBlockedReason && (
            <p className="text-center" style={{ fontSize: 13, color: 'var(--p-warn)', marginTop: 8 }}>
              {startBlockedReason}
            </p>
          )}

          {/* Jobs in progress (player batch C): resume any operator's run at
              its saved position — with the last stint's handoff comment. */}
          {!previewMode && jobs.length > 0 && (
            <div className="pt-4">
              <div className="p-label" style={{ marginBottom: 10 }}>
                <span className="inline-flex items-center gap-1.5">
                  <Package size={14} style={{ color: 'var(--p-gold)' }} /> Jobs in progress
                </span>
              </div>
              <div className="space-y-2">
                {jobs.map(job => {
                  const jobWO = allWorkOrders.find(w => w.id === job.work_order_id);
                  const jobPN = typeof job.data?._part_number === 'string' ? job.data._part_number : '';
                  const stepIdxRaw = Number(job.data?._step_index ?? 0);
                  const stepPos = Number.isFinite(stepIdxRaw) ? Math.min(Math.max(0, stepIdxRaw), app.steps.length - 1) : 0;
                  const last = job.last_session;
                  const lastWhen = (last?.ended_at || last?.started_at || job.started_at || '').slice(0, 16);
                  return (
                    <div key={job.id} className="p-well p-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 min-w-0">
                          <div
                            className="truncate"
                            style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}
                            title={jobWO && hasCompanyTag(jobWO.work_order_number) ? jobWO.work_order_number : undefined}
                          >
                            {/* A run bound to a work order says so. It used to
                                read "No work order" for every routed job,
                                because the row it looked the number up in had
                                been filtered out from under it. */}
                            {jobWO
                              ? `${displayId(jobWO.work_order_number)} · ${jobWO.part_name}`
                              : job.work_order_id ? 'Work order'
                                : jobPN ? `PN ${jobPN}` : 'No work order'}
                          </div>
                          <div className="truncate" style={{ fontSize: 12.5, color: 'var(--p-muted)', marginTop: 2 }}>
                            Step {stepPos + 1}/{app.steps.length}
                            {' · '}{last?.operator_name || job.operator_name}
                            {lastWhen ? ` · ${lastWhen}` : ''}
                          </div>
                        </div>
                        <button
                          className="p-btn p-btn-ghost flex-shrink-0"
                          style={{ minHeight: 44, fontSize: 15 }}
                          onClick={() => void resumeJob(job)}
                          disabled={resumingId !== null}
                        >
                          {resumingId === job.id ? 'Resuming…' : 'Resume'}
                        </button>
                      </div>
                      {last?.handoff_comment && (
                        <div className="flex items-start gap-1.5 mt-2" style={{ fontSize: 12.5, color: 'var(--p-warn-ink)' }}>
                          <MessageSquare size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--p-gold)' }} />
                          <span>{last.handoff_comment}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            className="w-full py-2 text-sm mt-2" style={{ color: 'var(--p-muted)' }}
            onClick={leavePlayer}
          >← {exitPath === '/operator' ? 'Back to jobs' : 'Back to Library'}</button>
        </div>

        {qualBlock && (
          <QualificationSheet
            appName={qualBlock.app_name || app.name}
            operatorName={qualBlock.operator_name}
            state={qualBlock.state}
            expiryDate={qualBlock.expiry_date}
            submitting={qualSubmitting}
            error={qualError}
            onCancel={() => { setQualBlock(null); leavePlayer(); }}
            onApprove={pin => void approveQualification(pin)}
            demoSupervisorPin={demoHints?.supervisor_pin ?? null}
          />
        )}
      </div>
    );
  }


  // ── Completed screen (spec §5.6) ───────────────────────────────────────────
  if (status === 'completed') {
    const kitSummary = kit
      ? (() => { const p = kitProgress(kit.lines, false); return `${p.done}/${p.total}${p.short ? ` · ${p.short} short` : ''}`; })()
      : null;
    // Next-unit run context (player batch B): carried forward from this run,
    // one-tap change, disabled with a short reason until context exists.
    const contextLabel = selectedWO
      ? `${displayId(selectedWO.work_order_number)} · ${selectedWO.part_name}`
      : manualPartNumber.trim() ? `PN ${manualPartNumber.trim()}` : null;
    const summaryGate = runContextGate(requireContext && !previewMode, selectedWorkOrderId, manualPartNumber);
    return (
      <RunSummary
        appName={app.name}
        operatorName={operatorName}
        completionId={completionId}
        productTypeName={selectedPT?.name}
        steps={app.steps}
        stepTimes={stepTimes}
        getStepTakt={getStepTakt}
        taktExceededSteps={taktExceededSteps}
        capturedCount={capturedRef.current.size}
        kitSummary={kitSummary}
        savedLocally={savedLocally}
        unitsLabel={unitsLabel}
        contextLabel={contextLabel}
        nextUnitDisabledReason={summaryGate.ok ? undefined : summaryGate.reason}
        onChangeContext={changeContext}
        onNextUnit={() => void nextUnit()}
        onDone={leavePlayer}
        // The run that just finished, on its own page: its steps, its times,
        // its captured values. A department report filtered by app cannot show
        // an individual run, which is the one thing the person who just ran it
        // wants to see. Offered only when there IS a run to open and this
        // account can reach the report side at all.
        onReview={completionId && !previewMode && canAccessReportPortal
          ? () => navigate(`/completions/${completionId}`)
          : undefined}
      />
    );
  }

  if (status === 'abandoned') {
    return (
      <div className="p-root items-center justify-center p-4 sm:p-6">
        <div className="p-card w-full max-w-md p-6 sm:p-8 text-center">
          <div className="mx-auto mb-4 flex items-center justify-center rounded-full" style={{ width: 64, height: 64, background: 'var(--p-surface-2)' }}>
            <X size={32} style={{ color: 'var(--p-muted)' }} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 750, color: 'var(--p-ink)', marginBottom: 6 }}>Process Abandoned</h1>
          <p style={{ fontSize: 14, color: 'var(--p-muted)', marginBottom: 22 }}>Stopped before completion.</p>
          <div className="flex gap-3">
            <button
              className="p-btn p-btn-primary flex-1" style={{ minWidth: 0 }}
              onClick={() => { setStatus('setup'); statusRef.current = 'setup'; setCompletionId(null); completionIdRef.current = null; resetRunState(); }}
            >Start Over</button>
            <button className="p-btn p-btn-ghost flex-1" onClick={leavePlayer}>Exit</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Running ────────────────────────────────────────────────────────────────

  const isLast = currentStepIdx === app.steps.length - 1;
  const canBack = currentStepIdx > 0;
  const hasKitWidgetInStep = currentStep?.widgets.some(w => w.type === 'kit-checklist') ?? false;
  // Footer-hiding rule (player batch A2): a step whose own button widget
  // navigates hides the footer Next/Complete — exactly one way to advance.
  const hideForwardNav = stepHidesFooterNav(currentStep);
  const taktBar = taktBarState(stepTaktSeconds, stepElapsed);

  return (
    <>
      <PlayerShell
        header={
          <PlayerHeader
            appName={app.name}
            workOrderNumber={selectedWO?.work_order_number}
            partName={selectedWO?.part_name}
            productTypeName={selectedPT?.name}
            operatorName={operatorDisplayName(operatorName)}
            operatorVerified={operatorUserId !== null}
            stepIndex={currentStepIdx}
            stepCount={app.steps.length}
            taktSeconds={stepTaktSeconds}
            stepElapsed={stepElapsed}
            isOverTakt={isOverTakt}
            paused={paused}
            offlinePending={outboxDepth}
            isOffline={isOffline}
            preview={previewMode}
            hasPartsList={(currentStep?.parts_list?.length ?? 0) > 0}
            onTogglePause={togglePause}
            onAbandon={() => setAbandonOpen(true)}
            onShowParts={() => setShowPartsOverlay(o => !o)}
            onReportProblem={() => setReportOpen(true)}
            onRequestHelp={() => { setHelpError(''); setHelpOpen(true); }}
            helpRequested={activeCalls.length > 0}
            onLeaveJob={previewMode ? undefined : () => setLeaveOpen(true)}
          />
        }
        banner={
          <>
            {/* Always-visible takt countdown: slim bar draining with remaining
                time — green → amber at 20% → red (player batch A3). */}
            {taktBar && (
              <div className="p-taktbar" role="progressbar" aria-label="Takt time remaining"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(taktBar.fraction * 100)}>
                <div
                  className={`p-taktbar-fill p-taktbar-${taktBar.level}`}
                  style={{ width: `${taktBar.fraction * 100}%` }}
                />
              </div>
            )}
            {/* A team has been called and hasn't closed it out yet. The run
                underneath keeps going — this is status, not a blocker. */}
            {activeCalls.map(call => (
              <AlertBanner
                key={call.id}
                call={call}
                ageSeconds={Math.max(0, Math.round((nowTick - (callRaisedAtRef.current[call.id] ?? nowTick)) / 1000))}
                cancelling={cancellingCallId === call.id}
                onCancel={() => void cancelCall(call)}
              />
            ))}
            {handoffNote && (
              <div
                className="flex items-center gap-2.5 px-4 py-2.5 flex-shrink-0"
                style={{ background: 'var(--p-gold-wash)', borderBottom: '1px solid rgba(245, 194, 74, 0.4)', color: 'var(--p-warn-ink)', fontSize: 14, fontWeight: 550 }}
              >
                <MessageSquare size={15} className="flex-shrink-0" style={{ color: 'var(--p-gold)' }} />
                <span className="flex-1">Handoff — {handoffNote}</span>
                <button onClick={() => setHandoffNote(null)} aria-label="Dismiss handoff note" style={{ color: 'var(--p-muted)', width: 32, height: 32 }} className="flex items-center justify-center flex-shrink-0">
                  <X size={16} />
                </button>
              </div>
            )}
            {isOverTakt && (
              // --p-live carries white at 4.51:1 — one rounding step above the
              // AA floor for this 14px label, which is no margin at all on a
              // sunlit shop floor. The banner uses the deeper alarm red, where
              // the same label measures 5.46:1.
              <div
                className="flex items-center justify-center gap-2.5 py-2 px-3 flex-shrink-0 text-center"
                style={{ background: 'var(--p-bad-strong)', color: '#fff', fontSize: 14, fontWeight: 750, letterSpacing: '0.5px' }}
              >
                <AlertTriangle size={15} className="flex-shrink-0" />
                TAKT TIME EXCEEDED — {formatDur(stepElapsed - stepTaktSeconds)} OVER
                <Zap size={15} className="flex-shrink-0" />
              </div>
            )}
            {blockBanner && (
              <BlockBanner
                text={blockBanner}
                onDismiss={() => setBlockBanner(null)}
                onLocate={blockedWidgetId ? showBlockers : undefined}
              />
            )}
          </>
        }
        summaryBar={showKitChrome && kit ? (
          <KitSummaryBar lines={kit.lines} requireScan={kitW?.config.requireScan ?? false} kitStatus={kit.status} />
        ) : undefined}
        footer={
          <PlayerFooter
            stepIndex={currentStepIdx}
            stepCount={app.steps.length}
            canBack={canBack}
            isLast={isLast}
            blocked={navBlocked}
            blockReason={blockReason}
            completing={completing}
            hideForward={hideForwardNav}
            onShowBlocker={navBlocked ? showBlockers : undefined}
            onBack={() => requestNavigate({ to: 'prev' })}
            onNext={() => requestNavigate({ to: 'next' })}
            onComplete={() => requestNavigate({ to: 'complete' })}
          />
        }
        toasts={toasts}
        onDismissToast={tid => setToasts(prev => prev.filter(t => t.id !== tid))}
      >
        <div className={`w-full space-y-4 ${currentStep?.layoutMode === 'canvas' ? 'max-w-3xl' : 'max-w-2xl'}`}>
          {/* Step title. The takt chip drops below the name on a phone: side by
              side it left the heading about 110px, which hyphenated "Re-torque
              check" down three lines at 28px. */}
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <h2 style={{ fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 800, color: 'var(--p-ink)' }} className="flex-1 min-w-0">
              {currentStep?.name}
            </h2>
            {stepTaktSeconds > 0 && (
              <div className="p-chip flex-shrink-0 tnum" style={{ minHeight: 40, fontSize: 14 }}>
                Takt {formatDur(stepTaktSeconds)} · Now {formatDur(stepElapsed)}
              </div>
            )}
          </div>
          {currentStep?.description && (
            <p style={{ fontSize: 16, color: 'var(--p-ink-2)' }}>{currentStep.description}</p>
          )}

          {/* Legacy parts overlay (menu-toggled) */}
          {showPartsOverlay && currentStep?.parts_list && currentStep.parts_list.length > 0 && (
            <div className="p-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}>
                  <Package size={15} style={{ color: 'var(--p-accent)' }} />
                  Parts &amp; Materials — {currentStep.name}
                </div>
                <button onClick={() => setShowPartsOverlay(false)} style={{ color: 'var(--p-muted)' }} aria-label="Close parts">
                  <X size={16} />
                </button>
              </div>
              <div>
                {currentStep.parts_list.map((part, i) => (
                  <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: i < currentStep.parts_list!.length - 1 ? '1px solid var(--p-grid)' : 'none' }}>
                    <div className="flex-1 min-w-0">
                      <span style={{ fontSize: 15, fontWeight: 550, color: 'var(--p-ink)' }}>{part.name}</span>
                      {part.sku && <span className="p-mono ml-2" style={{ fontSize: 13, color: 'var(--p-muted)' }}>#{part.sku}</span>}
                    </div>
                    <span className="tnum" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-accent)' }}>
                      {part.quantity}{part.unit ? ` ${part.unit}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step content */}
          {currentStep?.layoutMode === 'canvas' ? (
            <CanvasStage
              widgets={currentStep.widgets}
              height={currentStep.canvasHeight ?? 560}
              background={currentStep.canvasBackground}
              invalidByWidget={invalidByWidget}
              values={formData as Record<string, unknown>}
              onChange={(key, val) => {
                const w = currentStep.widgets.find(x => legacyKey(x) === key);
                if (w) setField(w, val);
              }}
              onNext={() => requestNavigate({ to: 'next' })}
              onPrev={() => requestNavigate({ to: 'prev' })}
              onComplete={() => requestNavigate({ to: 'complete' })}
            />
          ) : (
            currentStep?.widgets.map(widget => {
              const invalidMessage = invalidByWidget[widget.id];
              return (
                // The wrapper is what a refused forward tap scrolls to and
                // focuses: a container, so the phone keyboard never opens by
                // itself. It also carries the invalid ring, which is why every
                // widget type gets one without the renderer knowing.
                <div
                  key={widget.id}
                  id={`pw-${widget.id}`}
                  data-widget-id={widget.id}
                  tabIndex={-1}
                  style={{
                    scrollMarginTop: 96,
                    scrollMarginBottom: 96,
                    outline: invalidMessage ? '2px solid var(--p-bad)' : 'none',
                    outlineOffset: 6,
                    borderRadius: 14,
                  }}
                >
                  <PlayerWidget
                    widget={widget}
                    step={currentStep}
                    value={formData[legacyKey(widget)]}
                    invalidMessage={invalidMessage}
                    variables={variables}
                    appInfo={buildAppInfo()}
                    preview={previewMode}
                    onChange={(w, v) => setField(w, v)}
                    onButtonPress={onButtonPress}
                    onTimerDone={onTimerDone}
                    onTimerTick={onTimerTick}
                    onScanCode={onWidgetScan}
                    onRequestCameraScan={w => setScannerTarget({ widget: w })}
                    renderKit={w => renderKitPanel(w)}
                  />
                </div>
              );
            })
          )}

          {/* Implicit kit chrome for kit steps without a kit-checklist widget */}
          {currentStep?.step_type === 'kit' && !hasKitWidgetInStep && renderKitPanel(null)}
        </div>
      </PlayerShell>

      {/* Camera scanner modal (shared component, unchanged) */}
      {scannerTarget && (
        <BarcodeScannerModal
          title={scannerTarget.widget ? (scannerTarget.widget.label || 'Scan') : 'Scan kit item'}
          hint={scannerTarget.widget ? undefined : 'Scan a part barcode to verify the kit line'}
          onClose={() => setScannerTarget(null)}
          onScan={code => {
            const target = scannerTarget;
            setScannerTarget(null);
            if (target.widget) onWidgetScan(target.widget, code);
            else onGlobalScan(code);
          }}
        />
      )}

      {/* One-time full-screen red flash at takt zero (player batch A3) */}
      {taktFlash && <div className="p-takt-flash-overlay" aria-hidden="true" />}

      {/* Request help (M6): pick who you need, add a note, keep running. The
          alert is an andon_call carrying this run's full context. */}
      {helpOpen && (
        <RequestHelpSheet
          context={callContext}
          departments={departments}
          submitting={helpSubmitting}
          error={helpError}
          alertedTeams={activeCalls.filter(c => c.target_type !== 'department').map(c => c.team)}
          alertedDepartments={activeCalls.filter(c => c.target_type === 'department' && c.department_id).map(c => c.department_id as string)}
          onClose={() => setHelpOpen(false)}
          onRequest={(target, note) => void raiseCall(target, note)}
        />
      )}

      {/* In-run quality issue (player batch C1): NCR filing mid-run without
          losing progress — requires supervisor PIN authorization server-side. */}
      {reportOpen && (
        <ReportProblemSheet
          preview={previewMode}
          onClose={() => setReportOpen(false)}
          onSubmit={async (title, severity, description, pin) => {
            if (previewMode) {
              debug(`create_ncr: ${severity} — ${title} (suppressed)`);
              setReportOpen(false);
              return null;
            }
            let auth: { authorization_id: string; user_id: string; display_name: string; role: string };
            try {
              auth = await api.verifyAuthorizer(pin);
            } catch (err) {
              return err instanceof Error ? err.message : 'Authorization failed';
            }
            const payload = {
              title, description, severity,
              source: 'production',
              app_id: id ?? null,
              completion_id: completionIdRef.current,
              work_order_id: selectedWorkOrderId || null,
              operator_name: operatorName,
              // Single-use proof the PIN was verified server-side. The server
              // stamps authorized_by / authorized_by_user_id from this grant —
              // sending those fields directly would be rejected.
              authorization_id: auth.authorization_id,
              step_name: appRef.current?.steps[stepIdxRef.current]?.name ?? '',
            };
            try {
              await api.createNCR(payload);
              pushToast('info', `Quality issue filed — authorized by ${auth.display_name}`);
            } catch {
              queueNCR(payload);
              pushToast('warning', 'Problem report queued — will sync');
            }
            setReportOpen(false); // the run continues exactly where it was
            return null;
          }}
        />
      )}

      {/* Units this run (finish step). One control, four numbers, two taps: the
          happy path is Complete → Complete. Nothing typed = nothing counted. */}
      {finishOpen && (
        <UnitsSheet
          unitsRun={unitsRun}
          good={unitsGood}
          scrap={unitsScrap}
          rework={unitsRework}
          scrapReasonCodeId={unitsReasonId}
          scrapCodes={scrapCodes}
          touched={unitsTouched}
          error={unitsError}
          completing={completing}
          onEdit={editUnits}
          onClose={() => { setFinishOpen(false); setUnitsError(''); }}
          onConfirm={confirmFinish}
        />
      )}

      {/* Pause-and-leave with an optional handoff comment (player batch C2) */}
      {leaveOpen && (
        <LeaveJobSheet
          leaving={leaving}
          onClose={() => { if (!leaving) setLeaveOpen(false); }}
          onLeave={comment => leaveJob(comment)}
        />
      )}

      {/* Stopping the run. A separate, destructive sheet — never a browser
          confirm() sitting one menu row away from "Leave job". */}
      {abandonOpen && (
        <AbandonRunSheet
          stepPosition={currentStepIdx + 1}
          stepCount={app.steps.length}
          stepsTimed={Object.keys(stepTimes).length}
          valuesCaptured={capturedRef.current.size}
          onClose={() => setAbandonOpen(false)}
          onAbandon={() => { setAbandonOpen(false); abandonRun(); }}
        />
      )}

      {/* Preview debug drawer (outbox actions land here instead of the API) */}
      {previewMode && (
        <div className="p-debug-drawer">
          <button
            className="w-full flex items-center justify-between px-3 py-2"
            style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--p-gold)' }}
            onClick={() => setDrawerOpen(o => !o)}
          >
            <span>PREVIEW LOG · {debugLog.length}</span>
            {drawerOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {drawerOpen && (
            <div className="px-3 pb-3 space-y-1.5">
              {debugLog.length === 0 && <div style={{ color: 'var(--p-muted)' }}>No suppressed writes yet.</div>}
              {[...debugLog].reverse().map(e => (
                <div key={e.id} className="p-mono" style={{ color: 'var(--p-ink-2)', wordBreak: 'break-all' }}>
                  <span style={{ color: 'var(--p-muted)' }}>{e.ts}</span> {e.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Report quality issue bottom sheet (supervisor-authorized NCR) ───────────
// Filing requires authorization: a supervisor (or above) enters their operator
// PIN, verified server-side by POST /api/operators/verify-authorizer. The run
// keeps its state while the sheet is open — nothing is paused or reset.

function ReportProblemSheet({ preview, onClose, onSubmit }: {
  preview: boolean;
  onClose: () => void;
  /** Resolves to null on success (sheet closed by the caller) or an error
   *  message to show inline (bad PIN / insufficient role / offline). */
  onSubmit: (title: string, severity: NCRSeverity, description: string, pin: string) => Promise<string | null>;
}) {
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<NCRSeverity>('minor');
  const [description, setDescription] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting || !title.trim() || (!preview && !pin.trim())) return;
    setSubmitting(true);
    setError('');
    const problem = await onSubmit(title.trim(), severity, description.trim(), pin.trim());
    setSubmitting(false);
    if (problem) setError(problem);
  };

  return (
    <div className="p-sheet-backdrop" onClick={onClose}>
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }}>
            <AlertTriangle size={19} style={{ color: 'var(--p-warn)' }} /> Report quality issue
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--p-muted)', width: 44, height: 44 }} className="flex items-center justify-center">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="p-label">What happened?</label>
            <input className="p-input" placeholder="Short summary…" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="p-label">Severity</label>
            <div className="flex gap-2">
              {(['minor', 'major', 'critical'] as NCRSeverity[]).map(s => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className="flex-1 rounded-xl capitalize"
                  style={{
                    minHeight: 52, fontSize: 15, fontWeight: 650,
                    background: severity === s ? 'var(--p-accent)' : 'var(--p-surface-2)',
                    color: severity === s ? 'var(--p-on-accent)' : 'var(--p-ink-2)',
                    border: `1px solid ${severity === s ? 'var(--p-accent)' : 'var(--p-baseline)'}`,
                  }}
                >{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="p-label">Details (optional)</label>
            <textarea
              className="p-input" rows={3} style={{ minHeight: 88, resize: 'vertical' }}
              placeholder="Anything that helps quality investigate…"
              value={description} onChange={e => setDescription(e.target.value)}
            />
          </div>
          {!preview && (
            <div>
              <label className="p-label flex items-center gap-1.5">
                <ShieldCheck size={15} style={{ color: 'var(--p-good)' }} /> Supervisor PIN (authorization)
              </label>
              <input
                className="p-input p-mono"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Supervisor enters their PIN…"
                value={pin}
                onChange={e => { setPin(e.target.value); setError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
              />
              <p style={{ fontSize: 12.5, color: 'var(--p-muted)', marginTop: 6 }}>
                A supervisor or above must authorize filing this report.
              </p>
            </div>
          )}
          {error && <div className="p-field-error">{error}</div>}
          <button
            className="p-btn p-btn-primary w-full"
            disabled={submitting || !title.trim() || (!preview && !pin.trim())}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 size={20} className="animate-spin" /> : null}
            {submitting ? 'Authorizing…' : preview ? 'Submit report' : 'Authorize & submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stop-the-run bottom sheet ───────────────────────────────────────────────
// This used to be window.confirm('Stop this process?'), which is a browser
// dialog with an OK button: it does not say what is lost, it cannot be styled
// to look destructive, and it sat one menu row below "Leave job (save
// progress)" — two adjacent taps, one of which throws the work away.
//
// The sheet states the actual, measured cost: how far in the run got, how many
// steps were timed, how many values were captured. Never a fabricated figure —
// a run with nothing recorded says so.

// ─── Units this run (finish step) ────────────────────────────────────────────
//
// Production quantity used to be good-only: a run happened, therefore one good
// piece existed. First-pass yield, scrap by part and the cost of poor quality
// were all uncomputable, and the only scrap number in the product was one a
// supervisor typed into a shift note at the end of a shift, from memory.
//
// The control has to be fast enough that nobody routes around it, and honest
// enough to be worth having. So:
//
//   • Good is prefilled with 1 — the happy path is Complete, Complete;
//   • the scrap reason only appears once scrap is non-zero, and is then
//     REQUIRED: scrap with no reason is a number nobody can act on;
//   • the moment any number is edited, all four have to add up, and the
//     mismatch is NAMED rather than called "invalid";
//   • a run whose numbers were never touched sends nothing at all, so the
//     database can still tell "nobody counted" from "counted zero".
//
// No autoFocus: an operator holding a part in one hand does not want a keyboard
// jumping up at them.

function UnitsSheet({
  unitsRun, good, scrap, rework, scrapReasonCodeId, scrapCodes, touched, error, completing,
  onEdit, onClose, onConfirm,
}: {
  unitsRun: number;
  good: number;
  scrap: number;
  rework: number;
  scrapReasonCodeId: string;
  scrapCodes: ReasonCode[];
  touched: boolean;
  error: string;
  completing: boolean;
  onEdit: (patch: Partial<{ run: number; good: number; scrap: number; rework: number; reason: string }>) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  };
  const sum = good + scrap + rework;
  const field = (label: string, value: number, onChange: (n: number) => void, id: string) => (
    <div>
      <label className="p-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        className="p-input tnum"
        style={{ minHeight: 52, fontSize: 20, fontWeight: 700 }}
        value={String(value)}
        onChange={e => onChange(num(e.target.value))}
      />
    </div>
  );

  return (
    <div className="p-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Units this run">
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }}>
            <Package size={18} style={{ color: 'var(--p-accent)' }} /> Units this run
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--p-muted)', width: 44, height: 44 }} className="flex items-center justify-center">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {field('Units run', unitsRun, n => onEdit({ run: n }), 'units-run')}
            {field('Good', good, n => onEdit({ good: n }), 'units-good')}
            {field('Scrap', scrap, n => onEdit({ scrap: n }), 'units-scrap')}
            {field('Rework', rework, n => onEdit({ rework: n }), 'units-rework')}
          </div>

          {scrap > 0 && (
            <div>
              <label className="p-label" htmlFor="units-scrap-reason">What was the scrap?</label>
              {scrapCodes.length > 0 ? (
                <select
                  id="units-scrap-reason"
                  className="p-input"
                  style={{ minHeight: 52, fontSize: 16 }}
                  value={scrapReasonCodeId}
                  onChange={e => onEdit({ reason: e.target.value })}
                >
                  <option value="">Pick a reason…</option>
                  {scrapCodes.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              ) : (
                // Nothing to pick, so the run is NOT held hostage to a list a
                // manager has not made. The scrap is still counted; the yield
                // report labels it "No reason recorded" rather than guessing.
                <p style={{ fontSize: 14, color: 'var(--p-warn)' }}>
                  A manager has not set up scrap reasons yet — the scrap is still counted,
                  it just cannot say why.
                </p>
              )}
            </div>
          )}

          {touched && (
            <p className="tnum" style={{ fontSize: 13.5, color: sum === unitsRun ? 'var(--p-muted)' : 'var(--p-warn)' }}>
              {good} + {scrap} + {rework} = {sum} of {unitsRun}
            </p>
          )}
          {error && (
            <p className="p-well px-4 py-3" style={{ fontSize: 14.5, color: 'var(--p-warn)' }}>{error}</p>
          )}
          {!touched && (
            <p style={{ fontSize: 13.5, color: 'var(--p-muted)' }}>
              Leave this alone and the run is recorded without a count, exactly as before.
            </p>
          )}

          <div className="flex gap-3">
            <button className="p-btn p-btn-primary flex-1" style={{ minWidth: 0 }} onClick={onConfirm} disabled={completing}>
              {completing ? <Loader2 size={18} className="animate-spin" /> : null} Complete
            </button>
            <button className="p-btn p-btn-ghost flex-1" style={{ minWidth: 0 }} onClick={onClose} disabled={completing}>
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AbandonRunSheet({ stepPosition, stepCount, stepsTimed, valuesCaptured, onClose, onAbandon }: {
  stepPosition: number;
  stepCount: number;
  stepsTimed: number;
  valuesCaptured: number;
  onClose: () => void;
  onAbandon: () => void;
}) {
  const lost = [
    stepsTimed > 0 ? `${stepsTimed} step ${stepsTimed === 1 ? 'time' : 'times'}` : null,
    valuesCaptured > 0 ? `${valuesCaptured} captured ${valuesCaptured === 1 ? 'value' : 'values'}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="p-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Stop this run">
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }}>
            <AlertTriangle size={19} style={{ color: 'var(--p-bad)' }} /> Stop this run?
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--p-muted)', width: 44, height: 44 }} className="flex items-center justify-center">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <p style={{ fontSize: 15, color: 'var(--p-ink-2)' }}>
            The run is marked <strong style={{ color: 'var(--p-ink)' }}>abandoned</strong> at
            step {stepPosition} of {stepCount}. It stays in Run History as a stopped run and
            cannot be picked up again.
          </p>
          <p style={{ fontSize: 15, color: 'var(--p-ink-2)' }}>
            {lost.length > 0
              ? `${lost.join(' and ')} recorded so far will not count as production.`
              : 'Nothing has been recorded on this run yet.'}
          </p>
          <p style={{ fontSize: 14, color: 'var(--p-muted)' }}>
            To hand the job on instead, close this and choose Leave job — that saves your
            progress for the next operator.
          </p>
          <div className="flex gap-3">
            <button className="p-btn p-btn-primary flex-1" style={{ minWidth: 0 }} onClick={onClose}>
              Keep working
            </button>
            <button
              className="p-btn p-btn-ghost flex-1"
              style={{ minWidth: 0, color: 'var(--p-bad)', borderColor: 'var(--p-bad)' }}
              onClick={onAbandon}
            >
              Stop and discard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Leave-job bottom sheet (pause-and-leave with handoff comment) ───────────

function LeaveJobSheet({ leaving, onClose, onLeave }: {
  leaving: boolean;
  onClose: () => void;
  onLeave: (handoffComment: string) => void;
}) {
  const [comment, setComment] = useState('');

  return (
    <div className="p-sheet-backdrop" onClick={onClose}>
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }}>
            <MessageSquare size={18} style={{ color: 'var(--p-gold)' }} /> Leave job
          </div>
          <button onClick={onClose} aria-label="Close" style={{ color: 'var(--p-muted)', width: 44, height: 44 }} className="flex items-center justify-center">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4">
          <p style={{ fontSize: 14.5, color: 'var(--p-ink-2)' }}>
            Progress is saved at the current step. The job stays in
            &ldquo;Jobs in progress&rdquo; so any operator can pick it up.
          </p>
          <div>
            <label className="p-label">Handoff note (optional)</label>
            <textarea
              className="p-input" rows={3} style={{ minHeight: 88, resize: 'vertical' }}
              placeholder="Anything the next operator should know…"
              value={comment} onChange={e => setComment(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button className="p-btn p-btn-ghost flex-1" onClick={onClose} disabled={leaving}>Keep working</button>
            <button
              className="p-btn p-btn-primary flex-1"
              style={{ minWidth: 0 }}
              onClick={() => onLeave(comment.trim())}
              disabled={leaving}
            >
              {leaving ? 'Saving…' : 'Save & leave'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
