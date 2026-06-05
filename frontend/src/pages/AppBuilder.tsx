import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { App, Step, Widget, WidgetType, ProductType } from '../types';
import {
  Save, Globe, ChevronLeft, Plus, Trash2, GripVertical,
  Type, AlignLeft, Image, MousePointer, TextCursor, Hash,
  List, CheckSquare, Timer, TrendingUp, CheckCheck, Minus,
  PenTool, Eye, Settings, X, ChevronDown, Loader2, Tag
} from 'lucide-react';
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

// Widget palette items
const WIDGET_PALETTE: { type: WidgetType; icon: any; label: string; category: string }[] = [
  { type: 'text', icon: Type, label: 'Text', category: 'Display' },
  { type: 'instruction', icon: AlignLeft, label: 'Instruction', category: 'Display' },
  { type: 'image', icon: Image, label: 'Image', category: 'Display' },
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
    case 'signature': return { ...base, label: 'Signature', config: { variableName: `sig_${Date.now()}` } };
    default: return base;
  }
}

export default function AppBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<App | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rightTab, setRightTab] = useState<'widget' | 'step'>('widget');
  const [showTypesModal, setShowTypesModal] = useState(false);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (id) {
      api.getApp(id).then(setApp);
      api.getProductTypes(id).then(setProductTypes);
    }
  }, [id]);

  const save = useCallback(async (appData: App) => {
    if (!id) return;
    setSaving(true);
    try {
      await api.updateApp(id, { name: appData.name, description: appData.description, steps: appData.steps });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
    updateStep(step => ({
      ...step,
      widgets: [...step.widgets, { ...widget, order: step.widgets.length }]
    }));
    setSelectedWidgetId(widget.id);
    setRightTab('widget');
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
      widgets: []
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

  const handlePublish = async () => {
    if (!id || !app) return;
    await save(app);
    await api.publishApp(id);
    setApp(prev => prev ? { ...prev, status: 'published' } : prev);
  };

  if (!app) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <>
    <div className="flex flex-col h-screen bg-gray-100">
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
            onClick={() => save(app)}
            disabled={saving}
            className="btn-secondary text-xs"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saved ? 'Saved!' : 'Save'}
          </button>
          <button onClick={handlePublish} className="btn-success text-xs">
            <Globe size={13} /> Publish
          </button>
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
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors text-left"
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
                {app.steps.length > 1 && (
                  <button
                    onClick={() => removeStep(idx)}
                    className="ml-0.5 p-0.5 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 opacity-0 hover:opacity-100 group-hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addStep}
              className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 whitespace-nowrap"
            >
              <Plus size={12} /> Add Step
            </button>
          </div>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto">
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

              {/* Widget canvas */}
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
              <StepProperties step={activeStep} onUpdate={updater => updateStep(updater)} />
            )}
            {rightTab === 'widget' && selectedWidget ? (
              <WidgetProperties
                widget={selectedWidget}
                onUpdate={(updates) => updateWidget(selectedWidget.id, updates)}
                onUpdateConfig={(cfg) => updateWidgetConfig(selectedWidget.id, cfg)}
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
    </>
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
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pt: ProductType) => {
    if (!confirm(`Delete product type "${pt.name}"?`)) return;
    await api.deleteProductType(pt.id);
    onUpdate(productTypes.filter(p => p.id !== pt.id));
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
      return <div className="h-8 border border-dashed border-gray-200 rounded flex items-center justify-center text-xs text-gray-400"><Image size={12} className="mr-1" />Image placeholder</div>;
    case 'signature':
      return <div className="h-12 border border-dashed border-gray-200 rounded flex items-center justify-center text-xs text-gray-400"><PenTool size={12} className="mr-1" />Signature area</div>;
    default:
      return null;
  }
}

function WidgetProperties({ widget, onUpdate, onUpdateConfig }: {
  widget: Widget;
  onUpdate: (u: Partial<Widget>) => void;
  onUpdateConfig: (c: Record<string, any>) => void;
}) {
  const { config } = widget;

  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {WIDGET_PALETTE.find(p => p.type === widget.type)?.label} Properties
      </div>

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
        </>
      )}

      {/* Checkbox */}
      {widget.type === 'checkbox' && (
        <Field label="Variable Name">
          <input className="input-field font-mono text-xs" value={config.variableName || ''} onChange={e => onUpdateConfig({ variableName: e.target.value })} />
        </Field>
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
            <input className="input-field text-xs" value={config.imageUrl || ''} onChange={e => onUpdateConfig({ imageUrl: e.target.value })} placeholder="https://..." />
          </Field>
          <Field label="Alt Text">
            <input className="input-field" value={config.imageAlt || ''} onChange={e => onUpdateConfig({ imageAlt: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

function StepProperties({ step, onUpdate }: { step: Step; onUpdate: (u: (s: Step) => Step) => void }) {
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Step Properties</div>
      <Field label="Step Name">
        <input className="input-field" value={step.name} onChange={e => onUpdate(s => ({ ...s, name: e.target.value }))} />
      </Field>
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
      <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        {step.widgets.length} widget{step.widgets.length !== 1 ? 's' : ''}
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

