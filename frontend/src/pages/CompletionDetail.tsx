// One run, end to end. This is the page a supervisor lands on from any run row,
// and it answers, in this order:
//
//   1. How long did this run take, and is that fast or slow for this app?
//   2. Which step was the bottleneck?
//   3. What did the operator actually enter?
//   4. Who worked it, and did it change hands?
//   5. How does it sit against the runs around it?
//
// It reads several endpoints because no single one carries all of that today —
// what each is here for is noted at the fetch. Nothing on the page is derived
// from a number the server did not measure: an unknown reads "—" with the
// reason, and a run still on the bench is shown as running rather than dressed
// up as a finished one.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { CompletionValue, Step, Widget } from '../types';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, User, Calendar, AlertTriangle,
  Package, ChevronRight, BarChart2, MapPin, ExternalLink, ListChecks, Users,
  History, Gauge, Play, MessageSquare, FileText, ChevronDown,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts';
import { stepTaktSeconds } from '../components/player/runtime';
import { getAppRevision } from '../api/revisions';
import type { AppRevisionSnapshot, RunRevisionStamp } from '../api/revisions';
import useAutoRefresh from '../hooks/useAutoRefresh';
import LastRefreshed from '../components/shared/LastRefreshed';
import EmptyState from '../components/shared/EmptyState';
import {
  durationTicks, elapsedSeconds, fmtDateTime, fmtDuration, fmtRelative, measuredSeconds,
  orderedSteps, parseServerTime, pluralize, runDurationSeconds, stepSecondsByIndex,
  widgetsOf,
} from '../components/apps/appModel';

// ── The shapes this page reads ───────────────────────────────────────────────

/** GET /api/analytics/completion/:id — the completions row, plus app_name and
 *  the joined work order. Its own `step_breakdown` is deliberately ignored: it
 *  reads only the legacy `takt_time` key, so every app built in the v2 builder
 *  came back with a takt of null. Step times are read from `step_times` here
 *  and takt from the app blob, which covers both key spellings. */
interface RunPayload {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  station_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
  abandoned_reason?: string | null;
  data: Record<string, unknown>;
  step_times: Record<string, unknown>;
  takt_exceeded_steps: (number | string)[];
  work_order?: { id: string; work_order_number: string } | null;
}

interface Session {
  id: string;
  operator_name: string;
  started_at: string;
  ended_at: string | null;
  handoff_comment: string | null;
}

interface RunSibling {
  id: string;
  operator_name: string;
  started_at: string | null;
  completed_at: string | null;
  total_duration_seconds: number | null;
  status: string;
}

/** One step of this run, joined from the app blob (name, order, takt) and the
 *  run's own timers. `seconds` is null for a step this run never timed — which
 *  on a live run usually means "not reached yet", not "took no time". */
interface StepRow {
  index: number;
  name: string;
  seconds: number | null;
  takt: number | null;
  /** Over/under takt as a fraction; null without a takt or without a time. */
  ratio: number | null;
  reached: boolean;
  /** The step the operator is standing on, on a run that is still open. */
  current: boolean;
  flaggedOverTakt: boolean;
}

/** A captured value carrying the label the builder gave its widget. */
interface CapturedValue {
  key: string;
  label: string;
  stepName: string | null;
  order: number;
  display: string;
  tone: 'pass' | 'fail' | null;
}

const LIVE_REFRESH_MS = 10_000;

// ── Formatting ───────────────────────────────────────────────────────────────

function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}

function statusBadge(status: string) {
  if (status === 'completed') return { label: 'Completed', cls: 'badge-green' };
  if (status === 'in_progress') return { label: 'Running now', cls: 'badge-blue' };
  if (status === 'abandoned') return { label: 'Abandoned', cls: 'badge-red' };
  return { label: status, cls: 'badge-gray' };
}

/** Bar colour by how a step landed against its OWN takt. Indigo means the step
 *  has no takt to be judged against — not that it did badly. */
function stepColor(row: StepRow): string {
  if (row.ratio === null) return '#6366f1';
  if (row.ratio <= 1) return '#22c55e';
  if (row.ratio <= 1.1) return '#f59e0b';
  return '#ef4444';
}

