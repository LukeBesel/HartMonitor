import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { App, Step, Widget, WidgetType, WidgetLayout, ProductType, Department, Station, PartItem } from '../types';
import {
  Save, Globe, ChevronLeft, Plus, Trash2, GripVertical,
  Type, AlignLeft, Image, MousePointer, TextCursor, Hash,
  List, CheckSquare, Timer, TrendingUp, CheckCheck, Minus,
  PenTool, Eye, Settings, X, ChevronDown, Loader2, Tag,
  LayoutGrid, Rows3, MoveUp, MoveDown, MapPin, AlertTriangle,
  AlignLeft as AlignLeftIcon, AlignCenter, AlignRight,
  Package, PlusCircle, Video, Box,
} from 'lucide-react';
import CanvasEditor from '../components/app/CanvasEditor';
import { defaultLayout, DEFAULT_CANVAS_H } from '../components/app/WidgetView';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { v4 as uuidv4 } from '../utils/uuid';
import { useAuth } from '../context/AuthContext';

// Widget palette items
const WIDGET_PALETTE: { type: WidgetType; icon: any; label: string; category: string }[] = [
  { type: 'text', icon: Type, label: 'Text', category: 'Display' },
  { type: 'instruction', icon: AlignLeft, label: 'Instruction', category: 'Display' },
  { type: 'image', icon: Image, label: 'Image', category: 'Display' },
  { type: 'video', icon: Video, label: 'Video', category: 'Display' },
  { type: 'model-viewer', icon: Box, label: '3D Model / CAD', category: 'Display' },
  { type: 'separator', icon: Minus, label: 'Separator', category: 'Display' },
  { type: 'button', icon: MousePointer, label: 'Button', category: 'Actions' },
  { type: 'text-input', icon: TextCursor, label: 'Text Input', category: 'Inputs' },
  { type: 'number-input', icon: Hash, label: 'Number Input', category: 'Inputs' },
  { type: 'select-input', icon: List, label: 'Dropdown', category: 'Inputs' },
  { type: 'checkbox', icon: CheckSquare, label: 'Checkbox', category: 'Inputs' },
  { type: 'timer', icon: Timer, label: 'Timer', category: 'Utilities' },
  { type: 'counter', icon: TrendingUp, label: 'Counter', category: 'Utilities' },
  { type: 'pass-fail', icon: CheckCheck, label: 'Pass / Fail', category: 'Quality' },
  { type: 'signature', icon: PenTool, label: 'Signature', category: 'Quality' },
];

const CATEGORIES = ['Display', 'Actions', 'Inputs', 'Utilities', 'Quality'];

function defaultWidget(type: WidgetType): Widget {
  const base = { id: uuidv4(), type, label: '', order: 0, config: {} };
  switch (type) {
    case 'text': return { ...base, label: '', config: { text: 'Enter text here', fontSize: 16, color: '#374151' } };
    case 'instruction': return { ...base, label: 'Instructions', config: { content: 'Step instructions go here...', backgroundColor: '#eff6ff' } };
    case 'button': return { ...base, label: '', config: { buttonText: 'Next', buttonType: 'next', buttonColor: '#3b82f6', buttonSize: 'md' } };
    case 'text-input': return { ...base, label: 'Text Field', config: { placeholder: 'Enter value...', required: false, variableName: `field_${Date.now()}` } };
    case 'number-input': return { ...base, label: 'Number Field', config: { placeholder: '0', required: false, variableName: `num_${Date.now()}` } };
    case 'select-input': return { ...base, label: 'Select Field', config: { options: ['Option 1', 'Option 2', 'Option 3'], variableName: `sel_${Date.now()}` } };
    case 'checkbox': return { ...base, label: 'Checkbox', config: { required: false, variableName: `check_${Date.now()}` } };
    case 'timer': return { ...base, label: 'Timer', config: { duration: 300, autoStart: false } };
    case 'counter': return { ...base, label: 'Counter', config: { min: 0, max: 100, step: 1, initialValue: 0, variableName: `counter_${Date.now()}` } };
    case 'pass-fail': return { ...base, label: 'Quality Check', config: { variableName: `qc_${Date.now()}` } };
    case 'separator': return { ...base, label: '', config: {} };
    case 'image': return { ...base, label: '', config: { imageUrl: '', imageAlt: '' } };
    case 'signature':     return { ...base, label: 'Signature', config: { variableName: `sig_${Date.now()}` } };
    case 'video':         return { ...base, label: 'Video', config: { videoType: 'youtube', videoUrl: '', videoControls: true, videoAutoplay: false } };
    case 'model-viewer':  return { ...base, label: '3D Model', config: { modelUrl: '', modelAlt: '3D Model', modelAutoRotate: true, modelShadowIntensity: 0.8, modelExposure: 1 } };
    default: return base;
  }
}

