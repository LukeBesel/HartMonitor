import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  GitBranch, Plus, Trash2, Edit2, ChevronUp, ChevronDown, X,
  Check, AlertCircle, AppWindow, Users, Clock, ArrowRight, Star, ChevronLeft,
  Play, Package,
} from 'lucide-react';
import { api } from '../api/client';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import { fmtDuration } from '../components/apps/appModel';
import { getRoutingUsage, type RoutingUsage } from '../api/operations';

interface RoutingStep {
  id: string;
  routing_id: string;
  step_number: number;
  name: string;
  description: string;
  app_id: string | null;
  department_id: string | null;
  estimated_cycle_seconds: number;
  /** The same number the server also answers as `standard_seconds` — the word a
   *  released operation uses. One value, two names, no second column. */
  standard_seconds?: number;
  station_id?: string | null;
  app_name?: string;
  department_name?: string;
  station_name?: string | null;
}

interface Routing {
  id: string;
  name: string;
  description: string;
  step_count: number;
  /** Work orders released against this routing that are still open. This is
   *  what makes the screen true: a routing is a plan until something runs on
   *  it, and until now the page never said whether anything did. */
  open_work_orders?: number;
  steps?: RoutingStep[];
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  return (
    <div className={`fixed bottom-40 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
      {type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

export default function Routings() {
  const { isFree } = usePlan();
  const { canEdit } = useAuth();
  const [routings, setRoutings] = useState<Routing[]>([]);
  const [selected, setSelected] = useState<Routing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [usage, setUsage] = useState<RoutingUsage | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // A routing itself has no department — the department lives on each step
  // (routing_steps.department_id), so this narrows the step list of whichever
  // routing is open, not the routing list on the left. It also supplies the
  // department options for the step form, so the page has one department list.
  const deptFilter = useDepartmentFilter('routings');
  const departments = deptFilter.departments;

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

  // The department filter is page-wide: it narrows the routing LIST server-side
  // (routings with a step in that department) and the open routing's step list.
  const loadAll = () => {
    setLoading(true);
    setLoadError(null);
    const deptId = deptFilter.departmentId;
    Promise.all([
      api.getRoutings(deptId ? { department_id: deptId } : undefined),
      api.getApps(),
    ]).then(([r, a]) => {
      setRoutings(Array.isArray(r) ? r : []);
      setApps(Array.isArray(a) ? a : []);
    }).catch((err: any) => {
      setLoadError(err?.message || 'Failed to load routings');
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    if (isFree) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFree]);

  // Quietly re-fetch just the list when the department filter changes (after the
  // initial load) — no full-page skeleton, so the picker the user just used stays
  // on screen. The mount guard keeps this from double-fetching alongside loadAll.
  const lastDeptRef = useRef(deptFilter.departmentId);
  useEffect(() => {
    if (isFree) return;
    if (lastDeptRef.current === deptFilter.departmentId) return;
    lastDeptRef.current = deptFilter.departmentId;
    const deptId = deptFilter.departmentId;
    let cancelled = false;
    api.getRoutings(deptId ? { department_id: deptId } : undefined)
      .then(r => { if (!cancelled) setRoutings(Array.isArray(r) ? r : []); })
      .catch(() => { /* keep the current list on a transient error */ });
    return () => { cancelled = true; };
  }, [isFree, deptFilter.departmentId]);

  const loadRouting = async (id: string) => {
    try {
      const r = await api.getRouting(id);
      setSelected(r);
      setRoutings(prev => prev.map(x => x.id === id ? { ...x, step_count: r.steps?.length ?? 0 } : x));
    } catch {
      showToast('Failed to load routing', 'error');
      return;
    }
    // Which live jobs run on this routing. Loaded separately so a failure here
    // never costs the planner the steps they came to edit.
    setUsage(null);
    try {
      const u = await getRoutingUsage(id);
      setUsage(u);
      setRoutings(prev => prev.map(x => x.id === id ? { ...x, open_work_orders: u.open_work_orders } : x));
    } catch {
      setUsage(null);
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
    return (
      <div className="p-6 space-y-3 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-6">
        <AlertCircle size={28} className="text-red-500" />
        <p className="text-gray-500 font-medium">Couldn't load routings</p>
        <p className="text-xs text-gray-400">{loadError}</p>
        <button onClick={loadAll} className="btn-secondary">Retry</button>
      </div>
    );
  }

  const sortedSteps = selected?.steps ? [...selected.steps].sort((a, b) => a.step_number - b.step_number) : [];
  // Step numbers are kept as-is so a filtered sequence still reads as part of
  // the whole routing ("we do steps 3 and 7") rather than being renumbered.
  const visibleSteps = sortedSteps.filter(deptFilter.matches);
  // A remembered department id filters correctly from the first render, but its
  // name only arrives with the departments fetch — so copy that would otherwise
  // read "No steps in undefined" falls back to a generic phrase for that beat.
  const deptName = deptFilter.selected?.name ?? 'this department';

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
      {/* Left panel — routing list.
          Two 288px-wide panes side by side leave a phone about a hundred pixels
          for the steps, so below lg the list and the steps take turns owning the
          screen: opening a routing swaps to its steps, and the Back button in
          the steps header brings the list back. */}
      <div className={`w-full lg:w-72 lg:flex-shrink-0 border-r border-gray-200 bg-white flex-col ${selected ? 'hidden lg:flex' : 'flex'}`}>
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <GitBranch size={16} className="text-blue-500" />
                Routings
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">{routings.length} routing{routings.length !== 1 ? 's' : ''}</p>
            </div>
            {canEdit && (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold transition-colors"
              >
                <Plus size={13} />
                New
              </button>
            )}
          </div>
          {/* Page-wide department filter — narrows the list (server-side) to
              routings with a step in the chosen department. */}
          {departments.length > 0 && (
            <div className="mt-3">
              <DepartmentFilter
                filter={deptFilter}
                matchCount={routings.length}
                matchNoun={`routing${routings.length !== 1 ? 's' : ''}`}
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {routings.length === 0 && deptFilter.active && (
            <div className="text-center py-10 px-4">
              <GitBranch size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-500 font-medium">No routings in {deptFilter.selected?.name ?? 'this department'}</p>
              <p className="text-xs text-gray-400 mt-1">No routing has a step in this department.</p>
              <button
                onClick={deptFilter.clear}
                className="mt-3 text-sm font-semibold text-blue-500 hover:text-blue-600"
              >
                Show all departments
              </button>
            </div>
          )}
          {routings.length === 0 && !deptFilter.active && (
            <div className="text-center py-10 px-4">
              <GitBranch size={28} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm text-gray-500 font-medium">No routings yet</p>
              <p className="text-xs text-gray-400 mt-1">Create one to define a manufacturing sequence.</p>
              {canEdit && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-3 text-sm font-semibold text-blue-500 hover:text-blue-600"
                >
                  + New routing
                </button>
              )}
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
                {/* A routing nothing runs on gets an em dash and a reason, not
                    "used by 0 work orders" dressed up as a measurement. */}
                <div className="text-xs mt-0.5">
                  {r.open_work_orders && r.open_work_orders > 0 ? (
                    <span className="text-emerald-700 font-medium">
                      used by {r.open_work_orders} open work order{r.open_work_orders !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-gray-400" title="No open work order has been released on this routing">
                      — no open work orders
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteRouting(r.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all ml-2 flex-shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — steps */}
      <div className={`flex-1 overflow-y-auto bg-gray-50 ${selected ? 'block' : 'hidden lg:block'}`}>
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 px-8">
            <GitBranch size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Select a routing to view and edit its steps</p>
          </div>
        ) : (
          <div className="p-4 sm:p-6 max-w-2xl">
            <button
              onClick={() => setSelected(null)}
              className="lg:hidden inline-flex items-center gap-1.5 mb-4 -ml-1 px-2 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              <ChevronLeft size={16} /> All routings
            </button>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900">{selected.name}</h2>
                {selected.description && <p className="text-sm text-gray-500 mt-0.5">{selected.description}</p>}
              </div>
              <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
                {/* The one action that turns a routing into work. It lands on
                    the Schedule's create form with this routing already picked,
                    because "release a job" is a work-order action and the
                    Routings screen has no business owning a second one. */}
                {canEdit && (
                  <Link
                    to={`/schedule?routing_id=${encodeURIComponent(selected.id)}`}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold transition-colors flex-shrink-0"
                  >
                    <Play size={13} />
                    Release a job on this routing
                  </Link>
                )}
                {/* Steps are narrowed by the page-wide department picker in the
                    routing-list header; the count and empty states below reflect it. */}
                {deptFilter.active && (
                  <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                    {visibleSteps.length} of {sortedSteps.length} step{sortedSteps.length !== 1 ? 's' : ''}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => openAddStep()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold transition-colors flex-shrink-0"
                  >
                    <Plus size={14} />
                    Add Step
                  </button>
                )}
              </div>
            </div>

            {/* What actually runs on this routing today. The Routings screen
                used to describe a sequence and never say whether anything was
                following it — an execution model with no evidence. */}
            <div className="mb-5 bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                <Package size={12} />
                Live jobs
              </div>
              {usage === null ? (
                <p className="text-xs text-gray-400">—<span className="ml-1.5">job list unavailable</span></p>
              ) : usage.open_work_orders === 0 ? (
                <p className="text-xs text-gray-400">
                  —<span className="ml-1.5">no open work order has been released on this routing</span>
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {usage.work_orders.map(wo => (
                    <li key={wo.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <Link
                        to={`/schedule?highlight=${wo.id}`}
                        className="font-mono font-semibold text-blue-700 hover:text-blue-800"
                      >
                        {wo.work_order_number}
                      </Link>
                      <span className="text-gray-600">{wo.part_name || wo.part_number || '—'}</span>
                      {wo.current_operation ? (
                        <span className="text-gray-500 [font-variant-numeric:tabular-nums]">
                          op {wo.current_operation.sequence} of {wo.current_operation.of} · {wo.current_operation.name}
                          {' · '}{wo.current_operation.qty_good}/{wo.current_operation.qty_required}
                        </span>
                      ) : (
                        <span className="text-gray-400">— not released</span>
                      )}
                      {wo.hold_reason && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                          on hold: {wo.hold_reason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {sortedSteps.length === 0 ? (
              <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-gray-200">
                <ArrowRight size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-400 mb-3">No steps yet. Add your first manufacturing step.</p>
                {canEdit && (
                  <button
                    onClick={() => openAddStep()}
                    className="text-sm font-semibold text-blue-500 hover:text-blue-600"
                  >
                    + Add first step
                  </button>
                )}
              </div>
            ) : visibleSteps.length === 0 ? (
              /* The routing has steps, just none in the chosen department —
                 which is a fact about the routing, not an empty routing. */
              <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-gray-200">
                <Users size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-sm text-gray-500 font-medium">
                  No steps in {deptName}
                </p>
                <p className="text-xs text-gray-400 mt-1 mb-3">
                  This routing's {sortedSteps.length} step{sortedSteps.length !== 1 ? 's' : ''} run through other departments.
                </p>
                <button
                  onClick={deptFilter.clear}
                  className="text-sm font-semibold text-blue-500 hover:text-blue-600"
                >
                  Show all departments
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {deptFilter.active && (
                  <p className="text-xs text-gray-400">
                    Showing {visibleSteps.length} of {sortedSteps.length} step{sortedSteps.length !== 1 ? 's' : ''} in {deptName}.
                    {canEdit && ' Clear the department filter to reorder steps.'}
                  </p>
                )}
                {visibleSteps.map((step, i) => (
                  <div key={step.id} className="bg-white rounded-xl border border-gray-200 p-4 flex gap-4">
                    {/* Step number */}
                    <div className="flex-shrink-0 flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
                        {step.step_number}
                      </div>
                      {/* Reordering is hidden while a department is selected:
                          the neighbours a step would swap with are off-screen,
                          so the arrows would look like they did nothing. */}
                      {canEdit && !deptFilter.active && (
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
                            disabled={i === visibleSteps.length - 1}
                            className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{step.name}</div>
                          {step.description && <div className="text-xs text-gray-500 mt-0.5">{step.description}</div>}
                        </div>
                        {canEdit && (
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
                        )}
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
                            {fmtDuration(step.estimated_cycle_seconds)}
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