function varianceLabel(row: StepRow): { text: string; cls: string } {
  if (row.seconds === null) {
    if (row.current) return { text: 'on it now', cls: 'text-blue-600 font-semibold' };
    return { text: row.reached ? 'not timed' : 'not reached', cls: 'text-gray-400' };
  }
  if (row.ratio === null) return { text: 'no takt set', cls: 'text-gray-400' };
  const pct = Math.round((row.ratio - 1) * 100);
  if (pct <= 0) return { text: `${Math.abs(pct)}% under`, cls: 'text-green-600' };
  if (pct <= 10) return { text: `+${pct}%`, cls: 'text-amber-600' };
  return { text: `+${pct}% over`, cls: 'text-red-600' };
}

function formatValue(type: string, text: string | null, num: number | null): string {
  if (type === 'boolean') return num === 1 ? 'Yes' : num === 0 ? 'No' : '—';
  if (type === 'pass_fail') {
    const v = (text ?? '').toLowerCase();
    return v === 'pass' ? 'Pass' : v === 'fail' ? 'Fail' : '—';
  }
  if (type === 'photo' || type === 'signature') return text ? 'Captured' : '—';
  if (text === null && num !== null && num !== undefined) return String(num);
  return text && text.trim() ? text : '—';
}

function formatLegacyValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function toneOf(display: string): 'pass' | 'fail' | null {
  const v = display.toLowerCase();
  if (v === 'pass') return 'pass';
  if (v === 'fail') return 'fail';
  return null;
}

function humanKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CompletionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [run, setRun] = useState<RunPayload | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  // Which published revision of the app this run was measured against. The
  // server stamps it at run start; null means the run predates change control
  // on this app, which the page SAYS rather than papering over with a Rev 1.
  const [revision, setRevision] = useState<RunRevisionStamp | null>(null);
  const [revisionKnown, setRevisionKnown] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [snapshot, setSnapshot] = useState<AppRevisionSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [appSteps, setAppSteps] = useState<Step[] | null>(null);
  const [values, setValues] = useState<CompletionValue[] | null>(null);
  const [stationName, setStationName] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<{ runs: RunSibling[]; appAvg: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A live run's elapsed time has to move on its own — the poll below only
  // reloads every ten seconds, and a clock that jumps in ten-second steps reads
  // as broken rather than as live.
  const [now, setNow] = useState(() => Date.now());

  const fetchRun = useCallback(async () => {
    if (!id) return;
    try {
      // The run row is the only request that may fail the page; everything else
      // enriches it, so a station list or a sibling page that drops costs one
      // panel rather than the whole screen.
      const payload = await api.getCompletionDetail(id) as RunPayload;
      setRun(payload);
      setError(null);

      const [sessionRes, appRes, valueRes, stationRes, historyRes] = await Promise.allSettled([
        // Who worked it, and any handoff note left for the next operator.
        api.getCompletionWithSessions(id),
        // Step names, their order, and takt in either key spelling.
        api.getApp(payload.app_id),
        // What the operator entered, one structured row per widget.
        api.getCompletionValues(id),
        // The run stores a station id, and a raw UUID tells a customer nothing.
        api.getStations(),
        // This app's average, and the runs either side of this one.
        api.getAppHistory(payload.app_id, 1, 8),
      ]);

      setSessions(sessionRes.status === 'fulfilled' ? (sessionRes.value?.sessions ?? []) : []);
      // `revisionKnown` separates "this run recorded no revision" (a fact worth
      // printing) from "the request that would have told us failed" (not one).
      if (sessionRes.status === 'fulfilled') {
        setRevision((sessionRes.value?.app_revision ?? null) as RunRevisionStamp | null);
        setRevisionKnown(true);
      }
      setAppSteps(appRes.status === 'fulfilled' ? (appRes.value?.steps ?? []) : null);
      setValues(valueRes.status === 'fulfilled' ? valueRes.value : null);
      setStationName(
        stationRes.status === 'fulfilled' && payload.station_id
          ? ((stationRes.value ?? []).find((s: { id: string }) => s.id === payload.station_id)?.name ?? null)
          : null,
      );
      if (historyRes.status === 'fulfilled') {
        setSiblings({
          runs: (historyRes.value?.completions ?? []) as RunSibling[],
          appAvg: measuredSeconds(historyRes.value?.avg_duration),
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load this run');
      throw e; // let useAutoRefresh keep the freshness stamp honestly stale
    } finally {
      setLoading(false);
    }
  }, [id]);

  const isLive = run?.status === 'in_progress';

  // Only a run that is still open needs polling; a finished one cannot change.
  const { lastRefreshed, refreshing, refresh } = useAutoRefresh(
    fetchRun, LIVE_REFRESH_MS, { enabled: isLive },
  );

  useEffect(() => {
    if (!isLive) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [isLive]);

  // The frozen instructions this run followed, fetched only when somebody asks
  // to see them. It is the SNAPSHOT, never the app as it stands today — that is
  // the whole point of the link.
  useEffect(() => {
    if (!showSnapshot || !run || !revision || snapshot) return;
    let cancelled = false;
    setSnapshotError(null);
    getAppRevision(run.app_id, revision.revision)
      .then(rev => { if (!cancelled) setSnapshot(rev); })
      .catch((e: unknown) => {
        if (!cancelled) setSnapshotError(e instanceof Error ? e.message : 'Could not load this revision');
      });
    return () => { cancelled = true; };
  }, [showSnapshot, run, revision, snapshot]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const steps: StepRow[] = useMemo(() => {
    if (!run) return [];
    const timed = stepSecondsByIndex(run.step_times);
    const flagged = new Set((run.takt_exceeded_steps ?? []).map(String));
    const ordered = appSteps ? orderedSteps({ steps: appSteps }) : [];
    // Fall back to whatever the run itself timed when the app blob is
    // unavailable, so the times stay readable even without step names.
    const rows = ordered.length > 0
      ? ordered.map(({ step, index }) => ({
        index,
        name: step.name || `Step ${index + 1}`,
        takt: measuredSeconds(stepTaktSeconds(step)),
      }))
      : timed.map((_, index) => ({ index, name: `Step ${index + 1}`, takt: null as number | null }));

    // On a live run the operator is somewhere in the middle: everything past
    // the step they are on has not been reached, and saying so beats a dash
    // that reads like missing data.
    const lastTimed = timed.reduce<number>((last, s, i) => (s !== null && s > 0 ? i : last), -1);

    return rows.map(({ index, name, takt }) => {
      const seconds = measuredSeconds(timed[index] ?? null);
      return {
        index,
        name,
        seconds,
        takt,
        ratio: seconds !== null && takt !== null ? seconds / takt : null,
        reached: run.status !== 'in_progress' || index <= lastTimed + 1,
        current: run.status === 'in_progress' && seconds === null && index === lastTimed + 1,
        flaggedOverTakt: flagged.has(String(index)),
      };
    });
  }, [run, appSteps]);

  const timedSteps = useMemo(() => steps.filter(s => s.seconds !== null), [steps]);
  const currentStep = useMemo(() => steps.find(s => s.current) ?? null, [steps]);
  // Axis ticks land on durations a person reads at a glance rather than on
  // recharts' arithmetically-even "1m 5s, 2m 10s, 3m 15s".
  const stepTicks = useMemo(
    () => durationTicks(Math.max(0, ...timedSteps.map(s => Math.max(s.seconds ?? 0, s.takt ?? 0)))),
    [timedSteps],
  );
  const untimedCount = steps.length - timedSteps.length - (currentStep ? 1 : 0);

  const total = run ? runDurationSeconds(run) : null;
  const elapsed = run && isLive ? elapsedSeconds(run.started_at, now) : null;
  const appAvg = siblings?.appAvg ?? null;
  const vsAvg = total !== null && appAvg !== null ? total - appAvg : null;

  const taktTotal = useMemo(
    () => measuredSeconds(steps.reduce((acc, s) => acc + (s.takt ?? 0), 0)),
    [steps],
  );

  const bottleneck = useMemo(() => {
    // The step that ran furthest past its own takt; with no takt anywhere, the
    // longest step is the honest answer to "where does the time go".
    const withRatio = timedSteps.filter(s => s.ratio !== null);
    if (withRatio.length > 0) {
      const worst = withRatio.reduce((a, b) => ((b.ratio as number) > (a.ratio as number) ? b : a));
      return (worst.ratio as number) > 1 ? worst : null;
    }
    if (timedSteps.length === 0) return null;
    return timedSteps.reduce((a, b) => ((b.seconds as number) > (a.seconds as number) ? b : a));
  }, [timedSteps]);

  const captured = useMemo(
    () => buildCaptured(values, run?.data ?? null, appSteps),
    [values, run?.data, appSteps],
  );
  const failedChecks = captured.filter(c => c.tone === 'fail');

  // ── States ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-4">
        <div className="h-5 w-64 rounded animate-pulse bg-gray-100" />
        <div className="card h-44 animate-pulse bg-gray-100" />
        <div className="card h-72 animate-pulse bg-gray-100" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6">
        <div className="card p-10 max-w-lg mx-auto mt-10">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't open this run"
            description={error || 'It may have been deleted, or it belongs to another company.'}
            action={<button onClick={() => navigate(-1)} className="btn-secondary"><ArrowLeft size={14} /> Go back</button>}
          />
        </div>
      </div>
    );
  }

  const badge = statusBadge(run.status);
  const sweptUp = run.status === 'abandoned' && run.abandoned_reason !== 'operator';

  return (
    <div className="min-h-screen bg-[#f8fafc] p-4 sm:p-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 flex-wrap">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 hover:text-gray-800 transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <ChevronRight size={13} className="text-gray-300" />
        <Link to={`/apps/${run.app_id}?tab=runs`} className="hover:text-indigo-600 transition-colors truncate max-w-[14rem]">
          {run.app_name}
        </Link>
        <ChevronRight size={13} className="text-gray-300" />
        <span className="text-gray-800 font-medium">Run #{shortId(run.id)}</span>
      </div>

      {/* ── 1. How long did it take? ────────────────────────────────────────── */}
      <section className="card p-5 sm:p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className={badge.cls}>
                {isLive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 live-pulse" aria-hidden="true" />}
                {badge.label}
              </span>
              <span className="font-mono text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">#{shortId(run.id)}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 truncate">{run.app_name}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isLive && <LastRefreshed at={lastRefreshed} refreshing={refreshing} onRefresh={() => void refresh()} />}
            <Link to={`/apps/${run.app_id}?tab=runs`} className="btn-secondary text-xs"><History size={13} /> Run history</Link>
            <Link to={`/play/${run.app_id}`} className="btn-primary text-xs"><ExternalLink size={13} /> Run this app</Link>
          </div>
        </div>

        {/* The headline number. A live run reports how long it has been open,
            plainly labelled as still running; a finished run reports its total. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5">
              <Clock size={12} /> {isLive ? 'Running for' : 'Total time'}
            </div>
            <div
              data-testid="run-total"
              className={`text-3xl font-bold tabular-nums mt-1 ${
                isLive ? 'text-blue-600' : total === null ? 'text-gray-400' : 'text-gray-900'
              }`}
            >
              {isLive ? fmtDuration(elapsed) : fmtDuration(total)}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {isLive
                ? `started ${fmtRelative(run.started_at).toLowerCase()} · still on the bench`
                : total === null
                  ? 'nobody timed this run'
                  : timedSteps.length > 0
                    ? `${pluralize(timedSteps.length, 'step')} timed`
                    : 'start to finish'}
            </p>
          </div>

          <Compare
            label="vs this app's average"
            deltaSeconds={vsAvg}
            baseline={appAvg}
            unavailable={
              isLive ? 'this run has not finished'
                : appAvg === null ? 'no run of this app has been timed'
                  : total === null ? 'this run was never timed'
                    : undefined
            }
          />

          <Compare
            label="vs takt"
            deltaSeconds={isLive || total === null || taktTotal === null ? null : total - taktTotal}
            baseline={taktTotal}
            unavailable={
              taktTotal === null ? 'no takt set on this app'
                : isLive ? 'this run has not finished'
                  : total === null ? 'this run was never timed'
                    : undefined
            }
          />
        </div>

        {/* The facts about the run itself */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4 border-t border-gray-100 pt-4">
          <Meta icon={<User size={13} />} label="Started by" value={run.operator_name || null} unknown="no operator recorded" />
          <Meta icon={<Calendar size={13} />} label="Started" value={fmtDateTime(run.started_at)} />
          <Meta
            icon={<Calendar size={13} />}
            label="Finished"
            value={run.completed_at ? fmtDateTime(run.completed_at) : null}
            unknown={isLive ? 'still running' : 'never finished'}
          />
          <Meta
            icon={<MapPin size={13} />}
            label="Station"
            value={stationName}
            unknown={run.station_id ? 'station no longer exists' : 'no station recorded'}
          />
          {run.work_order?.work_order_number && (
            <Meta icon={<Package size={13} />} label="Work order" value={run.work_order.work_order_number} />
          )}
        </div>

        {/* ── What this operator actually followed ──────────────────────────
            A run is measured against the revision that was live when it
            started. Editing the app afterwards cannot change it, and a run
            that started before this app was ever published under change
            control says so — it is never given a Rev 1 it never saw. */}
        {revisionKnown && (
          <div className="border-t border-gray-100 pt-4" data-testid="run-revision">
            {!revision ? (
              <p className="text-xs text-gray-500 flex items-start gap-1.5">
                <FileText size={13} className="text-gray-400 flex-shrink-0 mt-px" />
                <span>
                  <span className="font-semibold text-gray-700">Revision not recorded</span>
                  {' — this run started before this app was published under change control, '}
                  so the instructions it followed were never frozen.
                </span>
              </p>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowSnapshot(v => !v)}
                  aria-expanded={showSnapshot}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900 font-medium"
                >
                  <FileText size={13} className="text-gray-400" />
                  <span>
                    Ran against Rev {revision.revision}
                    {revision.effective_at && ` · published ${fmtDateTime(revision.effective_at)}`}
                    {revision.published_by_name && ` by ${revision.published_by_name}`}
                  </span>
                  <ChevronDown size={13} className={`text-gray-400 transition-transform ${showSnapshot ? 'rotate-180' : ''}`} />
                </button>

                {showSnapshot && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                    {snapshotError ? (
                      <p className="text-xs text-red-700">{snapshotError}</p>
                    ) : !snapshot ? (
                      <p className="text-xs text-gray-500">Loading Rev {revision.revision}…</p>
                    ) : (
                      <>
                        <p className="text-[11px] uppercase tracking-wide text-gray-400">
                          Rev {snapshot.revision} — the steps as published
                        </p>
                        {snapshot.change_note && (
                          <p className="text-xs text-gray-600 mt-1">
                            <span className="font-semibold">Change note:</span> {snapshot.change_note}
                          </p>
                        )}
                        {/* The policy that applied WHEN THIS REVISION WAS CUT.
                            An app that never required approval must not read as
                            one that skipped it, and a deleted approver must not
                            read as no approver at all. */}
                        <p className="text-[11px] text-gray-500 mt-1">
                          {snapshot.approved_by_name
                            ? `Approved by ${snapshot.approved_by_name}`
                            : snapshot.approval_required
                              ? snapshot.approved_by_user_id
                                ? 'Approved by a user whose account has since been removed'
                                : 'No approver recorded'
                              : 'Approval was not required for this app'}
                        </p>
                        <ol className="mt-2 space-y-1.5">
                          {(snapshot.steps ?? []).map((step, i) => (
                            <li key={step.id ?? i} className="text-xs text-gray-700">
                              <span className="tabular-nums text-gray-400 mr-1.5">{i + 1}.</span>
                              <span className="font-medium">{step.name || 'Untitled step'}</span>
                              {(step.widgets ?? []).length > 0 && (
                                <span className="text-gray-500">
                                  {' — '}
                                  {(step.widgets ?? []).map((w: Widget) => w.label || w.type).join(', ')}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                        {(snapshot.steps ?? []).length === 0 && (
                          <p className="text-xs text-gray-500 mt-2">This revision recorded no steps.</p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {run.status === 'abandoned' && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            {sweptUp
              ? 'Nobody closed this run — it was swept up as stale after a long spell with no activity, so its times stop where the operator stopped.'
              : 'An operator abandoned this run, so it has no finish time and does not count towards yield.'}
          </p>
        )}

        {failedChecks.length > 0 && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-2">
            <XCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Failed {pluralize(failedChecks.length, 'check')} on this run:{' '}
              <span className="font-semibold">{failedChecks.map(c => c.label).join(', ')}</span>
            </span>
          </p>
        )}
      </section>

      {/* ── 2. Which step was the bottleneck? ───────────────────────────────── */}
      <section className="card p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gauge size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">{isLive ? 'Where the time is going' : 'Where the time went'}</h2>
          {bottleneck && (
            <span className="badge-amber">
              Slowest: {bottleneck.name}
              {bottleneck.ratio !== null && bottleneck.ratio > 1 && ` · ${Math.round((bottleneck.ratio - 1) * 100)}% over takt`}
            </span>
          )}
        </div>

        {steps.length === 0 ? (
          <EmptyState
            compact
            icon={BarChart2}
            title="No steps to break down"
            description="This app's steps couldn't be read, so there is nothing to lay this run's time against."
          />
        ) : timedSteps.length === 0 ? (
          <EmptyState
            compact
            icon={Clock}
            title={isLive ? 'No step has finished yet' : 'No step on this run was timed'}
            description={isLive
              ? 'Step times appear here as the operator moves through the job.'
              : 'The run recorded no per-step timers — those times are missing, not zero.'}
          />
        ) : (
          <>
            <div className="flex items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 flex-wrap">
              <Legend color="#22c55e" label="Under takt" />
              <Legend color="#f59e0b" label="Within 10%" />
              <Legend color="#ef4444" label="Over takt" />
              <Legend color="#6366f1" label="No takt set" />
            </div>

            {/* Wide content scrolls inside its own box; the page never does. */}
            <div className="overflow-x-auto">
              <div className="min-w-[26rem]">
                <ResponsiveContainer width="100%" height={Math.max(150, timedSteps.length * 44)}>
                  <BarChart data={timedSteps} layout="vertical" barGap={2} margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--grid-line)" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: 'var(--muted)' }}
                      tickFormatter={(v: number) => fmtDuration(v)}
                      ticks={stepTicks}
                      domain={[0, stepTicks[stepTicks.length - 1]]}
                    />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted)' }} width={104} />
                    <Tooltip content={<StepTip />} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                    {timedSteps.some(s => s.takt !== null) && (
                      <Bar dataKey="takt" name="Takt" fill="var(--baseline)" radius={[0, 3, 3, 0]} maxBarSize={8} />
                    )}
                    <Bar dataKey="seconds" name="Actual" radius={[0, 3, 3, 0]} maxBarSize={16}>
                      {timedSteps.map(row => <Cell key={row.index} fill={stepColor(row)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[32rem]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                    <th className="font-semibold px-3 py-2 w-8">#</th>
                    <th className="font-semibold px-3 py-2">Step</th>
                    <th className="font-semibold px-3 py-2 text-right">Time</th>
                    <th className="font-semibold px-3 py-2 text-right">Takt</th>
                    <th className="font-semibold px-3 py-2">Against takt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {steps.map(row => {
                    const v = varianceLabel(row);
                    return (
                      <tr
                        key={row.index}
                        className={row.current ? 'bg-blue-50/40' : row.seconds === null ? 'opacity-60' : undefined}
                      >
                        <td className="px-3 py-2.5 text-xs text-gray-400 tabular-nums">{row.index + 1}</td>
                        <td className="px-3 py-2.5 text-xs font-medium text-gray-900">
                          <span className="flex items-center gap-1.5">
                            {row.name}
                            {row.flaggedOverTakt && (
                              <AlertTriangle
                                size={11}
                                className="text-amber-500 flex-shrink-0"
                                aria-label="The player flagged this step as over takt while it ran"
                              />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right tabular-nums font-medium text-gray-900">
                          {row.seconds === null ? <span className="text-gray-400">—</span> : fmtDuration(row.seconds)}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-right tabular-nums text-gray-500">
                          {row.takt === null ? <span className="text-gray-400">—</span> : fmtDuration(row.takt)}
                        </td>
                        <td className={`px-3 py-2.5 text-xs font-semibold ${v.cls}`}>{v.text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(untimedCount > 0 || currentStep) && (
              <p className="text-[11px] text-gray-400">
                {currentStep && (
                  <span className="text-blue-600 font-medium">
                    The operator is on “{currentStep.name}” now.{untimedCount > 0 ? ' ' : ''}
                  </span>
                )}
                {untimedCount > 0 && (
                  <>
                    {pluralize(untimedCount, 'step')} without a time
                    {isLive ? ' — not reached yet.' : ' — this run recorded no timer for them.'}
                  </>
                )}
              </p>
            )}
          </>
        )}
      </section>

      {/* ── 3. What did the operator enter? ─────────────────────────────────── */}
      <section className="card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-1">
          <ListChecks size={16} className="text-gray-400" />
          <h2 className="font-semibold text-gray-900">What the operator entered</h2>
          {captured.length > 0 && <span className="text-xs text-gray-400">({captured.length})</span>}
        </div>
        <p className="text-[11px] text-gray-400 mb-4">Every value this run recorded, in the order the operator met them.</p>

        {captured.length === 0 ? (
          <EmptyState
            compact
            icon={ListChecks}
            title={isLive ? 'Nothing captured yet' : 'This run captured no values'}
            description={isLive
              ? 'Entries land here as the operator fills them in.'
              : 'Either this app has no input, check or scan widgets, or nobody filled them in.'}
          />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {captured.map(v => (
              <li
                key={v.key}
                className={`rounded-xl border p-3 min-w-0 ${
                  v.tone === 'fail' ? 'bg-red-50 border-red-100'
                    : v.tone === 'pass' ? 'bg-green-50 border-green-100'
                      : 'bg-gray-50 border-gray-100'
                }`}
              >
                <div className="text-[11px] text-gray-500 truncate" title={v.label}>{v.label}</div>
                {v.stepName && <div className="text-[10px] text-gray-400 truncate">{v.stepName}</div>}
                <div className={`text-sm font-semibold mt-1 break-words ${
                  v.tone === 'fail' ? 'text-red-700' : v.tone === 'pass' ? 'text-green-700' : 'text-gray-900'
                }`}>
                  {v.tone === 'pass' && <CheckCircle2 size={13} className="inline mr-1 -mt-0.5" />}
                  {v.tone === 'fail' && <XCircle size={13} className="inline mr-1 -mt-0.5" />}
                  {v.display}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 4. Who worked it? ───────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <section className="card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-1">
            <Users size={16} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Who worked it</h2>
          </div>
          <p className="text-[11px] text-gray-400 mb-4">
            Each stint on this run, including anyone who picked it up mid-job.
          </p>
          <ol className="space-y-2">
            {sessions.map(s => {
              const from = parseServerTime(s.started_at);
              const to = s.ended_at ? parseServerTime(s.ended_at) : null;
              const stint = from && to ? measuredSeconds((to.getTime() - from.getTime()) / 1000) : null;
              return (
                <li key={s.id} className="flex items-start gap-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                  <User size={13} className="text-gray-400 mt-1 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{s.operator_name}</div>
                    <div className="text-[11px] text-gray-400">
                      {fmtDateTime(s.started_at)}
                      {s.ended_at
                        ? ` · ${stint === null ? 'under a second' : fmtDuration(stint)} on the job`
                        : ' · still on the job'}
                    </div>
                    {s.handoff_comment && (
                      <p className="text-[11px] text-gray-600 mt-1 flex items-start gap-1.5">
                        <MessageSquare size={11} className="flex-shrink-0 mt-0.5 text-gray-400" />
                        {s.handoff_comment}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ── 5. How does it sit against its neighbours? ──────────────────────── */}
      {siblings && (siblings.runs.length > 1 ? (
        <section className="card overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 flex-wrap">
            <History size={15} className="text-gray-400" />
            <h2 className="font-semibold text-gray-900">Recent runs of {run.app_name}</h2>
            <Link
              to={`/apps/${run.app_id}?tab=runs`}
              className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-0.5"
            >
              Full history <ChevronRight size={12} />
            </Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {siblings.runs.map(sib => {
              const isCurrent = sib.id === run.id;
              const sibBadge = statusBadge(sib.status);
              return (
                <li key={sib.id}>
                  <Link
                    to={`/completions/${sib.id}`}
                    className={`flex items-center gap-3 px-5 py-2.5 text-xs flex-wrap ${
                      isCurrent ? 'bg-indigo-50/60 pointer-events-none' : 'hover:bg-gray-50 transition-colors'
                    }`}
                  >
                    <span className="font-mono text-gray-400 w-[4.5rem] flex-shrink-0">#{shortId(sib.id)}</span>
                    <span className="text-gray-700 flex-1 min-w-[6rem] truncate">{sib.operator_name || 'Unknown'}</span>
                    <span className="text-gray-400 w-20 flex-shrink-0">{fmtRelative(sib.completed_at ?? sib.started_at)}</span>
                    <span className="tabular-nums text-gray-900 font-medium w-16 text-right flex-shrink-0">
                      {measuredSeconds(sib.total_duration_seconds) === null
                        ? <span className="text-gray-400" title={sib.status === 'in_progress' ? 'still running' : 'never timed'}>—</span>
                        : fmtDuration(measuredSeconds(sib.total_duration_seconds))}
                    </span>
                    <span className={`${sibBadge.cls} flex-shrink-0`}>{sibBadge.label}</span>
                    {isCurrent && <span className="text-indigo-600 font-semibold flex-shrink-0">this run</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="card p-5">
          <EmptyState
            compact
            icon={Play}
            title="This is the only run so far"
            description="Run the app again and this page will show how the two compare."
            action={<Link to={`/play/${run.app_id}`} className="btn-secondary"><Play size={13} /> Run it again</Link>}
          />
        </section>
      ))}
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** A signed comparison against a baseline. Renders "—" plus the reason when
 *  either side of the subtraction is missing, because "dead on average" and
 *  "we have no average" are not the same statement. */
function Compare({ label, deltaSeconds, baseline, unavailable }: {
  label: string;
  deltaSeconds: number | null;
  baseline: number | null;
  unavailable?: string;
}) {
  const known = unavailable === undefined && deltaSeconds !== null;
  const faster = known && (deltaSeconds as number) < 0;
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-gray-400 truncate">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${
        !known ? 'text-gray-400' : faster ? 'text-green-600' : 'text-red-600'
      }`}>
        {known ? `${faster ? '−' : '+'}${fmtDuration(Math.abs(deltaSeconds as number))}` : '—'}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {known ? `${faster ? 'faster' : 'slower'} · baseline ${fmtDuration(baseline)}` : unavailable}
      </p>
    </div>
  );
}

function Meta({ icon, label, value, unknown }: {
  icon: React.ReactNode; label: string; value: string | null; unknown?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-0.5">{icon}{label}</div>
      <div
        className={`text-[13px] font-semibold truncate ${value ? 'text-gray-900' : 'text-gray-400'}`}
        title={value ?? unknown}
      >
        {value ?? `— ${unknown ?? ''}`.trim()}
      </div>
    </div>
  );
}

function StepTip({ active, payload }: { active?: boolean; payload?: { payload: StepRow }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const v = varianceLabel(row);
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs min-w-[10rem]">
      <div className="font-semibold text-gray-900 mb-1.5">{row.name}</div>
      <div className="space-y-1 text-gray-600">
        <div className="flex justify-between gap-4"><span>Time</span><span className="font-medium text-gray-900">{fmtDuration(row.seconds)}</span></div>
        <div className="flex justify-between gap-4"><span>Takt</span><span className="font-medium text-gray-900">{fmtDuration(row.takt)}</span></div>
        <div className={`font-semibold ${v.cls}`}>{v.text}</div>
      </div>
    </div>
  );
}

// ── Captured values ──────────────────────────────────────────────────────────

/**
 * What the operator entered, preferring the structured `completion_values` rows
 * (one per widget, carrying the builder's label and its step) and falling back
 * to the legacy `data` blob for runs recorded before those rows existed. The
 * fallback's keys are variable names, so they are title-cased rather than shown
 * raw as `visual_ok`, and the player's own bookkeeping keys (leading underscore,
 * e.g. `_operators`) are left out — nobody entered those.
 */
export function buildCaptured(
  values: CompletionValue[] | null,
  data: Record<string, unknown> | null,
  appSteps: Step[] | null,
): CapturedValue[] {
  const meta = widgetMeta(appSteps);

  if (values && values.length > 0) {
    return values
      .map((v, i) => {
        const m = meta.byWidget.get(String(v.widget_id));
        const display = formatValue(v.value_type, v.value_text, v.value_number);
        return {
          key: v.id || `${v.widget_id}-${i}`,
          label: m?.label || humanKey(v.variable_name || String(v.widget_id)),
          stepName: m?.stepName || null,
          order: m?.order ?? Number.MAX_SAFE_INTEGER,
          display,
          tone: toneOf(display),
        };
      })
      .sort((a, b) => a.order - b.order);
  }

  return Object.entries(data ?? {})
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, raw], i) => {
      const m = meta.byVariable.get(key);
      const display = formatLegacyValue(raw);
      return {
        key,
        label: m?.label || humanKey(key),
        stepName: m?.stepName || null,
        order: m?.order ?? Number.MAX_SAFE_INTEGER - 1000 + i,
        display,
        tone: toneOf(display),
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** Widget labels and their step, indexed both ways the two value sources key on. */
function widgetMeta(appSteps: Step[] | null) {
  const byWidget = new Map<string, { label: string; stepName: string; order: number }>();
  const byVariable = new Map<string, { label: string; stepName: string; order: number }>();
  let order = 0;
  for (const { step } of orderedSteps({ steps: appSteps ?? [] })) {
    for (const w of widgetsOf(step)) {
      if (!w?.id) continue;
      const entry = { label: labelOf(w), stepName: step.name || '', order: order++ };
      byWidget.set(String(w.id), entry);
      const variable = w.config?.variableName;
      if (typeof variable === 'string' && variable) byVariable.set(variable, entry);
    }
  }
  return { byWidget, byVariable };
}

function labelOf(w: Widget): string {
  const label = String(w.label || w.config?.variableName || '').trim();
  return label || humanKey(String(w.type));
}