export default function AppBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { canEdit } = useAuth();
  const [app, setApp] = useState<App | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rightTab, setRightTab] = useState<'widget' | 'step'>('widget');
  const [showTypesModal, setShowTypesModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
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
    api.getApp(id).then(setApp).catch((err: any) => setLoadError(err.message || 'Failed to load app'));
    api.getProductTypes(id).then(setProductTypes).catch(() => {});
  }, [id]);

  useEffect(() => { loadApp(); }, [loadApp]);

  // Load departments/stations once for the "Publish to" selectors.
  useEffect(() => {
    api.getDepartments().then(setDepartments).catch(() => {});
    api.getStations().then(setStations).catch(() => {});
  }, []);

  const save = useCallback(async (appData: App): Promise<boolean> => {
    if (!id) return false;
    setSaving(true);
    try {
      await api.updateApp(id, {
        name: appData.name,
        description: appData.description,
        steps: appData.steps,
        department_id: appData.department_id ?? null,
        station_id: appData.station_id ?? null,
        show_takt_warnings: appData.show_takt_warnings ? 1 : 0,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err: any) {
      alert(err.message || 'Failed to save app');
      return false;
    } finally {
      setSaving(false);
    }
  }, [id]);

  const activeStep = app?.steps[activeStepIdx];
  const selectedWidget = activeStep?.widgets.find(w => w.id === selectedWidgetId) ?? null;

  const updateApp = (updater: (prev: App) => App) => {
    setApp(prev => {
      if (!prev) return prev;
      return updater(prev);
    });
  };

  const updateStep = (updater: (step: Step) => Step) => {
    updateApp(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === activeStepIdx ? updater(s) : s)
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

  // Move/resize/rotate a widget on the canvas.
  const updateWidgetLayout = (widgetId: string, layout: WidgetLayout) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w => w.id === widgetId ? { ...w, layout } : w),
    }));
  };

  // Bring a widget forward/back in the canvas stacking order.
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

  // Toggle a step between stacked-flow and free-form canvas. Switching to canvas
  // gives any unplaced widget a default stacked position so nothing disappears.
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
      widgets: step.widgets.filter(w => w.id !== widgetId).map((w, i) => ({ ...w, order: i }))
    }));
    if (selectedWidgetId === widgetId) setSelectedWidgetId(null);
  };

  const updateWidget = (widgetId: string, updates: Partial<Widget>) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w => w.id === widgetId ? { ...w, ...updates } : w)
    }));
  };

  const updateWidgetConfig = (widgetId: string, configUpdates: Record<string, any>) => {
    updateStep(step => ({
      ...step,
      widgets: step.widgets.map(w =>
        w.id === widgetId ? { ...w, config: { ...w.config, ...configUpdates } } : w
      )
    }));
  };

  const addStep = () => {
    if (!app) return;
    const newStep: Step = {
      id: uuidv4(),
      name: `Step ${app.steps.length + 1}`,
      order: app.steps.length,
      widgets: [],
      layoutMode: 'canvas',
      canvasHeight: DEFAULT_CANVAS_H,
      canvasBackground: '#ffffff',
    };
    updateApp(prev => ({ ...prev, steps: [...prev.steps, newStep] }));
    setActiveStepIdx(app.steps.length);
    setSelectedWidgetId(null);
  };

  const removeStep = (idx: number) => {
    if (!app || app.steps.length <= 1) return;
    updateApp(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i }))
    }));
    setActiveStepIdx(Math.max(0, activeStepIdx - 1));
    setSelectedWidgetId(null);
  };

  const handleWidgetDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeStep) return;
    const oldIdx = activeStep.widgets.findIndex(w => w.id === active.id);
    const newIdx = activeStep.widgets.findIndex(w => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    updateStep(step => ({
      ...step,
      widgets: arrayMove(step.widgets, oldIdx, newIdx).map((w, i) => ({ ...w, order: i }))
    }));
  };

  // Persist the publish target (department + station) and flip status to published.
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
    } catch (err: any) {
      alert(err.message || 'Failed to publish app');
    }
  };

  if (!app) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <AlertTriangle size={32} className="text-red-400 mb-3" />
          <p className="text-gray-600 font-medium">Couldn't load app</p>
          <p className="text-gray-400 text-sm mt-1">{loadError}</p>
          <button onClick={loadApp} className="btn-secondary mt-4">Retry</button>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-col h-screen bg-gray-100">
      {!canEdit && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-xs px-4 py-1.5 text-center">You have view-only access — changes can't be saved.</div>
      )}
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <Link to="/apps" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
          <ChevronLeft size={18} />
        </Link>
        <div className="flex-1 flex items-center gap-3">
          <input
            className="font-semibold text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 px-2 py-1 rounded focus:bg-gray-50 focus:ring-1 focus:ring-blue-200 w-64"
            value={app.name}
            onChange={e => updateApp(prev => ({ ...prev, name: e.target.value }))}
          />
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            app.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
          }`}>
            {app.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {app.status === 'published' && (
            <Link to={`/play/${app.id}`} target="_blank" className="btn-secondary text-xs">
              <Eye size={13} /> Preview
            </Link>
          )}
          <button
            onClick={() => setShowTypesModal(true)}
            className="btn-secondary text-xs"
          >
            <Tag size={13} /> Types {productTypes.length > 0 && <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full text-[10px] ml-0.5">{productTypes.length}</span>}
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="btn-secondary text-xs"
            title="App settings"
          >
            <Settings size={13} /> Settings
          </button>
          {canEdit && (
            <button
              onClick={() => save(app)}
              disabled={saving}
              className="btn-secondary text-xs"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saved ? 'Saved!' : 'Save'}
            </button>
          )}
          {canEdit && (
            <button onClick={() => setShowPublishModal(true)} className="btn-success text-xs">
              <Globe size={13} /> Publish
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Widget Palette */}
        <div className="w-52 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="p-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-1">Widgets</div>
            {CATEGORIES.map(cat => {
              const items = WIDGET_PALETTE.filter(w => w.category === cat);
              return (
                <div key={cat} className="mb-3">
                  <div className="text-xs text-gray-400 font-medium px-1 mb-1.5">{cat}</div>
                  <div className="space-y-1">
                    {items.map(({ type, icon: Icon, label }) => (
                      <button
                        key={type}
                        onClick={() => addWidget(type)}
                        disabled={!canEdit}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Icon size={14} className="flex-shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Steps + Canvas */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Step tabs */}
          <div className="bg-white border-b border-gray-200 flex items-center gap-1 px-3 py-2 overflow-x-auto flex-shrink-0">
            {app.steps.map((step, idx) => (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => { setActiveStepIdx(idx); setSelectedWidgetId(null); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    idx === activeStepIdx
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {idx + 1}. {step.name}
                </button>
                {canEdit && app.steps.length > 1 && (
                  <button
                    onClick={() => removeStep(idx)}
                    className="ml-0.5 p-0.5 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 opacity-0 hover:opacity-100 group-hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button
                onClick={addStep}
                className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 whitespace-nowrap"
              >
                <Plus size={12} /> Add Step
              </button>
            )}
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className={`mx-auto ${activeStep?.layoutMode === 'canvas' ? 'max-w-3xl' : 'max-w-2xl'}`}>
              {/* Step header */}
              <div className="mb-4 flex items-center gap-2">
                <div
                  className="cursor-pointer"
                  onClick={() => { setRightTab('step'); setSelectedWidgetId(null); }}
                >
                  <input
                    className="font-bold text-lg text-gray-800 bg-transparent border-none outline-none hover:bg-white px-2 py-1 rounded w-full focus:bg-white focus:ring-1 focus:ring-blue-200"
                    value={activeStep?.name ?? ''}
                    onChange={e => updateStep(s => ({ ...s, name: e.target.value }))}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  Step {activeStepIdx + 1} of {app.steps.length}
                </span>
              </div>

              {activeStep?.layoutMode === 'canvas' ? (
                /* ── Free-form canvas editor ── */
                <>
                  {activeStep.widgets.length === 0 && (
                    <div className="mb-3 text-center text-xs text-gray-400">
                      Add widgets from the left, then drag, resize, and rotate them anywhere on the canvas.
                    </div>
                  )}
                  <CanvasEditor
                    step={activeStep}
                    selectedId={selectedWidgetId}
                    onSelect={(wid) => { setSelectedWidgetId(wid); if (wid) setRightTab('widget'); }}
                    onChangeLayout={updateWidgetLayout}
                  />
                </>
              ) : (
                /* ── Stacked flow list ── */
                <div
                  className="bg-white rounded-xl border-2 border-dashed border-gray-200 min-h-64 p-4 space-y-2"
                  onClick={() => setSelectedWidgetId(null)}
                >
                  {(!activeStep || activeStep.widgets.length === 0) && (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-300">
                      <Plus size={32} className="mb-2" />
                      <p className="text-sm">Click widgets from the left panel to add them</p>
                    </div>
                  )}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleWidgetDragEnd}
                  >
                    <SortableContext
                      items={activeStep?.widgets.map(w => w.id) ?? []}
                      strategy={verticalListSortingStrategy}
                    >
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

        {/* Right: Properties */}
        <div className="w-64 bg-white border-l border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="border-b border-gray-200 flex">
            <button
              onClick={() => setRightTab('widget')}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                rightTab === 'widget' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Widget
            </button>
            <button
              onClick={() => setRightTab('step')}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                rightTab === 'step' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Step
            </button>
          </div>

          <div className="p-4">
            {rightTab === 'step' && activeStep && (
              <StepProperties step={activeStep} onUpdate={updater => updateStep(updater)} onSetMode={setStepMode} />
            )}
            {rightTab === 'widget' && selectedWidget ? (
              <WidgetProperties
                widget={selectedWidget}
                isCanvas={activeStep?.layoutMode === 'canvas'}
                onUpdate={(updates) => updateWidget(selectedWidget.id, updates)}
                onUpdateConfig={(cfg) => updateWidgetConfig(selectedWidget.id, cfg)}
                onUpdateLayout={(l) => updateWidgetLayout(selectedWidget.id, l)}
                onRestack={(dir) => restackWidget(selectedWidget.id, dir)}
                onRemove={() => removeWidget(selectedWidget.id)}
              />
            ) : rightTab === 'widget' && (
              <div className="text-center py-8 text-gray-400">
                <Settings size={24} className="mx-auto mb-2 opacity-40" />
                <p className="text-xs">Select a widget to edit its properties</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Product Types Modal */}
    {showTypesModal && app && (
      <ProductTypesModal
        app={app}
        productTypes={productTypes}
        onClose={() => setShowTypesModal(false)}
        onUpdate={setProductTypes}
      />
    )}

    {/* App Settings Modal */}
    {showSettingsModal && app && (
      <AppSettingsModal
        app={app}
        onClose={() => setShowSettingsModal(false)}
        onChange={updates => updateApp(prev => ({ ...prev, ...updates }))}
        onSave={() => { if (app) save(app); setShowSettingsModal(false); }}
      />
    )}

    {/* Publish Modal */}
    {showPublishModal && app && (
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

// ── App Settings Modal ─────────────────────────────────────────────────────────

function AppSettingsModal({ app, onClose, onChange, onSave }: {
  app: App;
  onClose: () => void;
  onChange: (updates: Partial<App>) => void;
  onSave: () => void;
}) {
  const showTakt = app.show_takt_warnings === undefined ? true : !!app.show_takt_warnings;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-gray-600" />
            <h2 className="text-lg font-bold text-gray-900">App Settings</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="App Name">
            <input className="input-field" value={app.name} onChange={e => onChange({ name: e.target.value })} />
          </Field>
          <Field label="Description">
            <textarea className="input-field resize-none text-xs" rows={2} value={app.description || ''}
              onChange={e => onChange({ description: e.target.value })} placeholder="Optional description..." />
          </Field>
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-gray-200 p-3 hover:bg-gray-50">
            <input
              type="checkbox"
              checked={showTakt}
              onChange={e => onChange({ show_takt_warnings: e.target.checked ? 1 : 0 })}
              className="mt-0.5 rounded"
            />
            <span className="flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                <AlertTriangle size={13} className="text-amber-500" /> Show takt-time warnings to operators
              </span>
              <span className="block text-xs text-gray-500 mt-0.5">
                When enabled, operators see a flashing alert when a step exceeds its takt time.
              </span>
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button onClick={onSave} className="btn-success text-xs"><Save size={13} /> Save Settings</button>
        </div>
      </div>
    </div>
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

  // Filter stations to the chosen department (fall back to all if none selected).
  const availableStations = departmentId
    ? stations.filter(s => s.department_id === departmentId)
    : stations;

  // If the currently selected station isn't in the chosen department, clear it.
  const handleDept = (deptId: string) => {
    setDepartmentId(deptId);
    if (deptId && stationId && !stations.some(s => s.id === stationId && s.department_id === deptId)) {
      setStationId('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-green-600" />
            <h2 className="text-lg font-bold text-gray-900">Publish App</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500">
            Choose where to publish <span className="font-medium text-gray-700">{app.name}</span>. Operators at the selected
            department / workstation will see it. You can leave these blank to publish without a target.
          </p>
          <Field label="Department">
            <select className="input-field" value={departmentId} onChange={e => handleDept(e.target.value)}>
              <option value="">— No department —</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Workstation">
            <select className="input-field" value={stationId} onChange={e => setStationId(e.target.value)}>
              <option value="">— No workstation —</option>
              {availableStations.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {departmentId && availableStations.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1">
                <MapPin size={11} /> No workstations in this department yet.
              </p>
            )}
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button
            onClick={() => onPublish({ department_id: departmentId || null, station_id: stationId || null })}
            disabled={saving}
            className="btn-success text-xs"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            Publish
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Product Types Modal ────────────────────────────────────────────────────────

function ProductTypesModal({ app, productTypes, onClose, onUpdate }: {
  app: App;
  productTypes: ProductType[];
  onClose: () => void;
  onUpdate: (pts: ProductType[]) => void;
}) {
  const [editing, setEditing] = useState<ProductType | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newOverrides, setNewOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const resetForm = () => { setEditing(null); setNewName(''); setNewDesc(''); setNewOverrides({}); };

  const startEdit = (pt: ProductType) => {
    setEditing(pt);
    setNewName(pt.name);
    setNewDesc(pt.description);
    const ov: Record<string, string> = {};
    for (const [k, v] of Object.entries(pt.takt_overrides)) ov[k] = String(v);
    setNewOverrides(ov);
  };

  const handleSave = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const overrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(newOverrides)) {
        if (v.trim()) overrides[k] = Number(v);
      }
      let updated: ProductType;
      if (editing) {
        updated = await api.updateProductType(editing.id, { name: newName.trim(), description: newDesc.trim(), takt_overrides: overrides });
        onUpdate(productTypes.map(p => p.id === editing.id ? updated : p));
      } else {
        const created = await api.createProductType({ app_id: app.id, name: newName.trim(), description: newDesc.trim(), takt_overrides: overrides });
        onUpdate([...productTypes, created]);
      }
      resetForm();
    } catch (err: any) {
      alert(err.message || 'Failed to save product type');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pt: ProductType) => {
    if (!confirm(`Delete product type "${pt.name}"?`)) return;
    try {
      await api.deleteProductType(pt.id);
      onUpdate(productTypes.filter(p => p.id !== pt.id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete product type');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Tag size={18} className="text-purple-600" />
            <h2 className="text-lg font-bold text-gray-900">Product Types</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <p className="text-xs text-gray-500">
            Define product types with per-step takt time overrides. Operators select a type when starting the app.
          </p>

          {/* Existing types */}
          {productTypes.length > 0 && (
            <div className="space-y-2">
              {productTypes.map(pt => (
                <div key={pt.id} className="border border-gray-200 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-sm">{pt.name}</div>
                    {pt.description && <div className="text-xs text-gray-500 truncate">{pt.description}</div>}
                    {Object.keys(pt.takt_overrides).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(pt.takt_overrides).map(([idx, secs]) => {
                          const stepName = app.steps[Number(idx)]?.name || `Step ${Number(idx) + 1}`;
                          return (
                            <span key={idx} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-1.5 py-0.5 rounded-full">
                              {stepName}: {Math.floor(Number(secs)/60)}m{Number(secs)%60 ? `${Number(secs)%60}s` : ''}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(pt)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 text-xs">Edit</button>
                    <button onClick={() => handleDelete(pt)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {editing ? `Editing: ${editing.name}` : 'Add Product Type'}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <input className="input-field" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Model A, Standard, Deluxe" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input className="input-field" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description" />
              </div>
            </div>
            {app.steps.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Takt Time Overrides (leave blank to use step default)</label>
                <div className="space-y-1.5">
                  {app.steps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-gray-600 w-32 flex-shrink-0 truncate">{idx+1}. {step.name}</span>
                      <input
                        type="number"
                        className="input-field flex-1 text-xs py-1.5"
                        placeholder={step.takt_time_seconds ? `Default: ${step.takt_time_seconds}s` : 'No default'}
                        value={newOverrides[idx] ?? ''}
                        onChange={e => setNewOverrides(prev => {
                          const next = { ...prev };
                          if (e.target.value) next[idx] = e.target.value;
                          else delete next[idx];
                          return next;
                        })}
                        min={0}
                      />
                      <span className="text-xs text-gray-400 flex-shrink-0">seconds</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={!newName.trim() || saving}
                className="btn-success text-xs"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                {editing ? 'Update Type' : 'Add Type'}
              </button>
              {editing && (
                <button onClick={resetForm} className="btn-secondary text-xs">Cancel</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sortable widget card in builder canvas
function SortableWidgetCard({ widget, isSelected, onClick, onRemove }: {
  widget: Widget; isSelected: boolean; onClick: (e: React.MouseEvent) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const palItem = WIDGET_PALETTE.find(p => p.type === widget.type);
  const Icon = palItem?.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={`group flex items-start gap-2 p-3 rounded-lg border-2 cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:border-gray-300 bg-gray-50'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-0.5 p-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
          {Icon && <Icon size={11} />}
          <span className="font-medium">{palItem?.label}</span>
          {widget.label && <span className="text-gray-400">· {widget.label}</span>}
        </div>
        <WidgetPreview widget={widget} />
      </div>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 transition-all flex-shrink-0"
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
      return <p className="text-sm text-gray-700 truncate">{config.text || '(empty text)'}</p>;
    case 'instruction':
      return <div className="text-xs text-gray-600 bg-blue-50 rounded px-2 py-1 truncate">{config.content || '(instructions)'}</div>;
    case 'button':
      return (
        <div className="inline-flex items-center gap-1 px-3 py-1 rounded text-white text-xs font-medium" style={{ backgroundColor: config.buttonColor || '#3b82f6' }}>
          {config.buttonText || 'Button'}
        </div>
      );
    case 'text-input':
    case 'number-input':
      return <div className="h-7 border border-gray-200 rounded px-2 flex items-center text-xs text-gray-400 bg-white">{config.placeholder || 'Input field'}</div>;
    case 'select-input':
      return <div className="h-7 border border-gray-200 rounded px-2 flex items-center text-xs text-gray-400 bg-white justify-between">{config.options?.[0] || 'Select...'} <ChevronDown size={10} /></div>;
    case 'checkbox':
      return <div className="flex items-center gap-2 text-xs text-gray-600"><CheckSquare size={14} className="text-gray-400" />{widget.label || 'Checkbox'}</div>;
    case 'pass-fail':
      return <div className="flex gap-2"><span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Pass</span><span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">Fail</span></div>;
    case 'timer':
      return <div className="text-sm font-mono text-gray-600">{formatDuration(config.duration || 0)}</div>;
    case 'counter':
      return <div className="flex items-center gap-2 text-sm"><span className="px-2 py-0.5 border border-gray-200 rounded text-gray-500">−</span><span className="font-mono">{config.initialValue ?? 0}</span><span className="px-2 py-0.5 border border-gray-200 rounded text-gray-500">+</span></div>;
    case 'separator':
      return <div className="border-t border-gray-200 mt-1" />;
    case 'image':
      return config.imageUrl
        ? <img src={config.imageUrl} alt={config.imageAlt || ''} className="max-h-20 rounded border border-gray-200 object-contain bg-gray-50" />
        : <div className="h-8 border border-dashed border-gray-200 rounded flex items-center justify-center text-xs text-gray-400"><Image size={12} className="mr-1" />Image placeholder</div>;
    case 'signature':
      return <div className="h-12 border border-dashed border-gray-200 rounded flex items-center justify-center text-xs text-gray-400"><PenTool size={12} className="mr-1" />Signature area</div>;
    default:
      return null;
  }
}

