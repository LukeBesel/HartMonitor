// The App Library — HartMonitor's front door.
//
// Apps are the product's hero: a supervisor builds a guided procedure here,
// publishes it, and operators run it on the floor. So this page is a showcase,
// not a list — it shows what each app IS (steps, fields, where it runs) and
// what it has DONE (runs this week, last run), and it puts starting points in
// front of anyone who has not built one yet.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { AppRunStats } from '../api/client';
import { App } from '../types';
import {
  Plus, Play, Edit3, Trash2, Search, AppWindow, AlertTriangle,
  BarChart2, MoreVertical, Globe, Lock, Copy, Download, RefreshCw, Database,
  Layers, MousePointerClick, Activity, Clock, ArrowRight, Blocks, Zap, Info,
} from 'lucide-react';
import PageHeader from '../components/shared/PageHeader';
import EmptyState from '../components/shared/EmptyState';
import UpgradeModal from '../components/shared/UpgradeModal';
import TemplatePickerModal from '../components/shared/TemplatePickerModal';
import TemplateGallery, { TemplateChoice } from '../components/apps/TemplateGallery';
import { useCoachDocked } from '../components/apps/AppTrainingCoach';
import { appShape, fmtRelative, pluralize } from '../components/apps/appModel';
import OnboardingWizard from '../components/shared/OnboardingWizard';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

type StatusFilter = 'all' | 'published' | 'draft';

