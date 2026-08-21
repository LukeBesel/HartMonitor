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
import type { CompletionFlushPayload, CompletionSession, JobInProgress, KitLineUpdate } from '../api/client';
import type {
  App, Step, Widget, WorkOrder, ProductType, Station,
  Kit, KitLine, KitStatus, BOM, BOMLine, NCRSeverity,
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
import {
  collectStepTriggers, evaluateKitScan, formatDur, getStepBlocks, kitProgress,
  kitWidgetFor, legacyKey, runContextGate, runContextRequired, stepHidesFooterNav,
  stepShowsKit, stepTaktSeconds as taktOfStep, summarizeBlocks, taktBarState, valueInputFor,
} from '../components/player/runtime';
import type { BlockItem } from '../components/player/runtime';
import '../player.css';

// Work-order fields added by the v2 backend (list returns wo.*).
interface WorkOrderExt extends WorkOrder {
  product_type_id?: string | null;
}

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

  // ── Loading / catalog state ────────────────────────────────────────────────
  const [app, setApp] = useState<App | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderExt[]>([]);
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
  // Multi-operator sessions (player batch C)
  const [jobs, setJobs] = useState<JobInProgress[]>([]);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Takt polish (player batch A3): one-time full-screen flash at takt zero
  const [taktFlash, setTaktFlash] = useState(false);

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
  const [toasts, setToasts] = useState<PlayerToast[]>([]);
  const [poppedLineId, setPoppedLineId] = useState<string | null>(null);
  const [showPartsOverlay, setShowPartsOverlay] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<{ widget: Widget | null } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
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

  const selectedWO = workOrders.find(w => w.id === selectedWorkOrderId);
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

  // ── Load app + catalogs ────────────────────────────────────────────────────
  const loadAll = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    Promise.all([api.getApp(id), api.getWorkOrders(), api.getProductTypes(id), api.getStations()])
      .then(([a, wos, pts, sts]: [AppExt, WorkOrderExt[], ProductType[], Station[]]) => {
        // Compute the run-context rule from the RAW blob — normalizeApp
        // force-upgrades schema_version in memory (spec: absent flag → enforce
        // only for schema_version ≥ 2; explicit false → never; true → always).
        setRequireContext(runContextRequired(a));
        setApp(normalizeApp(a));
        setWorkOrders(wos.filter(w => w.app_id === id && w.status !== 'completed' && w.status !== 'cancelled'));
        setProductTypes(pts);
        setStations(sts.filter(s => s.status === 'active'));
        const woParam = searchParams.get('wo');
        const nameParam = searchParams.get('name');
        const stationParam = searchParams.get('station');
        if (woParam) setSelectedWorkOrderId(woParam);
        if (nameParam) setOperatorName(nameParam);
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

  // "Jobs in progress" for the setup screen — this app's in_progress runs, any
  // operator can pick one up at its saved position. Refreshed whenever the
  // setup screen shows (start, next-unit context change, leave-job return).
  const refreshJobs = useCallback(() => {
    if (!id || previewMode) return;
    api.getJobsInProgress(id)
      .then(list => setJobs(list))
      .catch(() => setJobs([]));
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
      operator: operatorNameRef.current || 'Operator',
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

  const captureStepExitValues = useCallback((step: Step | undefined) => {
    if (!step) return;
    for (const w of step.widgets) {
      if (w.type === 'timer') {
        const el = timerElapsedRef.current[w.id];
        if (el !== undefined && el > 0) bufferValue(step, w, el);
      }
    }
  }, [bufferValue]);

  const doComplete = useCallback(async () => {
    const cid = completionIdRef.current;
    setCompleting(true);
    const values = [...valuesBufferRef.current.values()].filter((v): v is NonNullable<typeof v> => v !== null);
    const body: CompletionFlushPayload = {
      status: 'completed',
      data: { ...formDataRef.current },
      step_times: { ...stepTimesRef.current },
      takt_exceeded_steps: taktExceededRef.current,
      values,
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

  const commitNavigate = useCallback((intent: NavIntent, depth = 0) => {
    if (depth > 8) return;
    const a = appRef.current;
    if (!a) return;
    const idx = stepIdxRef.current;

    recordStepTime(idx);
    captureStepExitValues(a.steps[idx]);

    if (intent.to === 'complete') { void doComplete(); return; }

    let target = idx;
    if (intent.to === 'next') target = idx + 1;
    else if (intent.to === 'prev') {
      target = historyRef.current.length > 0 ? historyRef.current.pop()! : Math.max(0, idx - 1);
    } else if (intent.to === 'step') {
      const t = a.steps.findIndex(s => s.id === intent.stepId);
      if (t === -1) return;
      target = t;
    }
    if (intent.to === 'next' && target >= a.steps.length) { void doComplete(); return; }
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
  }, [recordStepTime, captureStepExitValues, doComplete, flushValues, buildState, applyNonNavEffect]);

  const requestNavigate = useCallback((intent: NavIntent) => {
    const a = appRef.current;
    if (!a || statusRef.current !== 'running') return;
    const step = a.steps[stepIdxRef.current];
    const forward = intent.to !== 'prev';

    // 1. Standing validation gate (forward only)
    if (forward && step) {
      const blocks = computeBlocks();
      if (blocks.length > 0) {
        const onlyKit = blocks.every(b => b.kind === 'kit');
        if (!(onlyKit && hasShortRouting(step))) return; // footer already shows the reason
      }
    }

    // 2. step_exit triggers — may block or redirect
    const effects = runTriggers(collectStepTriggers(step), 'step_exit', buildState());
    let finalIntent = intent;
    let blocked = false;
    for (const eff of effects) {
      if (eff.kind === 'navigate') {
        finalIntent = { to: eff.to, stepId: eff.stepId };
      } else if (eff.kind === 'block') {
        blocked = true;
        setBlockBanner(eff.text);
      } else {
        applyNonNavEffect(eff);
      }
    }
    if (blocked) return;

    // 3–4. commit + step_enter of target
    commitNavigate(finalIntent);
  }, [computeBlocks, hasShortRouting, buildState, applyNonNavEffect, commitNavigate]);

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
    const payload: KitLineUpdate = { ...data, actor: operatorNameRef.current || 'Operator' };
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
    timerElapsedRef.current = {};
    setPhotoGates({});
    photoGatesRef.current = {};
    setBlockBanner(null);
    setPaused(false);
    pausedAtRef.current = null;
    setSavedLocally(false);
    setShowPartsOverlay(false);
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
        return api.resolveBOM(workOrderId)
          .then(b => setBomFallback(b))
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
    if (selectedStationId) localStorage.setItem('hm_station', selectedStationId);
    else localStorage.removeItem('hm_station');
    setStarting(true);
    setActionError(null);
    try {
      if (!previewMode) {
        const c = await api.createCompletion({
          app_id: id,
          operator_name: operatorName || 'Operator',
          work_order_id: selectedWorkOrderId || undefined,
          product_type_id: selectedProductTypeId || undefined,
          station_id: selectedStationId || undefined,
          operator_user_id: operatorUserId || undefined,
        });
        setCompletionId(c.id);
        completionIdRef.current = c.id;
        // Open this operator's session stint (best-effort — an offline start
        // still runs; the roster is also dual-written client-side below).
        api.openCompletionSession(c.id, {
          operator_name: operatorName || 'Operator',
          operator_user_id: operatorUserId || undefined,
        }).catch(() => undefined);
      } else {
        setCompletionId(null);
        completionIdRef.current = null;
        debug('run started — preview mode, no completion created');
      }
      resetRunState();
      // Seed run context + operator roster into the data blob. A manual part
      // number is stored in data._part_number AND as a completion_values row
      // (widget_id '_part_number', labeled 'Part number').
      const seeded: Record<string, unknown> = { _operators: [operatorName || 'Operator'] };
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
      setActionError(err instanceof Error ? err.message : 'Failed to start process');
    } finally {
      setStarting(false);
    }
  }, [id, starting, previewMode, operatorName, operatorUserId, selectedWorkOrderId, selectedProductTypeId,
    selectedStationId, requireContext, manualPartNumber, resetRunState, loadKitForWO, setKitState,
    applyEffects, buildState, debug]);

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
        setWorkOrders(wos.filter((w: WorkOrderExt) => w.app_id === id && w.status !== 'completed' && w.status !== 'cancelled'));
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
      if (b.widgetId && (b.kind === 'range' || b.kind === 'pattern')) m[b.widgetId] = b.message;
    }
    return m;
  }, [blocks]);

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
            <button className="p-btn p-btn-ghost" onClick={() => navigate('/apps')}>Back to Library</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Setup screen ───────────────────────────────────────────────────────────
  if (status === 'setup') {
    const setupGate = runContextGate(requireContext && !previewMode, selectedWorkOrderId, manualPartNumber);
    return (
      <div className="p-root items-center justify-center p-4 sm:p-6">
        <div className="p-card w-full max-w-md p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="mx-auto mb-3 flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: 'var(--p-accent-tint)' }}>
              <Factory size={26} style={{ color: 'var(--p-accent)' }} />
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--p-ink)' }}>{app.name}</h1>
            {app.description && <p style={{ fontSize: 14, color: 'var(--p-muted)', marginTop: 4 }}>{app.description}</p>}
            {previewMode && <span className="p-chip p-chip-gold mt-3" style={{ fontWeight: 750 }}>PREVIEW — nothing will be saved</span>}
          </div>

          <div className="space-y-4">
            <div className="p-well grid grid-cols-3 gap-2 text-center p-3">
              {[
                { n: app.steps.length, l: 'Steps' },
                { n: app.steps.reduce((a, s) => a + s.widgets.length, 0), l: 'Widgets' },
                { n: app.steps.filter(s => s.takt_time_seconds).length, l: 'Timed' },
              ].map(x => (
                <div key={x.l}>
                  <div className="tnum" style={{ fontSize: 20, fontWeight: 750, color: 'var(--p-ink)' }}>{x.n}</div>
                  <div style={{ fontSize: 12, color: 'var(--p-muted)' }}>{x.l}</div>
                </div>
              ))}
            </div>

            <div>
              <label className="p-label">Operator</label>
              {operatorUserId ? (
                <div className="p-well flex items-center gap-2.5 px-4" style={{ minHeight: 56 }}>
                  <BadgeCheck size={19} style={{ color: 'var(--p-good)' }} />
                  <span style={{ fontSize: 17, fontWeight: 650, color: 'var(--p-ink)' }} className="flex-1">{operatorName}</span>
                  <button
                    onClick={() => { setOperatorUserId(null); setOperatorName(''); }}
                    style={{ color: 'var(--p-muted)' }} aria-label="Clear operator"
                  ><X size={18} /></button>
                </div>
              ) : (
                <input
                  className="p-input" placeholder="Enter your name…" value={operatorName}
                  onChange={e => setOperatorName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void startRun(); }}
                  autoFocus
                />
              )}
            </div>

            {!operatorUserId && (
              <div>
                <label className="p-label" style={{ fontSize: 13, color: 'var(--p-muted)' }}>
                  Badge code (optional) — scan or type, then Enter
                </label>
                <div className="relative">
                  <ScanLine size={17} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--p-accent)' }} />
                  <input
                    className="p-input p-mono" style={{ paddingLeft: 42, minHeight: 48, fontSize: 15 }}
                    placeholder="Badge…" value={badgeInput}
                    onChange={e => { setBadgeInput(e.target.value); setBadgeError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void tryBadge(); } }}
                  />
                </div>
                {badgeError && <div className="p-field-error">{badgeError}</div>}
              </div>
            )}

            {stations.length > 0 && (
              <div>
                <label className="p-label">Station (optional)</label>
                <select className="p-input" value={selectedStationId} onChange={e => setSelectedStationId(e.target.value)}>
                  <option value="">— No station —</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.location ? ` · ${s.location}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {workOrders.length > 0 && (
              <div>
                <label className="p-label">Work Order {requireContext ? '' : '(optional)'}</label>
                <select className="p-input" value={selectedWorkOrderId} onChange={e => setSelectedWorkOrderId(e.target.value)}>
                  <option value="">— No work order —</option>
                  {workOrders.map(wo => (
                    <option key={wo.id} value={wo.id}>{wo.work_order_number} · {wo.part_name} ({wo.quantity_completed}/{wo.quantity})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Run context (player batch B): no work order → typed part number.
                Scan-friendly: mono font, Enter starts the run. */}
            {!selectedWorkOrderId && (
              <div>
                <label className="p-label flex items-center gap-1.5">
                  <Hash size={14} style={{ color: 'var(--p-accent)' }} /> Part number
                  {requireContext && !previewMode && <span style={{ color: 'var(--p-bad)' }}>*</span>}
                </label>
                <div className="relative">
                  <ScanLine size={17} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--p-accent)' }} />
                  <input
                    className="p-input p-mono"
                    style={{ paddingLeft: 42 }}
                    placeholder="Scan or type a part number…"
                    value={manualPartNumber}
                    onChange={e => { setManualPartNumber(e.target.value); setActionError(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void startRun(); } }}
                    autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  />
                </div>
                {requireContext && !previewMode && (
                  <p style={{ fontSize: 12.5, color: 'var(--p-muted)', marginTop: 6 }}>
                    Required — select a work order above or enter the part number being built.
                  </p>
                )}
              </div>
            )}

            {productTypes.length > 0 && (
              <div>
                <label className="p-label flex items-center gap-1.5">
                  <Tag size={14} style={{ color: 'var(--p-accent)' }} /> Product Type
                  {productTypeLocked && <span className="p-chip p-chip-gold" style={{ fontSize: 11 }}><Lock size={10} /> from work order</span>}
                </label>
                <select
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

            {actionError && (
              <div className="p-well flex items-center gap-2 px-4 py-3" style={{ color: 'var(--p-bad)', fontSize: 14 }}>
                <AlertCircle size={15} className="flex-shrink-0" />
                {actionError}
              </div>
            )}

            <button
              className="p-btn p-btn-primary w-full"
              onClick={() => void startRun()}
              disabled={starting || !setupGate.ok}
              title={setupGate.ok ? undefined : setupGate.reason}
            >
              {starting ? 'Starting…' : previewMode ? 'Start Preview' : 'Start Process'}
            </button>
            {!setupGate.ok && (
              <p className="text-center" style={{ fontSize: 13, color: 'var(--p-warn)', marginTop: -6 }}>
                {setupGate.reason}
              </p>
            )}

            {/* Jobs in progress (player batch C): resume any operator's run at
                its saved position — with the last stint's handoff comment. */}
            {!previewMode && jobs.length > 0 && (
              <div className="pt-2">
                <div className="p-label flex items-center gap-1.5" style={{ marginBottom: 10 }}>
                  <Package size={14} style={{ color: 'var(--p-gold)' }} /> Jobs in progress
                </div>
                <div className="space-y-2">
                  {jobs.map(job => {
                    const jobWO = workOrders.find(w => w.id === job.work_order_id);
                    const jobPN = typeof job.data?._part_number === 'string' ? job.data._part_number : '';
                    const stepIdxRaw = Number(job.data?._step_index ?? 0);
                    const stepPos = Number.isFinite(stepIdxRaw) ? Math.min(Math.max(0, stepIdxRaw), app.steps.length - 1) : 0;
                    const last = job.last_session;
                    const lastWhen = (last?.ended_at || last?.started_at || job.started_at || '').slice(0, 16);
                    return (
                      <div key={job.id} className="p-well p-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="truncate" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}>
                              {jobWO ? `${jobWO.work_order_number} · ${jobWO.part_name}` : jobPN ? `PN ${jobPN}` : 'No work order'}
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
              className="w-full py-2 text-sm" style={{ color: 'var(--p-muted)' }}
              onClick={() => navigate('/apps')}
            >← Back to Library</button>
          </div>
        </div>
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
      ? `${selectedWO.work_order_number} · ${selectedWO.part_name}`
      : manualPartNumber.trim() ? `PN ${manualPartNumber.trim()}` : null;
    const summaryGate = runContextGate(requireContext && !previewMode, selectedWorkOrderId, manualPartNumber);
    return (
      <RunSummary
        appName={app.name}
        operatorName={operatorName}
        productTypeName={selectedPT?.name}
        steps={app.steps}
        stepTimes={stepTimes}
        getStepTakt={getStepTakt}
        taktExceededSteps={taktExceededSteps}
        capturedCount={capturedRef.current.size}
        kitSummary={kitSummary}
        savedLocally={savedLocally}
        contextLabel={contextLabel}
        nextUnitDisabledReason={summaryGate.ok ? undefined : summaryGate.reason}
        onChangeContext={changeContext}
        onNextUnit={() => void nextUnit()}
        onDone={() => navigate('/apps')}
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
            <button className="p-btn p-btn-ghost flex-1" onClick={() => navigate('/apps')}>Exit</button>
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
            operatorName={operatorName || 'Operator'}
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
            onAbandon={() => { if (window.confirm('Stop this process?')) abandonRun(); }}
            onShowParts={() => setShowPartsOverlay(o => !o)}
            onReportProblem={() => setReportOpen(true)}
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
              <div
                className="flex items-center justify-center gap-2.5 py-2 flex-shrink-0"
                style={{ background: 'var(--p-live)', color: '#fff', fontSize: 14, fontWeight: 750, letterSpacing: '0.5px' }}
              >
                <AlertTriangle size={15} />
                TAKT TIME EXCEEDED — {formatDur(stepElapsed - stepTaktSeconds)} OVER
                <Zap size={15} />
              </div>
            )}
            {blockBanner && <BlockBanner text={blockBanner} onDismiss={() => setBlockBanner(null)} />}
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
            onBack={() => requestNavigate({ to: 'prev' })}
            onNext={() => requestNavigate({ to: 'next' })}
            onComplete={() => requestNavigate({ to: 'complete' })}
          />
        }
        toasts={toasts}
        onDismissToast={tid => setToasts(prev => prev.filter(t => t.id !== tid))}
      >
        <div className={`w-full space-y-4 ${currentStep?.layoutMode === 'canvas' ? 'max-w-3xl' : 'max-w-2xl'}`}>
          {/* Step title */}
          <div className="flex items-center justify-between gap-3">
            <h2 style={{ fontSize: 'clamp(28px, 3vw, 34px)', fontWeight: 800, color: 'var(--p-ink)' }} className="flex-1">
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
            currentStep?.widgets.map(widget => (
              <PlayerWidget
                key={widget.id}
                widget={widget}
                step={currentStep}
                value={formData[legacyKey(widget)]}
                invalidMessage={invalidByWidget[widget.id]}
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
            ))
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

      {/* Pause-and-leave with an optional handoff comment (player batch C2) */}
      {leaveOpen && (
        <LeaveJobSheet
          leaving={leaving}
          onClose={() => { if (!leaving) setLeaveOpen(false); }}
          onLeave={comment => leaveJob(comment)}
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
            <input className="p-input" placeholder="Short summary…" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
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
              autoFocus
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
