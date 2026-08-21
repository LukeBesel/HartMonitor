// In-depth app information — what this app is, where it runs, who runs it and
// what it has produced. Everything on the page comes from two real sources:
// the authoring blob the builder saved (steps / widgets / triggers) and this
// company's completions (runs, operators, durations). Nothing is estimated.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AppDetailResponse } from '../api/client';
import {
  ArrowLeft, Play, Edit3, Copy, Layers, BarChart2, Globe, Lock, RefreshCw,
  AlertTriangle, Building2, MapPin, Package, GitBranch, ClipboardList, Users,
  Clock, Activity, Zap, MousePointerClick, ChevronRight, History, Boxes,
  CheckCircle2, XCircle, Loader2, Download, Info,
} from 'lucide-react';
import PageHeader from '../components/shared/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import { useCoachDocked } from '../components/apps/AppTrainingCoach';
import { useAuth } from '../context/AuthContext';
import { usePlan } from '../context/PlanContext';
import { useToast } from '../context/ToastContext';
import {
  appShape, orderedSteps, widgetsOf, widgetTypeLabel, isCaptureWidget,
  fmtDateTime, fmtDuration, fmtRelative, pluralize,
} from '../components/apps/appModel';

export default function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  // Leave the floating training coach a lane instead of hiding the right column.
  const coachDocked = useCoachDocked();
  const { refresh: refreshPlan } = usePlan();
  const { addToast } = useToast();

  const [data, setData] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return Promise.resolve();
    setError(null);
    return api.getAppDetail(id)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load this app'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleDuplicate = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const copy = await api.duplicateApp(id);
      addToast(`Created "${copy.name}"`, 'success');
      refreshPlan();
      navigate(`/apps/${copy.id}/build`);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to duplicate app', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!data) return;
    const name = prompt('Template name:', data.app.name);
    if (name === null || !name.trim()) return;
    const description = prompt('Template description (optional):', data.app.description || '');
    if (description === null) return;
    setBusy(true);
    try {
      const saved = await api.saveAppAsTemplate(data.app.id, { name: name.trim(), description });
      addToast(`Template "${saved.name}" saved — it now shows up as a starting point`, 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to save template', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await api.publishApp(data.app.id);
      addToast(`"${data.app.name}" is live — operators see it now`, 'success');
      await load();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to publish app', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-64 rounded animate-pulse bg-gray-100" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="card h-20 animate-pulse bg-gray-100" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card h-96 animate-pulse bg-gray-100" />
          <div className="card h-96 animate-pulse bg-gray-100" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link to="/apps" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={15} /> All apps
        </Link>
        <div className="card p-10">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't open this app"
            description={error || 'It may have been deleted, or it belongs to another company.'}
            action={
              <button onClick={() => { setLoading(true); load(); }} className="btn-secondary">
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const { app, bindings, stats, operators, recent_runs: recentRuns } = data;
  const shape = appShape(app);
  const published = app.status === 'published';
  const steps = orderedSteps(app);

  return (
    <div className={`p-6 space-y-6 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
      <Link to="/apps" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
        <ArrowLeft size={15} /> All apps
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-3 flex-wrap">
            {app.name}
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full align-middle ${
              published ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {published ? <Globe size={10} /> : <Lock size={10} />}
              {published ? 'Published' : 'Draft'}
            </span>
          </span>
        }
        subtitle={app.description || 'No description yet — add one in the builder so your team knows when to use this app.'}
        actions={
          <>
            {canEdit && (
              <Link to={`/apps/${app.id}/build`} className="btn-secondary">
                <Edit3 size={14} /> Edit
              </Link>
            )}
            <Link to={`/apps/${app.id}/analytics`} className="btn-secondary">
              <BarChart2 size={14} /> Analytics
            </Link>
            {published ? (
              <Link to={`/play/${app.id}`} className="btn-primary">
                <Play size={14} /> Run
              </Link>
            ) : canEdit ? (
              <button onClick={handlePublish} disabled={busy} className="btn-primary">
                <Globe size={14} /> Publish
              </button>
            ) : null}
          </>
        }
      />

      {/* Secondary actions */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={handleDuplicate} disabled={busy} className="btn-secondary text-xs">
            <Copy size={13} /> Duplicate
          </button>
          <button onClick={handleSaveAsTemplate} disabled={busy} className="btn-secondary text-xs">
            <Layers size={13} /> Save as template
          </button>
          <Link to={`/apps/${app.id}/history`} className="btn-secondary text-xs">
            <History size={13} /> Run history
          </Link>
          <button
            onClick={() => api.downloadAppCompletions(app.id).catch((e: unknown) =>
              addToast(e instanceof Error ? e.message : 'Export failed', 'error'))}
            className="btn-secondary text-xs"
          >
            <Download size={13} /> Export runs (CSV)
          </button>
        </div>
      )}

      {/* What it has done — counted from this company's completions */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat icon={Activity} label="Runs, all time" value={String(stats.runs_total)} />
        <Stat icon={Clock} label="Runs last 7 days" value={String(stats.runs_7d)} />
        <Stat icon={Loader2} label="Avg run time" value={fmtDuration(stats.avg_duration_s)} />
        <Stat
          icon={CheckCircle2}
          label="First-pass yield"
          value={stats.first_pass_yield === null ? '—' : `${stats.first_pass_yield}%`}
          hint={stats.first_pass_yield === null ? 'No pass/fail checks captured yet' : undefined}
          tone={stats.first_pass_yield !== null && stats.first_pass_yield >= 95 ? 'good' : undefined}
        />
        <Stat icon={Users} label="Operators" value={String(stats.operator_count)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* ── Left: what the app does ── */}
        <div className="lg:col-span-2 space-y-5">
          <section className="card p-5">
            <header className="flex items-start justify-between gap-3 flex-wrap mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">What this app does</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  The exact sequence an operator walks through, straight from the builder.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><Layers size={11} /> {pluralize(shape.stepCount, 'step')}</span>
                <span className="flex items-center gap-1"><MousePointerClick size={11} /> {pluralize(shape.widgetCount, 'widget')}</span>
                <span className="flex items-center gap-1"><Zap size={11} /> {pluralize(shape.triggerCount, 'trigger')}</span>
              </div>
            </header>

            {steps.length === 0 || !shape.hasContent ? (
              <EmptyState
                icon={Layers}
                title="This app has no content yet"
                description="Open the builder and drop a few widgets onto the first step — instructions, a photo, a pass/fail check."
                action={canEdit ? (
                  <Link to={`/apps/${app.id}/build`} className="btn-primary">
                    <Edit3 size={14} /> Open the builder
                  </Link>
                ) : undefined}
                compact
              />
            ) : (
              <ol className="space-y-3">
                {steps.map(({ step, index, groupName }) => {
                  const widgets = widgetsOf(step);
                  const stepTriggers = Array.isArray(step?.triggers) ? step.triggers.length : 0;
                  return (
                    <li key={step.id || index} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3.5">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 w-6 h-6 rounded-lg bg-white border border-gray-200 text-gray-600 text-[11px] font-bold flex items-center justify-center flex-shrink-0 tabular-nums">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-[13px] font-semibold text-gray-900">{step.name || `Step ${index + 1}`}</h3>
                            {groupName && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
                                {groupName}
                              </span>
                            )}
                            {step.step_type === 'kit' && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                                <Boxes size={9} /> Kit check
                              </span>
                            )}
                            {!!step.takt_time_seconds && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-500">
                                <Clock size={9} /> takt {fmtDuration(step.takt_time_seconds)}
                              </span>
                            )}
                            {stepTriggers > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                                <Zap size={9} /> {pluralize(stepTriggers, 'trigger')}
                              </span>
                            )}
                          </div>
                          {step.description && (
                            <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{step.description}</p>
                          )}

                          {widgets.length === 0 ? (
                            <p className="text-[11px] text-gray-400 mt-2 italic">No widgets on this step yet</p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5 mt-2">
                              {widgets.map((w, wi) => {
                                const captures = isCaptureWidget(w.type);
                                const label = (w.label || w.config?.buttonText || w.config?.variableName || '').trim()
                                  || widgetTypeLabel(w.type);
                                return (
                                  <li
                                    key={w.id || wi}
                                    title={`${widgetTypeLabel(w.type)}${captures ? ' · captures data' : ''}`}
                                    className={`inline-flex items-center gap-1.5 text-[11px] rounded-lg px-2 py-1 border ${
                                      captures
                                        ? 'bg-white border-indigo-100 text-gray-700'
                                        : 'bg-white border-gray-200 text-gray-500'
                                    }`}
                                  >
                                    {captures && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--secondary)' }} />}
                                    <span className="truncate max-w-[180px]">{label}</span>
                                    <span className="text-[10px] text-gray-400">{widgetTypeLabel(w.type)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {shape.captureCount > 0 && (
              <p className="text-[11px] text-gray-400 mt-4 flex items-center gap-1.5">
                <Info size={12} className="flex-shrink-0" />
                {pluralize(shape.captureCount, 'widget')} on this app record a value on every run — those are the
                columns you get in analytics and CSV exports.
              </p>
            )}
          </section>

          {/* Recent runs */}
          <section className="card p-5">
            <header className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Recent runs</h2>
                <p className="text-xs text-gray-400 mt-0.5">The last 10 times this app was opened on the floor.</p>
              </div>
              {stats.runs_total > 0 && (
                <Link to={`/apps/${app.id}/history`} className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1">
                  Full history <ChevronRight size={13} />
                </Link>
              )}
            </header>

            {recentRuns.length === 0 ? (
              <EmptyState
                icon={Play}
                title="Nobody has run this app yet"
                description={published
                  ? 'Open it in the player and complete a run — the data lands right here.'
                  : 'Publish it first, then run it in the player to see data here.'}
                action={published ? (
                  <Link to={`/play/${app.id}`} className="btn-primary"><Play size={14} /> Run it now</Link>
                ) : canEdit ? (
                  <button onClick={handlePublish} disabled={busy} className="btn-primary"><Globe size={14} /> Publish</button>
                ) : undefined}
                compact
              />
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="font-semibold px-1 pb-2">Started</th>
                      <th className="font-semibold px-1 pb-2">Operator</th>
                      <th className="font-semibold px-1 pb-2">Context</th>
                      <th className="font-semibold px-1 pb-2 text-right">Duration</th>
                      <th className="font-semibold px-1 pb-2">Status</th>
                      <th className="px-1 pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recentRuns.map(run => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="px-1 py-2 text-[13px] text-gray-700 whitespace-nowrap" title={fmtDateTime(run.started_at)}>
                          {fmtRelative(run.started_at)}
                        </td>
                        <td className="px-1 py-2 text-[13px] text-gray-700 truncate max-w-[140px]">
                          {run.operator_name || '—'}
                        </td>
                        <td
                          className="px-1 py-2 text-[12px] text-gray-500 truncate max-w-[180px]"
                          title={[run.work_order_number, run.product_type_name, run.station_name].filter(Boolean).join(' · ')}
                        >
                          {[run.work_order_number, run.product_type_name, run.station_name].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="px-1 py-2 text-[13px] text-gray-700 text-right tabular-nums whitespace-nowrap">
                          {fmtDuration(run.duration_s)}
                        </td>
                        <td className="px-1 py-2"><RunStatus status={run.status} /></td>
                        <td className="px-1 py-2 text-right">
                          <Link
                            to={`/completions/${run.id}`}
                            className="text-xs font-medium text-gray-400 hover:text-gray-800 inline-flex items-center gap-0.5"
                          >
                            Open <ChevronRight size={12} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* ── Right: where it runs, who runs it, how it is doing ── */}
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-gray-900">Where this app runs</h2>
            <p className="text-xs text-gray-400 mt-0.5 mb-3">Everything currently pointing at this app.</p>

            <dl className="space-y-2.5">
              <BindingRow icon={Building2} label="Department">
                {bindings.department ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: bindings.department.color || '#94a3b8' }} />
                    {bindings.department.name}
                  </span>
                ) : <Unset>Not assigned</Unset>}
              </BindingRow>

              <BindingRow icon={MapPin} label="Site">
                {bindings.site ? bindings.site.name : <Unset>All sites</Unset>}
              </BindingRow>

              <BindingRow icon={ClipboardList} label="Stations">
                {bindings.stations.length === 0
                  ? <Unset>No station is set to this app</Unset>
                  : (
                    <span className="flex flex-wrap gap-1">
                      {bindings.stations.map(s => (
                        <Link
                          key={s.id}
                          to={`/stations/${s.id}`}
                          className="inline-flex items-center gap-1 text-[12px] rounded-md bg-gray-50 border border-gray-200 px-1.5 py-0.5 hover:border-gray-300"
                        >
                          {s.name}
                        </Link>
                      ))}
                    </span>
                  )}
              </BindingRow>

              <BindingRow icon={Package} label="Product types">
                {bindings.product_types.length === 0
                  ? <Unset>None defined</Unset>
                  : (
                    <span className="flex flex-wrap gap-1">
                      {bindings.product_types.map(p => (
                        <span key={p.id} className="text-[12px] rounded-md bg-gray-50 border border-gray-200 px-1.5 py-0.5">
                          {p.name}
                        </span>
                      ))}
                    </span>
                  )}
              </BindingRow>

              <BindingRow icon={GitBranch} label="Routings">
                {bindings.routings.length === 0
                  ? <Unset>Not used in a routing</Unset>
                  : (
                    <span className="flex flex-col gap-0.5">
                      {bindings.routings.map(r => (
                        <Link key={`${r.routing_id}-${r.step_number}`} to="/routings" className="text-[12px] hover:underline">
                          {r.routing_name} <span className="text-gray-400">· step {r.step_number} {r.step_name}</span>
                        </Link>
                      ))}
                    </span>
                  )}
              </BindingRow>

              <BindingRow icon={ClipboardList} label="Work orders">
                {bindings.work_order_count === 0
                  ? <Unset>None yet</Unset>
                  : (
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[12px] text-gray-500">
                        {pluralize(bindings.work_order_count, 'work order')} run through this app
                      </span>
                      {bindings.work_orders.slice(0, 4).map(wo => (
                        <Link key={wo.id} to="/schedule" className="text-[12px] hover:underline">
                          {wo.work_order_number} <span className="text-gray-400">· {wo.part_number} · {wo.quantity_completed}/{wo.quantity}</span>
                        </Link>
                      ))}
                    </span>
                  )}
              </BindingRow>
            </dl>
          </section>

          <section className="card p-5">
            <header className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Who has run it</h2>
                <p className="text-xs text-gray-400 mt-0.5">Everyone who worked a run, including anyone who picked one up mid-job.</p>
              </div>
            </header>
            {operators.length === 0 ? (
              <EmptyState icon={Users} title="No operators yet" description="Nobody has opened this app on the floor." compact />
            ) : (
              <ul className="space-y-2">
                {operators.slice(0, 8).map(op => (
                  <li key={op.operator_name} className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">
                      {initials(op.operator_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-gray-800 truncate">{op.operator_name}</span>
                      <span className="block text-[11px] text-gray-400">
                        {pluralize(op.runs, 'run')}
                        {op.joined_runs > 0 && ` (${op.joined_runs} joined)`}
                        {' · last '}{fmtRelative(op.last_run_at)}
                      </span>
                    </span>
                    <span className="text-[12px] text-gray-500 tabular-nums flex-shrink-0">
                      {fmtDuration(op.avg_duration_s)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <header className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Last 30 days</h2>
              <Link to={`/apps/${app.id}/analytics`} className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1">
                Full analytics <ChevronRight size={13} />
              </Link>
            </header>
            <dl className="grid grid-cols-2 gap-3">
              <MiniStat label="Runs started" value={String(stats.runs_30d)} />
              <MiniStat label="Completed" value={String(stats.completed_30d)} />
              <MiniStat label="Avg run time" value={fmtDuration(stats.avg_duration_30d_s)} />
              <MiniStat label="Abandoned, all time" value={String(stats.abandoned)} />
            </dl>
            <p className="text-[11px] text-gray-400 mt-3">
              {stats.first_run_at
                ? <>First run {fmtRelative(stats.first_run_at)} · last run {fmtRelative(stats.last_run_at)}</>
                : 'No runs recorded yet.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: React.ElementType; label: string; value: string; hint?: string; tone?: 'good';
}) {
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <Icon size={12} /> {label}
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${tone === 'good' ? 'text-green-600' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="text-[15px] font-semibold text-gray-900 tabular-nums mt-0.5">{value}</dd>
    </div>
  );
}

function BindingRow({ icon: Icon, label, children }: {
  icon: React.ElementType; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-gray-300 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] text-gray-400">{label}</dt>
        <dd className="text-[13px] text-gray-700 mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

function Unset({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400">{children}</span>;
}

function RunStatus({ status }: { status: 'in_progress' | 'completed' | 'abandoned' }) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700">
        <CheckCircle2 size={10} /> Completed
      </span>
    );
  }
  if (status === 'abandoned') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600">
        <XCircle size={10} /> Abandoned
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
      <Loader2 size={10} /> In progress
    </span>
  );
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
