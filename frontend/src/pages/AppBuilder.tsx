// ─── App Builder — Tulip-style four-region editor (remodel spec §4) ───────────
// Top bar · Step list (left) · Widget toolbar + canvas (center) · Context
// panel (right). The canvas engine (CanvasEditor) is untouched mechanically —
// token restyle + zoom wrapper only. Saving writes schema_version 2 through
// the typed saveApp client; v1 apps load through normalizeApp.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AppSavePayload } from '../api/client';
import {
  App, Department, ProductType, Station, Step, Trigger, Widget, WidgetLayout, WidgetType,
} from '../types';
import { normalizeApp } from '../engine';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, CheckSquare,
  Globe, Image, Loader2, MapPin, Maximize2, PenTool, Play, Plus,
  Save, Trash2, Variable as VariableIcon, X, ZoomIn, ZoomOut, GripVertical,
} from 'lucide-react';
import CanvasEditor from '../components/app/CanvasEditor';
import { defaultLayout, DEFAULT_CANVAS_H, ShapeSVG } from '../components/app/WidgetView';
import WidgetPalette, { defaultWidget, WIDGET_META } from '../components/builder/WidgetPalette';
import StepList from '../components/builder/StepList';
import ContextPanel, { ContextTab, Field, effectiveRequireRunContext } from '../components/builder/ContextPanel';
import TriggerEditor, { TriggerAttachment } from '../components/builder/TriggerEditor';
import VariablesPanel, { autoRegisterVariables } from '../components/builder/VariablesPanel';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../context/AuthContext';

type ZoomMode = 'fit' | number;
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5];

