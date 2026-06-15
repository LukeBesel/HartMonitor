import { useState, useEffect } from 'react';
import {
  GitBranch, Plus, Trash2, Edit2, ChevronUp, ChevronDown, X,
  Check, AlertCircle, AppWindow, Users, Clock, ArrowRight, Star,
} from 'lucide-react';
import { api } from '../api/client';
import { usePlan } from '../context/PlanContext';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';

interface RoutingStep {
  id: string;
  routing_id: string;
  step_number: number;
  name: string;
  description: string;
  app_id: string | null;
  department_id: string | null;
  estimated_cycle_seconds: number;
  app_name?: string;
  department_name?: string;
}

interface Routing {
  id: string;
  name: string;
  description: string;
  step_count: number;
  steps?: RoutingStep[];
}

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

export default function Routings() {
  const { isFree } = usePlan();
  const [routings, setRoutings] = useState<Routing[]>([]);
  const [selected, setSelected] = useState<Routing | null>(null);
  const [loading, setLoading] = useState(true);
  const [apps, setApps] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Create routing modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Add step modal
  const [showAddStep, setShowAddStep] = useState(false);
  const [stepForm, setStepForm] = useState({ name: '', description: '', app_id: '', department_id: '', estimated_cycle_seconds: 0 });
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  const [savingStep, setSavingStep] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (isFree) return;
    Promise.all([
      api.getRoutings(),
      api.getApps(),
      api.getDepartments(),
    ]).then(([r, a, d]) => {
      setRoutings(r);
      setApps(a);
      setDepartments(d);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [isFree]);

  const loadRouting = async (id: string) => {
    try {
      const r = await api.getRouting(id);
      setSelected(r);
      setRoutings(prev => prev.map(x => x.id === id ? { ...x, step_count: r.steps?.length ?? 0 } : x));
    } catch {
      showToast('Failed to load routing', 'error');
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await api.createRouting({ name: newName.trim(), description: newDesc.trim() });
      setRoutings(prev => [...prev, { ...r, step_count: 0 }]);
      setSelected({ ...r, steps: [] });
      setNewName('');
      setNewDesc('');
      setShowCreate(false);
      showToast('Routing created');
    } catch {
      showToast('Failed to create routing', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteRouting = async (id: string) => {
    if (!confirm('Delete this routing? This cannot be undone.')) return;
    try {
      await api.deleteRouting(id);
      setRoutings(prev => prev.filter(r => r.id !== id));
      if (selected?.id === id) setSelected(null);
      showToast('Routing deleted');
    } catch {
      showToast('Failed to delete routing', 'error');
    }
  };

  const openAddStep = (step?: RoutingStep) => {
    if (step) {
      setEditingStepId(step.id);
      setStepForm({
        name: step.name,
        description: step.description,
        app_id: step.app_id ?? '',
        department_id: step.department_id ?? '',
        estimated_cycle_seconds: step.estimated_cycle_seconds,
      });
    } else {
      setEditingStepId(null);
      setStepForm({ name: '', description: '', app_id: '', department_id: '', estimated_cycle_seconds: 0 });
    }
    setShowAddStep(true);
  };

  const handleSaveStep = async () => {
    if (!selected || !stepForm.name.trim()) return;
    setSavingStep(true);
    const payload = {
      name: stepForm.name.trim(),
      description: stepForm.description.trim(),
      app_id: stepForm.app_id || null,
      department_id: stepForm.department_id || null,
      estimated_cycle_seconds: Number(stepForm.estimated_cycle_seconds) || 0,
    };
    try {
      if (editingStepId) {
        await api.updateRoutingStep(selected.id, editingStepId, payload);
      } else {
        await api.createRoutingStep(selected.id, payload);
      }
      await loadRouting(selected.id);
      setShowAddStep(false);
      showToast(editingStepId ? 'Step updated' : 'Step added');
    } catch {
      showToast('Failed to save step', 'error');
    } finally {
      setSavingStep(false);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!selected) return;
    try {
      await api.deleteRoutingStep(selected.id, stepId);
      await loadRouting(selected.id);
      showToast('Step removed');
    } catch {
      showToast('Failed to remove step', 'error');
    }
  };

  const handleMoveStep = async (stepId: string, dir: 'up' | 'down') => {
    if (!selected?.steps) return;
    const steps = [...selected.steps].sort((a, b) => a.step_number - b.step_number);
    const idx = steps.findIndex(s => s.id === stepId);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= steps.length) return;

    const reordered = steps.map((s, i) => {
      if (i === idx) return { id: s.id, step_number: steps[swapIdx].step_number };
      if (i === swapIdx) return { id: s.id, step_number: steps[idx].step_number };
      return { id: s.id, step_number: s.step_number };
    });

    try {
      await api.reorderRoutingSteps(selected.id, reordered);
      await loadRouting(selected.id);
    } catch {
      showToast('Failed to reorder steps', 'error');
    }
  };

  const formatCycleTime = (secs: number) => {
    if (!secs) return null;
    if (secs < 60) return `${secs}s`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  };

  if (isFree) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <GitBranch size={28} className="text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Product Routings</h1>
        <p className="text-gray-500 text-sm mb-6">
          Define step-by-step manufacturing sequences. Assign apps, departments, and cycle times to each step — even before the app exists.
        </p>
        <div className="inline-flex items-center gap-2 bg-amber-500 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">
          <Star size={15} />
          Upgrade to Pro to use Routings
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading routings…</div>;
  }

  const sortedSteps = selected?.steps ? [...selected.steps].sort((a, b) => a.step_number - b.step_number) : [];

  return (
    <div className="flex h-full overflow-hidden">
      <ModuleOnboarding
        moduleId="routings"
        title="Product Routings"
        description="A routing is a sequence of manufacturing steps. Define the flow once, assign apps and departments to each step, and reuse it across work orders."
        steps={[
          "Create a routing with a name and description",
          "Add ordered steps, each optionally linked to an app",
          "Set estimated cycle time per step for OEE planning",
          "Reorder steps with the arrows as your process evolves",
        ]}
        icon={GitBranch}
        color="#7c3aed"
      />
      {/* Left panel — routing list */}
      <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <GitBranch size={16} className="text-blue-500" />
              Routings
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">{routings.length} routing{routings.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {routings.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm px-4">
              <GitBranch size={28} className="mx-auto mb-2 opacity-30" />
              No routings yet. Create one to define a manufacturing sequence.
            </div>
          )}
          {routings.map(r => (
            <div
              key={r.id}
              onClick={() => loadRouting(r.id)}
              className={`flex items-start justify-between p-3 rounded-xl cursor-pointer transition-all group ${
                selected?.id === r.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{r.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{r.step_count} step{r.step_count !== 1 ? 's' : ''}</div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); handleDeleteRouting(r.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all ml-2 flex-shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — steps */}
      <div className="flex-1 overflow-y-auto bg-gray-50">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 px-8">
            <GitBranch size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Select a routing to view and edit its steps</p>
          </div>
        ) : (
          <div className="p-6 max-w-2xl">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                {selected.description && <p className="text-sm text-gray-500 mt-0.5">{selected.description}</p>}
              </div>
              <button
                onClick={() => openAddStep()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors flex-shrink-0"
              >
                <Plus size={14} />
                Add Step
              </button>
            </div>

            {sortedSteps.length === 0 ? (
              <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-gray-200">
                <ArrowRight size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400 mb-3">No steps yet. Add your first manufacturing step.</p>
                <button
                  onClick={() => openAddStep()}
                  className="text-sm font-semibold text-blue-500 hover:text-blue-600"
                >
                  + Add first step
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedSteps.map((step, i) => (
                  <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4">
                    {/* Step number */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
                        {step.step_number}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => handleMoveStep(step.id, 'up')}
                          disabled={i === 0}
                          className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          onClick={() => handleMoveStep(step.id, 'down')}
                          disabled={i === sortedSteps.length - 1}
                          className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{step.name}</div>
                          {step.description && <div className="text-xs text-gray-500 mt-0.5">{step.description}</div>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => openAddStep(step)}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteStep(step.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {step.app_name ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            <AppWindow size={10} />
                            {step.app_name}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            <AppWindow size={10} />
                            No app (placeholder)
                          </span>
                        )}
                        {step.department_name && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            <Users size={10} />
                            {step.department_name}
                          </span>
                        )}
                        {step.estimated_cycle_seconds > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            <Clock size={10} />
                            {formatCycleTime(step.estimated_cycle_seconds)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create routing modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-gray-900">New Routing</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Name *</label>
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Machined Part Flow"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description</label>
                <textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={2}
                  placeholder="Optional description…"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit step modal */}
      {showAddStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-gray-900">{editingStepId ? 'Edit Step' : 'Add Step'}</h3>
              <button onClick={() => setShowAddStep(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Step Name *</label>
                <input
                  autoFocus
                  value={stepForm.name}
                  onChange={e => setStepForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. CNC Machining"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Description</label>
                <input
                  value={stepForm.description}
                  onChange={e => setStepForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional notes…"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                  App <span className="font-normal text-gray-400">(optional — can be a placeholder step)</span>
                </label>
                <select
                  value={stepForm.app_id}
                  onChange={e => setStepForm(f => ({ ...f, app_id: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
                >
                  <option value="">No app (placeholder step)</option>
                  {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Department <span className="font-normal text-gray-400">(optional)</span></label>
                <select
                  value={stepForm.department_id}
                  onChange={e => setStepForm(f => ({ ...f, department_id: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
                >
                  <option value="">No department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1.5">Estimated Cycle Time (seconds)</label>
                <input
                  type="number"
                  min={0}
                  value={stepForm.estimated_cycle_seconds || ''}
                  onChange={e => setStepForm(f => ({ ...f, estimated_cycle_seconds: Number(e.target.value) }))}
                  placeholder="e.g. 120"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
                <p className="text-[11px] text-gray-400 mt-1">Enter 120 for 2 minutes. Leave blank if unknown.</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowAddStep(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                onClick={handleSaveStep}
                disabled={savingStep || !stepForm.name.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {savingStep ? 'Saving…' : editingStepId ? 'Update Step' : 'Add Step'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