function WidgetProperties({ widget, isCanvas, onUpdate, onUpdateConfig, onUpdateLayout, onRestack, onRemove }: {
  widget: Widget;
  isCanvas?: boolean;
  onUpdate: (u: Partial<Widget>) => void;
  onUpdateConfig: (c: Record<string, any>) => void;
  onUpdateLayout?: (l: WidgetLayout) => void;
  onRestack?: (dir: 'front' | 'back') => void;
  onRemove?: () => void;
}) {
  const { config } = widget;
  const layout = widget.layout ?? defaultLayout(widget.type);
  const setLayout = (patch: Partial<WidgetLayout>) => onUpdateLayout?.({ ...layout, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {WIDGET_PALETTE.find(p => p.type === widget.type)?.label} Properties
        </div>
        {onRemove && (
          <button onClick={onRemove} title="Delete widget" className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Position / size / rotation — canvas mode only */}
      {isCanvas && onUpdateLayout && (
        <div className="space-y-2.5 pb-3 border-b border-gray-100">
          <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
            <LayoutGrid size={11} /> Layout
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="X" value={Math.round(layout.x)} onChange={v => setLayout({ x: v })} />
            <NumField label="Y" value={Math.round(layout.y)} onChange={v => setLayout({ y: v })} />
            <NumField label="Width" value={Math.round(layout.width)} onChange={v => setLayout({ width: Math.max(8, v) })} />
            <NumField label="Height" value={Math.round(layout.height)} onChange={v => setLayout({ height: Math.max(8, v) })} />
          </div>
          <NumField label="Rotation (°)" value={Math.round(layout.rotation ?? 0)} onChange={v => setLayout({ rotation: v })} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Opacity ({Math.round((config.opacity ?? 1) * 100)}%)</label>
            <input type="range" min={0} max={100} value={Math.round((config.opacity ?? 1) * 100)} onChange={e => onUpdateConfig({ opacity: Number(e.target.value) / 100 })} className="w-full" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => onRestack?.('front')} className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><MoveUp size={12} /> Front</button>
            <button onClick={() => onRestack?.('back')} className="flex-1 flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><MoveDown size={12} /> Back</button>
          </div>
        </div>
      )}

      {/* Label (for most widgets) */}
      {!['text', 'button', 'separator', 'image'].includes(widget.type) && (
        <Field label="Label">
          <input className="input-field" value={widget.label} onChange={e => onUpdate({ label: e.target.value })} />
        </Field>
      )}

      {/* Text widget */}
      {widget.type === 'text' && (
        <>
          <Field label="Text Content">
            <textarea className="input-field resize-none" rows={3} value={config.text || ''} onChange={e => onUpdateConfig({ text: e.target.value })} />
          </Field>
          <Field label="Font Size">
            <input type="number" className="input-field" value={config.fontSize || 16} onChange={e => onUpdateConfig({ fontSize: parseInt(e.target.value) })} />
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              <input type="color" className="w-10 h-9 rounded border border-gray-300 p-0.5 cursor-pointer" value={config.color || '#374151'} onChange={e => onUpdateConfig({ color: e.target.value })} />
              <input className="input-field flex-1" value={config.color || '#374151'} onChange={e => onUpdateConfig({ color: e.target.value })} />
            </div>
          </Field>
          <Field label="Font Weight">
            <select className="input-field" value={config.fontWeight || 'normal'} onChange={e => onUpdateConfig({ fontWeight: e.target.value })}>
              <option value="normal">Normal</option>
              <option value="semibold">Semibold</option>
              <option value="bold">Bold</option>
            </select>
          </Field>
          <Field label="Alignment">
            <div className="flex gap-1">
              {([['left', AlignLeftIcon], ['center', AlignCenter], ['right', AlignRight]] as const).map(([val, Ico]) => (
                <button key={val} onClick={() => onUpdateConfig({ textAlign: val })}
                  className={`flex-1 flex items-center justify-center py-1.5 rounded-lg border transition-colors ${(config.textAlign || 'left') === val ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  <Ico size={14} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Vertical Align">
            <select className="input-field" value={config.verticalAlign || 'top'} onChange={e => onUpdateConfig({ verticalAlign: e.target.value })}>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={config.fontStyle === 'italic'} onChange={e => onUpdateConfig({ fontStyle: e.target.checked ? 'italic' : 'normal' })} className="rounded" />
            <span className="text-sm text-gray-600">Italic</span>
          </label>
          {isCanvas && (
            <p className="text-[11px] text-gray-400">Tip: use the rotation handle on the canvas (or the Rotation field above) for diagonal text.</p>
          )}
        </>
      )}

      {/* Instruction */}
      {widget.type === 'instruction' && (
        <>
          <Field label="Content">
            <textarea className="input-field resize-none" rows={5} value={config.content || ''} onChange={e => onUpdateConfig({ content: e.target.value })} />
          </Field>
          <Field label="Background Color">
            <div className="flex gap-2">
              <input type="color" className="w-10 h-9 rounded border border-gray-300 p-0.5 cursor-pointer" value={config.backgroundColor || '#eff6ff'} onChange={e => onUpdateConfig({ backgroundColor: e.target.value })} />
              <input className="input-field flex-1" value={config.backgroundColor || '#eff6ff'} onChange={e => onUpdateConfig({ backgroundColor: e.target.value })} />
            </div>
          </Field>
        </>
      )}

      {/* Button */}
      {widget.type === 'button' && (
        <>
          <Field label="Button Text">
            <input className="input-field" value={config.buttonText || ''} onChange={e => onUpdateConfig({ buttonText: e.target.value })} />
          </Field>
          <Field label="Button Action">
            <select className="input-field" value={config.buttonType || 'next'} onChange={e => onUpdateConfig({ buttonType: e.target.value })}>
              <option value="next">Go to Next Step</option>
              <option value="prev">Go to Previous Step</option>
              <option value="complete">Complete App</option>
            </select>
          </Field>
          <Field label="Color">
            <div className="flex gap-2">
              <input type="color" className="w-10 h-9 rounded border border-gray-300 p-0.5 cursor-pointer" value={config.buttonColor || '#3b82f6'} onChange={e => onUpdateConfig({ buttonColor: e.target.value })} />
              <input className="input-field flex-1" value={config.buttonColor || '#3b82f6'} onChange={e => onUpdateConfig({ buttonColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Size">
            <select className="input-field" value={config.buttonSize || 'md'} onChange={e => onUpdateConfig({ buttonSize: e.target.value })}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </select>
          </Field>
        </>
      )}

      {/* Text/Number Input */}
      {(widget.type === 'text-input' || widget.type === 'number-input') && (
        <>
          <Field label="Placeholder">
            <input className="input-field" value={config.placeholder || ''} onChange={e => onUpdateConfig({ placeholder: e.target.value })} />
          </Field>
          <Field label="Variable Name">
            <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
          </Field>
          <Field label="Required">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!config.required} onChange={e => onUpdateConfig({ required: e.target.checked })} className="rounded" />
              <span className="text-sm text-gray-600">Required field</span>
            </label>
          </Field>
        </>
      )}

      {/* Select */}
      {widget.type === 'select-input' && (
        <>
          <Field label="Variable Name">
            <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
          </Field>
          <Field label="Options (one per line)">
            <textarea
              className="input-field resize-none font-mono text-xs"
              rows={5}
              value={(config.options || []).join('\n')}
              onChange={e => onUpdateConfig({ options: e.target.value.split('\n').filter(Boolean) })}
            />
          </Field>
          <Field label="Required">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!config.required} onChange={e => onUpdateConfig({ required: e.target.checked })} className="rounded" />
              <span className="text-sm text-gray-600">Required field</span>
            </label>
          </Field>
        </>
      )}

      {/* Checkbox */}
      {widget.type === 'checkbox' && (
        <>
          <Field label="Variable Name">
            <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
          </Field>
          <Field label="Required">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!config.required} onChange={e => onUpdateConfig({ required: e.target.checked })} className="rounded" />
              <span className="text-sm text-gray-600">Must be checked to proceed</span>
            </label>
          </Field>
        </>
      )}

      {/* Timer */}
      {widget.type === 'timer' && (
        <>
          <Field label="Duration (seconds)">
            <input type="number" className="input-field" value={config.duration || 60} onChange={e => onUpdateConfig({ duration: parseInt(e.target.value) })} />
          </Field>
          <Field label="Auto Start">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!config.autoStart} onChange={e => onUpdateConfig({ autoStart: e.target.checked })} className="rounded" />
              <span className="text-sm text-gray-600">Start automatically</span>
            </label>
          </Field>
        </>
      )}

      {/* Counter */}
      {widget.type === 'counter' && (
        <>
          <Field label="Variable Name">
            <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
          </Field>
          <Field label="Initial Value">
            <input type="number" className="input-field" value={config.initialValue ?? 0} onChange={e => onUpdateConfig({ initialValue: parseInt(e.target.value) })} />
          </Field>
          <Field label="Min">
            <input type="number" className="input-field" value={config.min ?? 0} onChange={e => onUpdateConfig({ min: parseInt(e.target.value) })} />
          </Field>
          <Field label="Max">
            <input type="number" className="input-field" value={config.max ?? 100} onChange={e => onUpdateConfig({ max: parseInt(e.target.value) })} />
          </Field>
          <Field label="Step">
            <input type="number" className="input-field" value={config.step ?? 1} onChange={e => onUpdateConfig({ step: parseInt(e.target.value) })} />
          </Field>
        </>
      )}

      {/* Pass/Fail */}
      {widget.type === 'pass-fail' && (
        <Field label="Variable Name">
          <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
        </Field>
      )}

      {/* Image */}
      {widget.type === 'image' && (
        <>
          <Field label="Image URL">
            <input className="input-field text-xs" value={config.imageUrl || ''} onChange={e => onUpdateConfig({ imageUrl: e.target.value })} placeholder="https://example.com/image.png" />
          </Field>
          <Field label="Upload from Device">
            <label className="flex items-center gap-2 cursor-pointer w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/30 text-xs text-gray-500 hover:text-blue-600 transition-colors">
              <Image size={13} />
              {config.imageUrl ? 'Replace image…' : 'Choose image file…'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    try {
                      const base64 = (ev.target?.result as string).split(',')[1];
                      const result = await api.uploadImage(base64, file.type, file.name);
                      onUpdateConfig({ imageUrl: result.url });
                    } catch {
                      // silently fail — user can paste URL manually
                    }
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {config.imageUrl && (
              <div className="mt-1.5">
                <img src={config.imageUrl} alt="" className="max-h-16 rounded border border-gray-200 object-contain" />
              </div>
            )}
          </Field>
          <Field label="Alt Text">
            <input className="input-field" value={config.imageAlt || ''} onChange={e => onUpdateConfig({ imageAlt: e.target.value })} />
          </Field>
          <Field label="Fit">
            <select className="input-field" value={config.imageFit || 'contain'} onChange={e => onUpdateConfig({ imageFit: e.target.value })}>
              <option value="contain">Contain (show whole image)</option>
              <option value="cover">Cover (fill, may crop)</option>
            </select>
          </Field>
        </>
      )}

      {/* Video */}
      {widget.type === 'video' && (
        <>
          <Field label="Video Type">
            <select className="input-field" value={config.videoType || 'youtube'} onChange={e => onUpdateConfig({ videoType: e.target.value, videoUrl: '' })}>
              <option value="youtube">YouTube / URL</option>
              <option value="upload">Upload Video File</option>
            </select>
          </Field>
          {config.videoType === 'upload' ? (
            <Field label="Upload Video">
              <label className="flex items-center gap-2 cursor-pointer w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50/30 text-xs text-gray-500 hover:text-blue-600 transition-colors">
                <Video size={13} />
                {config.videoUrl ? 'Replace video…' : 'Choose video file (.mp4, .webm, .mov)'}
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mov"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = async (ev) => {
                      try {
                        const base64 = (ev.target?.result as string).split(',')[1];
                        const result = await api.uploadImage(base64, file.type, file.name);
                        onUpdateConfig({ videoUrl: result.url, videoType: 'upload' });
                      } catch { /* silently fail */ }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {config.videoUrl && <p className="text-[11px] text-green-600 mt-1">✓ Video uploaded</p>}
            </Field>
          ) : (
            <Field label="YouTube URL or Video Link">
              <input
                className="input-field text-xs"
                value={config.videoUrl || ''}
                onChange={e => onUpdateConfig({ videoUrl: e.target.value })}
                placeholder="https://youtube.com/watch?v=... or https://..."
              />
              <p className="text-[11px] text-gray-400 mt-1">Paste a YouTube watch link, embed link, or any public video URL</p>
            </Field>
          )}
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!config.videoControls} onChange={e => onUpdateConfig({ videoControls: e.target.checked })} className="rounded" />
              Show controls
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!config.videoAutoplay} onChange={e => onUpdateConfig({ videoAutoplay: e.target.checked })} className="rounded" />
              Autoplay
            </label>
          </div>
        </>
      )}

      {/* 3D Model / CAD */}
      {widget.type === 'model-viewer' && (
        <>
          <Field label="Upload 3D Model">
            <label className="flex items-center gap-2 cursor-pointer w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/30 text-xs text-gray-500 hover:text-indigo-600 transition-colors">
              <Box size={13} />
              {config.modelUrl ? 'Replace model…' : 'Choose file (.glb, .gltf, .obj, .stl)'}
              <input
                type="file"
                accept=".glb,.gltf,.obj,.stl,.3mf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = async (ev) => {
                    try {
                      const base64 = (ev.target?.result as string).split(',')[1];
                      const result = await api.uploadImage(base64, file.type || 'application/octet-stream', file.name);
                      onUpdateConfig({ modelUrl: result.url });
                    } catch { /* silently fail */ }
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {config.modelUrl && (
              <p className="text-[11px] text-green-600 mt-1">✓ Model uploaded: {config.modelUrl.split('/').pop()}</p>
            )}
          </Field>
          <Field label="Model URL (alternative)">
            <input className="input-field text-xs" value={config.modelUrl || ''} onChange={e => onUpdateConfig({ modelUrl: e.target.value })} placeholder="https://... or /uploads/model.glb" />
          </Field>
          <Field label="Alt Text / Description">
            <input className="input-field" value={config.modelAlt || ''} onChange={e => onUpdateConfig({ modelAlt: e.target.value })} placeholder="e.g. Hydraulic pump assembly" />
          </Field>
          <div className="flex gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={!!config.modelAutoRotate} onChange={e => onUpdateConfig({ modelAutoRotate: e.target.checked })} className="rounded" />
              Auto-rotate
            </label>
          </div>
          <div className="text-[11px] text-gray-400 bg-indigo-50 rounded-lg px-2.5 py-1.5">
            Drag to rotate · Scroll to zoom · Supports .glb, .gltf, .obj, .stl
          </div>
        </>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type="number" className="input-field" value={value}
        onChange={e => onChange(e.target.value === '' ? 0 : parseInt(e.target.value))} />
    </div>
  );
}

function StepProperties({ step, onUpdate, onSetMode }: { step: Step; onUpdate: (u: (s: Step) => Step) => void; onSetMode: (m: 'flow' | 'canvas') => void }) {
  const isCanvas = step.layoutMode === 'canvas';
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step Properties</div>
      <Field label="Step Name">
        <input className="input-field" value={step.name} onChange={e => onUpdate(s => ({ ...s, name: e.target.value }))} />
      </Field>

      {/* Layout mode */}
      <Field label="Layout">
        <div className="flex gap-1.5">
          <button onClick={() => onSetMode('flow')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${!isCanvas ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <Rows3 size={13} /> Stacked
          </button>
          <button onClick={() => onSetMode('canvas')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium border transition-colors ${isCanvas ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <LayoutGrid size={13} /> Free-form
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          {isCanvas ? 'Drag, resize, and rotate widgets anywhere — like a slide.' : 'Widgets stack top-to-bottom automatically.'}
        </p>
      </Field>

      {isCanvas && (
        <>
          <Field label="Canvas Height (px)">
            <input type="number" className="input-field" min={200} step={20}
              value={step.canvasHeight ?? 560}
              onChange={e => onUpdate(s => ({ ...s, canvasHeight: Math.max(200, parseInt(e.target.value) || 560) }))} />
          </Field>
          <Field label="Background">
            <div className="flex gap-2">
              <input type="color" className="w-10 h-9 rounded border border-gray-300 p-0.5 cursor-pointer" value={step.canvasBackground || '#ffffff'} onChange={e => onUpdate(s => ({ ...s, canvasBackground: e.target.value }))} />
              <input className="input-field flex-1" value={step.canvasBackground || '#ffffff'} onChange={e => onUpdate(s => ({ ...s, canvasBackground: e.target.value }))} />
            </div>
          </Field>
        </>
      )}
      <Field label="Takt Time (seconds)">
        <div className="space-y-1">
          <input
            type="number"
            className="input-field"
            placeholder="0 = no limit"
            value={step.takt_time_seconds || ''}
            onChange={e => onUpdate(s => ({ ...s, takt_time_seconds: e.target.value ? parseInt(e.target.value) : undefined }))}
            min={0}
          />
          {step.takt_time_seconds ? (
            <div className="text-xs text-blue-600 font-medium">
              ⏱ {Math.floor(step.takt_time_seconds / 60)}m {step.takt_time_seconds % 60}s — operator sees alert if exceeded
            </div>
          ) : (
            <div className="text-xs text-gray-400">Set a takt time to show operators a flashing alert when exceeded</div>
          )}
        </div>
      </Field>
      <Field label="Step Description">
        <textarea className="input-field resize-none text-xs" rows={2}
          value={step.description || ''}
          placeholder="Optional notes for this step..."
          onChange={e => onUpdate(s => ({ ...s, description: e.target.value }))} />
      </Field>

      {/* Parts / Hardware List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
            <Package size={12} className="text-indigo-500" /> Parts &amp; Materials
          </label>
          <button
            onClick={() => onUpdate(s => ({
              ...s,
              parts_list: [...(s.parts_list || []), { name: '', quantity: 1, unit: 'ea' }]
            }))}
            className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <PlusCircle size={11} /> Add Part
          </button>
        </div>
        {(!step.parts_list || step.parts_list.length === 0) ? (
          <div className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            No parts added. Operators see a ⓘ button when parts are listed.
          </div>
        ) : (
          <div className="space-y-2">
            {step.parts_list.map((part, idx) => (
              <div key={idx} className="bg-gray-50 rounded-lg p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <input
                    className="input-field flex-1 text-xs"
                    placeholder="Part name"
                    value={part.name}
                    onChange={e => onUpdate(s => ({
                      ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, name: e.target.value } : p)
                    }))}
                  />
                  <button
                    onClick={() => onUpdate(s => ({ ...s, parts_list: s.parts_list!.filter((_, i) => i !== idx) }))}
                    className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500 flex-shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    className="input-field text-xs"
                    placeholder="SKU"
                    value={part.sku || ''}
                    onChange={e => onUpdate(s => ({
                      ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, sku: e.target.value } : p)
                    }))}
                  />
                  <input
                    type="number"
                    className="input-field text-xs"
                    placeholder="Qty"
                    min={0.001}
                    step={0.001}
                    value={part.quantity}
                    onChange={e => onUpdate(s => ({
                      ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, quantity: Number(e.target.value) } : p)
                    }))}
                  />
                  <input
                    className="input-field text-xs"
                    placeholder="Unit"
                    value={part.unit || ''}
                    onChange={e => onUpdate(s => ({
                      ...s, parts_list: s.parts_list!.map((p, i) => i === idx ? { ...p, unit: e.target.value } : p)
                    }))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        {step.widgets.length} widget{step.widgets.length !== 1 ? 's' : ''}
        {(step.parts_list?.length ?? 0) > 0 && ` · ${step.parts_list!.length} part${step.parts_list!.length !== 1 ? 's' : ''}`}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