export default function AppsLibrary() {
  const [apps, setApps] = useState<App[]>([]);
  const [stats, setStats] = useState<Record<string, AppRunStats>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [picker, setPicker] = useState<{ selection?: TemplateChoice; name?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [limitReason, setLimitReason] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const { refresh: refreshPlan } = usePlan();
  const { isAtLeast, canEdit } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // The training coach floats bottom-right; leave it a lane rather than let it
  // cover a column of cards.
  const coachDocked = useCoachDocked();

  // The guided training (and the Command Center's empty state) send people here
  // with ?new=1 when the next honest action is "create an app".
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setPicker({});
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const load = () => {
    setLoadError(null);
    return Promise.all([api.getApps(), api.getAppsStats().catch(() => null)])
      .then(([appList, statsRes]) => {
        setApps(Array.isArray(appList) ? (appList as App[]) : []);
        const byId: Record<string, AppRunStats> = {};
        for (const s of statsRes?.apps ?? []) byId[s.app_id] = s;
        setStats(byId);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load apps'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleCreated = (app: App) => {
    setPicker(null);
    refreshPlan();
    navigate(`/apps/${app.id}/build`);
  };

  const handleLimit = (reason: string) => {
    setPicker(null);
    setLimitReason(reason);
  };

  const handleSaveAsTemplate = async (app: App) => {
    const name = prompt('Template name:', app.name);
    if (name === null || !name.trim()) return;
    const description = prompt('Template description (optional):', app.description || '');
    if (description === null) return;
    try {
      const saved = await api.saveAppAsTemplate(app.id, { name: name.trim(), description });
      addToast(`Template "${saved.name}" saved — it now shows up as a starting point`, 'success');
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to save template', 'error');
    }
  };

  const handleDuplicate = async (app: App) => {
    try {
      const copy = await api.duplicateApp(app.id);
      addToast(`Created "${copy.name}"`, 'success');
      refreshPlan();
      navigate(`/apps/${copy.id}/build`);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to duplicate app', 'error');
    }
  };

  const handleDelete = async (app: App) => {
    if (!confirm(`Delete "${app.name}" and all of its run data?`)) return;
    try {
      await api.deleteApp(app.id);
      addToast(`Deleted "${app.name}"`, 'success');
      load();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to delete app', 'error');
    }
  };

  // Publishing is under change control: it needs a change note, and an
  // approver when the app requires one. That conversation belongs to the
  // builder's publish flow — a card in a grid has nowhere to hold it, and
  // firing the bare call from here now fails with CHANGE_NOTE_REQUIRED.
  const handlePublish = (app: App) => {
    navigate(`/apps/${app.id}/build`);
  };

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    try {
      await api.loadSampleData();
      addToast('Sample data loaded', 'success');
      load();
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : 'Failed to load sample data', 'error');
    } finally {
      setLoadingSample(false);
    }
  };

  const openPicker = (selection?: TemplateChoice, name?: string) => setPicker({ selection, name });

  const publishedCount = apps.filter(a => a.status === 'published').length;
  const draftCount = apps.length - publishedCount;
  const runsThisWeek = Object.values(stats).reduce((sum, s) => sum + (s.runs_7d || 0), 0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter(a => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (a.name || '').toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q);
    });
  }, [apps, search, statusFilter]);

  const isEmpty = !loading && !loadError && apps.length === 0;

  return (
    <div className={`p-6 space-y-6 transition-[padding] ${coachDocked ? 'lg:pr-[392px]' : ''}`}>
      {/* New accounts land here rather than on the Command Center, so the
          first-run welcome lives here too. It self-gates on the company's
          onboarding_completed setting, so it shows exactly once. */}
      <OnboardingWizard />

      <PageHeader
        title="Apps"
        subtitle="Build a guided procedure once. Your floor runs it on every station, and the data comes straight back here."
        actions={canEdit && !isEmpty ? (
          <button onClick={() => openPicker()} className="btn-primary">
            <Plus size={16} /> New app
          </button>
        ) : undefined}
      />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="card h-56 animate-pulse bg-gray-100" />)}
        </div>
      ) : loadError ? (
        <div className="card p-10">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn't load your apps"
            description={loadError}
            action={
              <button onClick={() => { setLoading(true); load(); }} className="btn-secondary">
                <RefreshCw size={14} /> Retry
              </button>
            }
          />
        </div>
      ) : isEmpty ? (
        <FirstAppHero
          canEdit={canEdit}
          canLoadSample={isAtLeast('manager')}
          loadingSample={loadingSample}
          onLoadSample={handleLoadSampleData}
          onPick={openPicker}
        />
      ) : (
        <>
          {/* Portfolio summary — every number here is counted from real rows. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryTile icon={AppWindow} label="Apps" value={String(apps.length)} />
            <SummaryTile icon={Globe} label="Published" value={String(publishedCount)} tone="good" />
            <SummaryTile icon={Lock} label="Drafts" value={String(draftCount)} />
            <SummaryTile icon={Activity} label="Runs this week" value={String(runsThisWeek)} />
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input-field pl-9"
                placeholder="Search apps…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5">
              {(['all', 'published', 'draft'] as StatusFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 text-[13px] font-medium rounded-md capitalize transition-colors ${
                    statusFilter === f ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                icon={Search}
                title="No apps match those filters"
                description="Try a different search term, or clear the status filter."
                action={
                  <button onClick={() => { setSearch(''); setStatusFilter('all'); }} className="btn-secondary">
                    Clear filters
                  </button>
                }
              />
            </div>
          ) : (
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${coachDocked ? '' : 'xl:grid-cols-3'}`}>
              {filtered.map(app => (
                <AppCard
                  key={app.id}
                  app={app}
                  runStats={stats[app.id]}
                  canEdit={canEdit}
                  onDelete={handleDelete}
                  onPublish={handlePublish}
                  onSaveTemplate={handleSaveAsTemplate}
                  onDuplicate={handleDuplicate}
                />
              ))}
            </div>
          )}

          {/* Starting points stay visible for people building app number two. */}
          {canEdit && (
            <section className="pt-2">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-gray-900">Start another app</h2>
                <span className="text-xs text-gray-400">Model templates ship with real steps you can edit</span>
              </div>
              <TemplateGallery onPick={(choice, name) => openPicker(choice, name)} />
            </section>
          )}
        </>
      )}

      {picker && (
        <TemplatePickerModal
          onClose={() => setPicker(null)}
          onCreated={handleCreated}
          onLimit={handleLimit}
          initialSelection={picker.selection}
          initialName={picker.name}
        />
      )}

      {limitReason && (
        <UpgradeModal
          feature="app"
          reason={limitReason}
          onClose={() => setLimitReason(null)}
          onPurchased={() => setPicker({})}
        />
      )}
    </div>
  );
}

// ── First-run hero ───────────────────────────────────────────────────────────