export default function AppBuilder() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useAuth();
  const [app, setApp] = useState<App | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<ContextTab>('widget');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [showVariables, setShowVariables] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [triggerModal, setTriggerModal] = useState<{ attachment: TriggerAttachment; trigger: Trigger | null } | null>(null);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const loadApp = useCallback(() => {
    if (!id) return;
    setLoadError(null);
    api.getApp(id)
      .then((raw: App) => {
        // v1 → v2 in memory; dormant variables column activated by
        // auto-registering legacy free-text variable names (spec §4.1).
        setApp(autoRegisterVariables(normalizeApp(raw)));
        setDirty(false);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load app'));
    api.getProductTypes(id).then(setProductTypes).catch(() => {});
  }, [id]);

  useEffect(() => { loadApp(); }, [loadApp]);

  // The builder is a light, focused workbench — its root stays light even
  // when the rest of the app runs dark (spec §1.4). Restored on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    return () => { if (wasDark) root.classList.add('dark'); };
  }, []);

  useEffect(() => {
    api.getDepartments().then(setDepartments).catch(() => {});
    api.getStations().then(setStations).catch(() => {});
  }, []);

  // ── Save: whole-blob PUT via the typed client; flips schema_version to 2 ────
  const save = useCallback(async (appData: App): Promise<boolean> => {
    if (!id) return false;
    setSaving(true);
    setSaveError('');
    try {
      // require_run_context rides the same whole-blob PUT as the other
      // app-level fields (player contract: app.require_run_context, boolean,
      // absent = legacy). Sent explicitly so the saved app is self-describing.
      const payload: AppSavePayload & { require_run_context: boolean } = {
        name: appData.name,
        description: appData.description,
        steps: appData.steps,
        step_groups: appData.step_groups ?? [],
        variables: appData.variables ?? [],
        schema_version: 2,
        department_id: appData.department_id ?? null,
        station_id: appData.station_id ?? null,
        show_takt_warnings: appData.show_takt_warnings ? 1 : 0,
        require_run_context: effectiveRequireRunContext(appData),
      };
      await api.saveApp(id, payload);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save app');
      return false;
    } finally {
      setSaving(false);
    }
  }, [id]);

  // Cmd/Ctrl+S saves.
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (appRef.current && canEdit) save(appRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save, canEdit]);

  const activeStep = app?.steps[activeStepIdx];
  const selectedWidget = activeStep?.widgets.find(w => w.id === selectedWidgetId) ?? null;

  // ── State updaters (logic unchanged — relocated per spec §4.3) ─────────────

  const updateApp = (updater: (prev: App) => App) => {
    setApp(prev => prev ? updater(prev) : prev);
    setDirty(true);
  };

  const updateStep = (updater: (step: Step) => Step) => {
    updateApp(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === activeStepIdx ? updater(s) : s),
    }));
  };

  const addWidget = (type: WidgetType) => {
    const widget = defaultWidget(type);
    updateStep(step => {
      const isCanvas = step.layoutMode === 'canvas';
      const placed: Widget = isCanvas
        ? { ...widget, order: step.widgets.length, layout: defaultLayout(type, step.widgets.length) }
        : { ...widget, order: step.widgets.length };
      return { ...step, widgets: [...step.widgets, placed] };
    });
    setSelectedWidgetId(widget.id);
    setRightTab('widget');
  };

  const updateWidgetLayout = (widgetId: string, layout: WidgetLayout) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w => w.id === widgetId ? { ...w, layout } : w),
    }));
  };

  const restackWidget = (widgetId: string, dir: 'front' | 'back') => {
    updateStep(step => {
      const zs = step.widgets.map(w => w.layout?.z ?? 0);
      const target = dir === 'front' ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
      return {
        ...step,
        widgets: step.widgets.map(w =>
          w.id === widgetId ? { ...w, layout: { ...(w.layout ?? defaultLayout(w.type)), z: target } } : w),
      };
    });
  };

  const setStepMode = (mode: 'flow' | 'canvas') => {
    updateStep(step => {
      if (mode === 'flow') return { ...step, layoutMode: 'flow' };
      let y = 32;
      const widgets = step.widgets.map((w, i) => {
        if (w.layout) return w;
        const base = defaultLayout(w.type, i);
        const placed = { ...w, layout: { ...base, x: 40, y } };
        y += base.height + 16;
        return placed;
      });
      return {
        ...step,
        layoutMode: 'canvas',
        canvasHeight: step.canvasHeight ?? Math.max(DEFAULT_CANVAS_H, y + 32),
        widgets,
      };
    });
  };

  const removeWidget = (widgetId: string) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.filter(w => w.id !== widgetId).map((w, i) => ({ ...w, order: i })),
    }));
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null);
  };

  const updateWidget = (widgetId: string, updates: Partial<Widget>) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w),
    }));
  };

  const updateWidgetConfig = (widgetId: string, configUpdates: Partial<Widget['config']>) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w =>
        w.id === widgetId ? { ...w, config: { ...w.config, ...configUpdates } } : w),
    }));
  };

  const handleWidgetDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeStep) return;
    const oldIdx = activeStep.widgets.findIndex(w => w.id === active.id);
    const newIdx = activeStep.widgets.findIndex(w => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    updateStep(step => ({
      ...step,
      widgets: arrayMove(step.widgets, oldIdx, newIdx).map((w, i) => ({ ...w, order: i })),
    }));
  };

  // ── Trigger editor wiring ───────────────────────────────────────────────────

  const openTriggerEditor = (attachment: TriggerAttachment, trigger: Trigger | null) =>
    setTriggerModal({ attachment, trigger });

  const saveTrigger = (trigger: Trigger) => {
    if (!triggerModal) return;
    const { attachment } = triggerModal;
    if (attachment.kind === 'widget') {
      const existing = attachment.widget.triggers ?? [];
      const next = existing.some(t => t.id === trigger.id)
        ? existing.map(t => t.id === trigger.id ? trigger : t)
        : [...existing, trigger];
      updateWidget(attachment.widget.id, { triggers: next });
    } else {
      updateStep(s => {
        const existing = s.triggers ?? [];
        const next = existing.some(t => t.id === trigger.id)
          ? existing.map(t => t.id === trigger.id ? trigger : t)
          : [...existing, trigger];
        return { ...s, triggers: next };
      });
    }
    setTriggerModal(null);
  };

  const deleteTrigger = () => {
    if (!triggerModal?.trigger) { setTriggerModal(null); return; }
    const { attachment, trigger } = triggerModal;
    if (attachment.kind === 'widget') {
      updateWidget(attachment.widget.id, {
        triggers: (attachment.widget.triggers ?? []).filter(t => t.id !== trigger.id),
      });
    } else {
      updateStep(s => ({ ...s, triggers: (s.triggers ?? []).filter(t => t.id !== trigger.id) }));
    }
    setTriggerModal(null);
  };

  // ── Publish ─────────────────────────────────────────────────────────────────

  const handlePublish = async (target: { department_id: string | null; station_id: string | null }) => {
    if (!id || !app) return;
    const next = { ...app, department_id: target.department_id, station_id: target.station_id };
    setApp(next);
    const ok = await save(next);
    if (!ok) return;
    try {
      await api.publishApp(id);
      setApp(prev => prev ? { ...prev, status: 'published', department_id: target.department_id, station_id: target.station_id } : prev);
      setShowPublishModal(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to publish app');
    }
  };

  // ── Zoom helpers ────────────────────────────────────────────────────────────

  const zoomIdx = typeof zoom === 'number' ? ZOOM_STEPS.indexOf(zoom) : -1;
  const zoomOut = () => setZoom(z => {
    const i = typeof z === 'number' ? ZOOM_STEPS.indexOf(z) : ZOOM_STEPS.indexOf(1);
    return ZOOM_STEPS[Math.max(0, i - 1)];
  });
  const zoomIn = () => setZoom(z => {
    const i = typeof z === 'number' ? ZOOM_STEPS.indexOf(z) : ZOOM_STEPS.indexOf(1);
    return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, i + 1)];
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!app) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-page">
          <AlertTriangle size={32} className="text-bad mb-3" />
          <p className="text-ink" style={{ fontWeight: 650 }}>Couldn&rsquo;t load app</p>
          <p className="text-muted text-sm mt-1">{loadError}</p>
          <button onClick={loadApp} className="wb-btn mt-4">Retry</button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full bg-page">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  const variableCount = (app.variables ?? []).length;

  return (
    <>
    <div className="flex flex-col h-screen bg-page text-ink" style={{ fontSize: 15 }}>
      {!canEdit && (
        <div className="border-b text-center px-4 py-1.5 flex-shrink-0" style={{ background: 'var(--gold-wash)', borderColor: 'rgba(240,180,41,0.35)', color: 'var(--warn-ink)', fontSize: 12 }}>
          You have view-only access — changes can&rsquo;t be saved.
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="bg-surface-1 border-b border-border-subtle px-3.5 py-2 flex items-center gap-3 flex-shrink-0">
        <Link to="/apps" className="wb-btn-ghost !min-h-0 p-1.5" title="Back to apps">
          <ChevronLeft size={18} />
        </Link>
        <div className="flex-1 flex items-center gap-2.5 min-w-0">
          <input
            className="bg-transparent border-none outline-none hover:bg-surface-2 focus:bg-surface-2 px-2 py-0.5 rounded-ctrl min-w-0"
            style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', width: 'min(340px, 40vw)' }}
            value={app.name}
            readOnly={!canEdit}
            onChange={e => updateApp(prev => ({ ...prev, name: e.target.value }))}
          />
          <span
            className="flex-shrink-0 rounded-full px-2 py-0.5"
            style={app.status === 'published'
              ? { fontSize: 11, fontWeight: 650, color: 'var(--good)', background: 'rgba(43,138,62,0.12)', border: '1px solid rgba(43,138,62,0.3)' }
              : { fontSize: 11, fontWeight: 650, color: 'var(--warn-ink)', background: 'var(--gold-wash)', border: '1px solid rgba(240,180,41,0.35)' }}
          >
            {app.status}
          </span>
        </div>

        {/* Save state chip */}
        <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0" style={{ fontSize: 12, fontWeight: 550 }}>
          {saving ? (
            <span className="flex items-center gap-1.5 text-muted"><Loader2 size={12} className="animate-spin" /> Saving…</span>
          ) : saved ? (
            <span className="flex items-center gap-1.5 text-good"><CheckCircle2 size={13} className="check-pop" /> Saved</span>
          ) : dirty ? (
            <span className="flex items-center gap-1.5 text-warn-ink"><span className="w-1.5 h-1.5 rounded-full bg-gold" /> Unsaved changes</span>
          ) : (
            <span className="text-muted">All changes saved</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={() => setShowVariables(true)} className="wb-btn !min-h-[34px] !text-[12.5px]" title="App variables">
            <VariableIcon size={13} /> Variables
            {variableCount > 0 && <span className="tnum rounded-full px-1.5 bg-accent-tint text-accent" style={{ fontSize: 10.5, fontWeight: 650 }}>{variableCount}</span>}
          </button>
          <Link to={`/play/${app.id}?preview=1`} target="_blank" className="wb-btn !min-h-[34px] !text-[12.5px]" title="Preview in the player (writes nothing)">
            <Play size={13} /> Preview
          </Link>
          {canEdit && (
            <button onClick={() => save(app)} disabled={saving} className="wb-btn !min-h-[34px] !text-[12.5px]">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowPublishModal(true)} className="wb-btn-primary !min-h-[34px] !text-[12.5px]">
              <Globe size={13} /> Publish
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0" style={{ background: 'rgba(201,42,42,0.1)', borderBottom: '1px solid rgba(201,42,42,0.3)', color: 'var(--bad)', fontSize: 12.5, fontWeight: 550 }}>
          <AlertTriangle size={13} /> {saveError}
          <button onClick={() => setSaveError('')} className="ml-auto p-0.5" aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      {/* ── Four-region body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — step list */}
        <StepList
          app={app}
          activeStepIdx={activeStepIdx}
          onSelectStep={idx => { setActiveStepIdx(idx); setSelectedWidgetId(null); if (rightTab === 'widget') setRightTab('step'); }}
          onChangeApp={updateApp}
          canEdit={canEdit}
        />

        {/* Center — widget toolbar + canvas */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <WidgetPalette onAdd={addWidget} disabled={!canEdit} />

          {/* Canvas scroller */}
          <div className="flex-1 overflow-auto p-6 relative">
            <div className={`mx-auto ${activeStep?.layoutMode === 'canvas' ? '' : 'max-w-2xl'}`}
              style={activeStep?.layoutMode === 'canvas' && typeof zoom === 'number' ? { width: 'max-content', minWidth: '100%' } : undefined}>
              {/* Step header */}
              <div className="mb-3 flex items-center gap-2" style={activeStep?.layoutMode === 'canvas' ? { maxWidth: 720, margin: '0 auto 12px' } : undefined}>
                <input
                  className="bg-transparent border-none outline-none hover:bg-surface-1 focus:bg-surface-1 px-2 py-1 rounded-ctrl flex-1 min-w-0 text-ink"
                  style={{ fontSize: 17, fontWeight: 750 }}
                  value={activeStep?.name ?? ''}
                  readOnly={!canEdit}
                  onChange={e => updateStep(s => ({ ...s, name: e.target.value }))}
                  onFocus={() => { if (!selectedWidgetId) setRightTab('step'); }}
                />
                <span className="tnum flex-shrink-0 text-muted rounded-full bg-surface-2 px-2 py-0.5" style={{ fontSize: 11, fontWeight: 550 }}>
                  Step {activeStepIdx + 1} of {app.steps.length}
                </span>
                {activeStep?.layoutMode === 'canvas' && (
                  <div className="seg flex-shrink-0">
                    <button onClick={zoomOut} disabled={zoomIdx === 0} title="Zoom out" aria-label="Zoom out"><ZoomOut size={13} /></button>
                    <button
                      className={zoom === 'fit' ? 'is-active' : ''}
                      onClick={() => setZoom('fit')}
                      title="Fit to window"
                    >
                      <Maximize2 size={11} /> Fit
                    </button>
                    <button
                      className={`tnum ${zoom === 1 ? 'is-active' : ''}`}
                      onClick={() => setZoom(1)}
                      title="Actual size"
                    >
                      {typeof zoom === 'number' ? `${Math.round(zoom * 100)}%` : '100%'}
                    </button>
                    <button onClick={zoomIn} disabled={zoomIdx === ZOOM_STEPS.length - 1} title="Zoom in" aria-label="Zoom in"><ZoomIn size={13} /></button>
                  </div>
                )}
              </div>

              {activeStep?.layoutMode === 'canvas' ? (
                <>
                  {activeStep.widgets.length === 0 && (
                    <div className="mb-3 text-center text-muted" style={{ fontSize: 12 }}>
                      Add widgets from the toolbar above, then drag, resize, and rotate them anywhere on the canvas.
                      Add more steps with &ldquo;+ New step&rdquo; in the left panel.
                    </div>
                  )}
                  <CanvasEditor
                    step={activeStep}
                    selectedId={selectedWidgetId}
                    onSelect={(wid) => { setSelectedWidgetId(wid); setRightTab(wid ? 'widget' : 'step'); }}
                    onChangeLayout={updateWidgetLayout}
                    zoom={typeof zoom === 'number' ? zoom : undefined}
                  />
                </>
              ) : (
                /* ── Stacked flow list (unchanged mechanics) ── */
                <div
                  className="bg-surface-1 rounded-card border-2 border-dashed border-baseline min-h-64 p-4 space-y-2"
                  onClick={() => setSelectedWidgetId(null)}
                >
                  {(!activeStep || activeStep.widgets.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-12 text-baseline">
                      <Plus size={32} className="mb-2" />
                      <p className="text-sm text-muted">Click widgets in the toolbar above to add them</p>
                      <p className="mt-1 text-muted" style={{ fontSize: 12 }}>Add more steps with &ldquo;+ New step&rdquo; in the left panel</p>
                    </div>
                  )}
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWidgetDragEnd}>
                    <SortableContext items={activeStep?.widgets.map(w => w.id) ?? []} strategy={verticalListSortingStrategy}>
                      {activeStep?.widgets.map(widget => (
                        <SortableWidgetCard
                          key={widget.id}
                          widget={widget}
                          isSelected={selectedWidgetId === widget.id}
                          onClick={e => { e.stopPropagation(); setSelectedWidgetId(widget.id); setRightTab('widget'); }}
                          onRemove={() => removeWidget(widget.id)}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right — context panel */}
        <ContextPanel
          tab={rightTab}
          onTab={setRightTab}
          app={app}
          activeStepIdx={activeStepIdx}
          selectedWidget={selectedWidget}
          canEdit={canEdit}
          productTypes={productTypes}
          departments={departments}
          stations={stations}
          onUpdateApp={updateApp}
          onUpdateStep={updateStep}
          onUpdateWidget={updateWidget}
          onUpdateWidgetConfig={updateWidgetConfig}
          onUpdateWidgetLayout={updateWidgetLayout}
          onRestack={restackWidget}
          onRemoveWidget={removeWidget}
          onSetMode={setStepMode}
          onUpdateProductTypes={setProductTypes}
          onEditTrigger={openTriggerEditor}
        />
      </div>
    </div>

    {/* Variables panel */}
    {showVariables && (
      <VariablesPanel app={app} onChangeApp={updateApp} onClose={() => setShowVariables(false)} canEdit={canEdit} />
    )}

    {/* Trigger editor */}
    {triggerModal && (
      <TriggerEditor
        app={app}
        attachment={triggerModal.attachment}
        initial={triggerModal.trigger}
        onSave={saveTrigger}
        onDelete={triggerModal.trigger ? deleteTrigger : undefined}
        onClose={() => setTriggerModal(null)}
      />
    )}

    {/* Publish modal (kept — spec §4.1) */}
    {showPublishModal && (
      <PublishModal
        app={app}
        departments={departments}
        stations={stations}
        saving={saving}
        onClose={() => setShowPublishModal(false)}
        onPublish={handlePublish}
      />
    )}
    </>
  );
}

// ── Publish Modal ──────────────────────────────────────────────────────────────

function PublishModal({ app, departments, stations, saving, onClose, onPublish }: {
  app: App;
  departments: Department[];
  stations: Station[];
  saving: boolean;
  onClose: () => void;
  onPublish: (target: { department_id: string | null; station_id: string | null }) => void;
}) {
  const [departmentId, setDepartmentId] = useState<string>(app.department_id || '');
  const [stationId, setStationId] = useState<string>(app.station_id || '');

  const availableStations = departmentId
    ? stations.filter(s => s.department_id === departmentId)
    : stations;

  const handleDept = (deptId: string) => {
    setDepartmentId(deptId);
    if (deptId && stationId && !stations.some(s => s.id === stationId && s.department_id === deptId)) {
      setStationId('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(22, 35, 61, 0.45)' }}>
      <div className="bg-surface-1 rounded-card shadow-pop border border-border-subtle w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-grid">
          <div className="flex items-center gap-2">
            <Globe size={17} className="text-good" />
            <h2 className="text-ink" style={{ fontSize: 16, fontWeight: 750 }}>Publish App</h2>
          </div>
          <button onClick={onClose} className="wb-btn-ghost !min-h-0 p-1.5" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-muted" style={{ fontSize: 12.5 }}>
            Choose where to publish <span className="text-ink" style={{ fontWeight: 650 }}>{app.name}</span>. Operators at the selected
            department / workstation will see it. You can leave these blank to publish without a target.
          </p>
          <Field label="Department">
            <select className="wb-input" value={departmentId} onChange={e => handleDept(e.target.value)}>
              <option value="">— No department —</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Workstation">
            <select className="wb-input" value={stationId} onChange={e => setStationId(e.target.value)}>
              <option value="">— No workstation —</option>
              {availableStations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {departmentId && availableStations.length === 0 && (
              <p className="mt-1 flex items-center gap-1 text-warn-ink" style={{ fontSize: 11 }}>
                <MapPin size={11} /> No workstations in this department yet.
              </p>
            )}
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-grid">
          <button onClick={onClose} className="wb-btn">Cancel</button>
          <button
            onClick={() => onPublish({ department_id: departmentId || null, station_id: stationId || null })}
            disabled={saving}
            className="wb-btn-primary"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sortable widget card in the stacked-flow builder list ─────────────────────

function SortableWidgetCard({ widget, isSelected, onClick, onRemove }: {
  widget: Widget; isSelected: boolean; onClick: (e: React.MouseEvent) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const meta = WIDGET_META[widget.type];
  const Icon = meta?.icon;
  const authored = (widget.triggers ?? []).filter(t => !t.id.startsWith('legacy_')).length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`group flex items-start gap-2 p-3 rounded-ctrl border-2 cursor-pointer transition-all ${
        isSelected
          ? 'border-accent bg-accent-tint'
          : 'border-border-subtle hover:border-baseline bg-surface-2/60'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 p-0.5 text-baseline hover:text-muted cursor-grab active:cursor-grabbing flex-shrink-0"
        onClick={e => e.stopPropagation()}
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 text-muted" style={{ fontSize: 11.5 }}>
          {Icon && <Icon size={11} />}
          <span style={{ fontWeight: 550 }}>{meta?.label}</span>
          {widget.label && <span className="opacity-70">· {widget.label}</span>}
          {authored > 0 && <span className="trigger-pill" style={{ fontSize: 9.5, padding: '0 5px' }}>⚡ {authored}</span>}
        </div>
        <WidgetPreview widget={widget} />
      </div>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-baseline hover:text-bad transition-all flex-shrink-0"
        aria-label="Delete widget"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function WidgetPreview({ widget }: { widget: Widget }) {
  const { config } = widget;
  switch (widget.type) {
    case 'text':
      return <p className="text-sm text-ink-2 truncate">{config.text || '(empty text)'}</p>;
    case 'instruction':
      return <div className="text-xs text-ink-2 bg-blue-50 rounded px-2 py-1 truncate">{config.content || '(instructions)'}</div>;
    case 'button':
      return (
        <div className="inline-flex items-center gap-1 px-3 py-1 rounded text-white text-xs font-medium" style={{ backgroundColor: config.buttonColor || '#3b82f6' }}>
          {config.buttonText || 'Button'}
        </div>
      );
    case 'text-input':
    case 'number-input':
      return <div className="h-7 border border-border-subtle rounded px-2 flex items-center text-xs text-muted bg-surface-1">{config.placeholder || 'Input field'}</div>;
    case 'select-input':
      return <div className="h-7 border border-border-subtle rounded px-2 flex items-center text-xs text-muted bg-surface-1 justify-between">{config.options?.[0] || 'Select...'} <ChevronDown size={10} /></div>;
    case 'checkbox':
      return <div className="flex items-center gap-2 text-xs text-ink-2"><CheckSquare size={14} className="text-muted" />{widget.label || 'Checkbox'}</div>;
    case 'pass-fail':
      return <div className="flex gap-2"><span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">Pass</span><span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Fail</span></div>;
    case 'timer':
      return <div className="text-sm font-mono tnum text-ink-2">{formatDuration(config.duration || 0)}</div>;
    case 'counter':
      return <div className="flex items-center gap-2 text-sm"><span className="px-2 py-0.5 border border-border-subtle rounded text-muted">−</span><span className="font-mono tnum">{config.initialValue ?? 0}</span><span className="px-2 py-0.5 border border-border-subtle rounded text-muted">+</span></div>;
    case 'separator':
      return <div className="border-t border-border-subtle mt-1" />;
    case 'image':
      return config.imageUrl
        ? <img src={config.imageUrl} alt={config.imageAlt || ''} className="max-h-20 rounded border border-border-subtle object-contain bg-surface-2" />
        : <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted"><Image size={12} className="mr-1" />Image placeholder</div>;
    case 'signature':
      return <div className="h-12 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted"><PenTool size={12} className="mr-1" />Signature area</div>;
    case 'video':
      return <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted">Video{config.videoUrl ? ' ✓' : ''}</div>;
    case 'model-viewer':
      return <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted">3D model{config.modelUrl ? ' ✓' : ''}</div>;
    case 'variable-display':
      return <div className="inline-flex items-center gap-1 text-xs font-mono text-ink-2 bg-surface-1 border border-border-subtle rounded px-1.5 py-0.5">{config.variableRef ? `{{${config.variableRef}}}` : 'variable'}</div>;
    case 'table-lookup':
      return <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted">Table lookup</div>;
    case 'kit-checklist':
      return <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted">Kit checklist ({config.kitScope === 'step' ? 'this step' : 'whole kit'})</div>;
    case 'scan-input':
      return <div className="h-7 border border-border-subtle rounded px-2 flex items-center text-xs text-muted bg-surface-1 font-mono">{config.placeholder || 'Scan code…'}</div>;
    case 'photo-capture':
      return <div className="h-8 border border-dashed border-baseline rounded flex items-center justify-center text-xs text-muted">Photo capture ×{config.maxPhotos ?? 1}</div>;
    case 'shape':
      return (
        <div className="w-24" style={{ height: config.shapeKind === 'line' || config.shapeKind === 'arrow' ? 16 : 32, opacity: config.opacity ?? 1 }}>
          <ShapeSVG config={config} />
        </div>
      );
    default:
      return null;
  }
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