function FirstAppHero({ canEdit, canLoadSample, loadingSample, onLoadSample, onPick }: {
  canEdit: boolean;
  canLoadSample: boolean;
  loadingSample: boolean;
  onLoadSample: () => void;
  onPick: (choice?: TemplateChoice, name?: string) => void;
}) {
  if (!canEdit) {
    return (
      <div className="card p-10">
        <EmptyState
          icon={AppWindow}
          title="No apps published yet"
          description="Apps are the guided procedures you run at a station. A supervisor or manager builds them — ask yours to publish one and it will appear here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8 sm:p-10 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)' }}
      >
        <div
          aria-hidden
          className="absolute -top-24 -right-16 w-72 h-72 rounded-full opacity-25 blur-3xl"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}
        />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-white/10 rounded-full px-2.5 py-1">
            <Blocks size={12} /> No-code app builder
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold mt-4 leading-tight">Build your first app</h2>
          <p className="text-blue-100/80 text-sm sm:text-[15px] mt-2.5 leading-relaxed">
            Drag steps and fields onto the page, add When / If / Then logic without writing code,
            and publish. Operators run it on a tablet at the station — every value they enter comes
            back as data you can chart, export and act on.
          </p>
          <div className="flex flex-wrap gap-2 mt-6">
            <button onClick={() => onPick()} className="inline-flex items-center gap-2 rounded-xl bg-white text-gray-900 px-4 py-2.5 text-sm font-semibold hover:bg-gray-100 transition-colors">
              <Plus size={16} /> Build your first app
            </button>
            {canLoadSample && (
              <button
                onClick={onLoadSample}
                disabled={loadingSample}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 text-white px-4 py-2.5 text-sm font-semibold hover:bg-white/20 transition-colors disabled:opacity-60"
              >
                {loadingSample ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
                Load sample data instead
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-7 text-[13px] text-blue-100/70">
            <span className="flex items-center gap-1.5"><Layers size={13} /> Steps operators walk through</span>
            <span className="flex items-center gap-1.5"><MousePointerClick size={13} /> Fields that capture data</span>
            <span className="flex items-center gap-1.5"><Zap size={13} /> Triggers instead of code</span>
          </div>
        </div>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Pick a starting point</h3>
        <p className="text-xs text-gray-400 mt-0.5 mb-3">
          HartMonitor's model templates are real, editable apps — open one and change it to match your process.
        </p>
        <TemplateGallery emphasis onPick={(choice, name) => onPick(choice, name)} />
      </section>
    </div>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function SummaryTile({ icon: Icon, label, value, tone }: {
  icon: React.ElementType; label: string; value: string; tone?: 'good';
}) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
        tone === 'good' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
      }`}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="text-lg font-bold text-gray-900 leading-none tabular-nums">{value}</div>
        <div className="text-[11px] text-gray-400 mt-1 truncate">{label}</div>
      </div>
    </div>
  );
}

function AppCard({ app, runStats, canEdit, onDelete, onPublish, onSaveTemplate, onDuplicate }: {
  app: App;
  runStats?: AppRunStats;
  canEdit: boolean;
  onDelete: (app: App) => void;
  onPublish: (app: App) => void;
  onSaveTemplate: (app: App) => void;
  onDuplicate: (app: App) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const shape = appShape(app);
  const published = app.status === 'published';

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  const handleExport = async (kind: 'completions' | 'bundle') => {
    setMenuOpen(false);
    setExporting(true);
    try {
      if (kind === 'completions') await api.downloadAppCompletions(app.id);
      else await api.downloadAppBundle(app.id);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card p-0 flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      {/* Body — the whole block opens the in-depth view */}
      <Link to={`/apps/${app.id}`} className="block p-5 pb-4 flex-1 group">
        <div className="flex items-start justify-between gap-2">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            published ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {published ? <Globe size={10} /> : <Lock size={10} />}
            {published ? 'Published' : 'Draft'}
          </span>
          <div className="relative flex-shrink-0" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
              aria-label={`More actions for ${app.name}`}
              className="p-1.5 -mr-1.5 -mt-1 hover:bg-gray-100 rounded-lg text-gray-400"
            >
              <MoreVertical size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 w-56 text-left">
                {canEdit && !published && (
                  <MenuItem icon={Globe} label="Publish in builder" tone="good" onClick={() => { setMenuOpen(false); onPublish(app); }} />
                )}
                {canEdit && (
                  <MenuItem icon={Copy} label="Duplicate" onClick={() => { setMenuOpen(false); onDuplicate(app); }} />
                )}
                {canEdit && (
                  <MenuItem icon={Layers} label="Save as template" onClick={() => { setMenuOpen(false); onSaveTemplate(app); }} />
                )}
                <MenuItem icon={Download} label="Export runs (CSV)" disabled={exporting} onClick={() => handleExport('completions')} />
                <MenuItem icon={Download} label="Export app bundle (JSON)" disabled={exporting} onClick={() => handleExport('bundle')} />
                {canEdit && (
                  <MenuItem icon={Trash2} label="Delete" tone="bad" onClick={() => { setMenuOpen(false); onDelete(app); }} />
                )}
              </div>
            )}
          </div>
        </div>

        <h3 className="font-semibold text-gray-900 mt-2.5 truncate group-hover:underline decoration-gray-300 underline-offset-4">
          {app.name}
        </h3>
        <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2 min-h-[2rem]">
          {app.description || 'No description yet — add one in the builder so your team knows when to use this app.'}
        </p>

        {/* What it is */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-[11px] text-gray-500">
          <span className="flex items-center gap-1"><Layers size={11} /> {pluralize(shape.stepCount, 'step')}</span>
          <span className="flex items-center gap-1"><MousePointerClick size={11} /> {pluralize(shape.widgetCount, 'field')}</span>
          {shape.triggerCount > 0 && (
            <span className="flex items-center gap-1"><Zap size={11} /> {pluralize(shape.triggerCount, 'trigger')}</span>
          )}
        </div>

        {/* What it has done */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-400">
          <span className="flex items-center gap-1">
            <Activity size={11} /> {runStats?.runs_7d ?? 0} this week
          </span>
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {runStats?.last_run_at ? `Last run ${fmtRelative(runStats.last_run_at)}` : 'Never run'}
          </span>
          {(runStats?.in_progress ?? 0) > 0 && (
            <span className="flex items-center gap-1 text-blue-500 font-medium">
              {runStats!.in_progress} in progress
            </span>
          )}
        </div>
      </Link>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50/50">
        {canEdit ? (
          <Link to={`/apps/${app.id}/build`} className="btn-secondary flex-1 min-w-[96px] justify-center text-xs">
            <Edit3 size={12} /> Builder
          </Link>
        ) : (
          <Link to={`/apps/${app.id}`} className="btn-secondary flex-1 min-w-[96px] justify-center text-xs">
            <Info size={12} /> Details
          </Link>
        )}
        {/* One entrance to this app's data, and the rollup people actually
            wanted is one click away rather than six. */}
        <Link
          to={`/apps/${app.id}?tab=who`}
          className="btn-secondary flex-1 min-w-[96px] justify-center text-xs"
          title="Who ran this app, how long it took them, and every run"
        >
          <BarChart2 size={12} /> Who ran it
        </Link>
        {published ? (
          <Link to={`/play/${app.id}`} className="btn-primary flex-1 min-w-[96px] justify-center text-xs">
            <Play size={12} /> Run
          </Link>
        ) : canEdit ? (
          <button onClick={() => onPublish(app)} className="btn-primary flex-1 min-w-[96px] justify-center text-xs">
            <Globe size={12} /> Publish in builder
          </button>
        ) : (
          <Link to={`/apps/${app.id}`} className="btn-secondary flex-1 min-w-[96px] justify-center text-xs">
            <ArrowRight size={12} /> Open
          </Link>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, tone, disabled }: {
  icon: React.ElementType; label: string; onClick: () => void;
  tone?: 'good' | 'bad'; disabled?: boolean;
}) {
  const color = tone === 'good' ? 'text-green-600' : tone === 'bad' ? 'text-red-600' : 'text-gray-700';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 w-full ${color} disabled:opacity-50`}
    >
      <Icon size={13} /> {label}
    </button>
  );
}
