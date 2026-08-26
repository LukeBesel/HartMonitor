import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  FolderKanban, Plus, Search, X, ChevronRight, ArrowLeft, Lightbulb,
  Calendar, User, Building2, DollarSign, Trash2, Edit3, AlertTriangle,
  CheckCircle2, Link2, ListChecks,
} from 'lucide-react';
import { api } from '../api/client';
import type {
  CIProject, CIProjectStatus, CIProjectSummary, CIProjectTask, CITaskStatus,
} from '../types';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import LastRefreshed from '../components/shared/LastRefreshed';
import PageHeader from '../components/shared/PageHeader';
import GanttChart, { TASK_VISUALS, taskVisual } from '../components/ci/GanttChart';
import { rollupProgress } from '../utils/gantt';

// ─── CI Projects ──────────────────────────────────────────────────────────────
// The execution half of the Kaizen / CI workspace: an idea is where improvement
// work starts, a project is where it gets planned, scheduled and closed out.
//
// STATUS_CONFIG's keys are EXACTLY the CHECK constraint on ci_projects.status,
// and TASK_VISUALS' keys are exactly the one on ci_project_tasks.status. Human
// labels live in the value, never in the key: a page that offers a word the
// column forbids saves with a 500, and one that writes 'in-progress' while
// reading 'in_progress' creates rows it can never find again.

const STATUS_CONFIG: Record<CIProjectStatus, { label: string; color: string; bg: string; ring: string }> = {
  planning:  { label: 'Planning',  color: 'text-gray-700',    bg: 'bg-gray-100',    ring: 'ring-gray-200' },
  active:    { label: 'Active',    color: 'text-blue-700',    bg: 'bg-blue-50',     ring: 'ring-blue-200' },
  on_hold:   { label: 'On Hold',   color: 'text-amber-700',   bg: 'bg-amber-50',    ring: 'ring-amber-200' },
  complete:  { label: 'Complete',  color: 'text-emerald-700', bg: 'bg-emerald-50',  ring: 'ring-emerald-200' },
  cancelled: { label: 'Cancelled', color: 'text-red-700',     bg: 'bg-red-50',      ring: 'ring-red-200' },
};

const PROJECT_STATUSES = Object.keys(STATUS_CONFIG) as CIProjectStatus[];
const TASK_STATUSES = Object.keys(TASK_VISUALS) as CITaskStatus[];

const FALLBACK_STATUS = { label: 'Unknown', color: 'text-gray-700', bg: 'bg-gray-100', ring: 'ring-gray-200' };

function statusOf(status: string) {
  return (STATUS_CONFIG as Record<string, typeof FALLBACK_STATUS>)[status] ?? FALLBACK_STATUS;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number | null | undefined): string {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** 'YYYY-MM-DD' for a date input, from whatever shape the API returned. */
function dateInputValue(iso?: string | null): string {
  return iso ? String(iso).slice(0, 10) : '';
}

const TODAY_KEY = () => new Date().toISOString().slice(0, 10);

function isOverdue(p: CIProject): boolean {
  if (!p.target_date) return false;
  if (p.status === 'complete' || p.status === 'cancelled') return false;
  return dateInputValue(p.target_date) < TODAY_KEY();
}

function StatusChip({ status, className = '' }: { status: string; className?: string }) {
  const cfg = statusOf(status);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color} ring-1 ring-inset ${cfg.ring} ${className}`}>
      {cfg.label}
    </span>
  );
}

/**
 * A project's completion. `null` means "no tasks", which is NOT 0% — so it
 * renders as an em dash with the reason beside it rather than an invented zero.
 */
function ProgressCell({ progress, taskCount }: { progress: number | null; taskCount: number }) {
  if (taskCount === 0 || progress === null) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-gray-400" title="No tasks have been added, so there is nothing to roll up yet.">
        <span className="text-gray-400 font-semibold">—</span>
        <span>no tasks yet</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="h-1.5 w-20 rounded-full bg-gray-200 overflow-hidden shrink-0">
        <span
          className={`block h-full rounded-full ${progress >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </span>
      <span className="text-xs font-semibold text-gray-700 [font-variant-numeric:tabular-nums]">{progress}%</span>
    </span>
  );
}

// ── Project create / edit modal ───────────────────────────────────────────────

interface ProjectFormValues {
  name: string;
  description: string;
  status: CIProjectStatus;
  department_id: string;
  owner_name: string;
  start_date: string;
  target_date: string;
  estimated_savings: string;
  actual_savings: string;
}

function toFormValues(p: CIProject | null): ProjectFormValues {
  return {
    name: p?.name ?? '',
    description: p?.description ?? '',
    status: p?.status ?? 'planning',
    department_id: p?.department_id ?? '',
    owner_name: p?.owner_name ?? '',
    start_date: dateInputValue(p?.start_date),
    target_date: dateInputValue(p?.target_date),
    estimated_savings: p?.estimated_savings ? String(p.estimated_savings) : '',
    actual_savings: p?.actual_savings ? String(p.actual_savings) : '',
  };
}

interface ProjectModalProps {
  project: CIProject | null;
  departments: { id: string; name: string }[];
  /** Pre-fill from a Kaizen idea when starting a project from one. */
  onClose: () => void;
  onSaved: (project: CIProject) => void;
}

function ProjectModal({ project, departments, onClose, onSaved }: ProjectModalProps) {
  const [v, setV] = useState<ProjectFormValues>(() => toFormValues(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) =>
    setV(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!v.name.trim()) { setError('Project name is required'); return; }
    if (v.start_date && v.target_date && v.target_date < v.start_date) {
      setError('The target date cannot be before the start date');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      name: v.name.trim(),
      description: v.description.trim(),
      status: v.status,
      department_id: v.department_id || null,
      owner_name: v.owner_name.trim(),
      start_date: v.start_date || null,
      target_date: v.target_date || null,
      estimated_savings: v.estimated_savings ? parseFloat(v.estimated_savings) : 0,
      actual_savings: v.actual_savings ? parseFloat(v.actual_savings) : 0,
    };
    try {
      const saved = project
        ? await api.updateCIProject(project.id, payload)
        : await api.createCIProject(payload);
      onSaved(saved);
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to save the project');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <FolderKanban className="w-5 h-5 text-blue-600" />
            <h2 className="text-gray-900 font-semibold text-lg">{project ? `Edit ${project.number}` : 'New CI Project'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">{error}</div>}

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-name">Project name *</label>
            <input
              id="ci-name"
              className="input-field text-sm"
              placeholder="e.g. Cut changeover time on Line 2"
              value={v.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-desc">Description</label>
            <textarea
              id="ci-desc"
              rows={3}
              className="input-field text-sm resize-none"
              placeholder="What is being improved, and how will you know it worked?"
              value={v.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-status">Status</label>
              <select
                id="ci-status"
                className="input-field text-sm"
                value={v.status}
                onChange={e => set('status', e.target.value as CIProjectStatus)}
              >
                {PROJECT_STATUSES.map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-dept">Department</label>
              <select
                id="ci-dept"
                className="input-field text-sm"
                value={v.department_id}
                onChange={e => set('department_id', e.target.value)}
              >
                <option value="">No department</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-owner">Owner</label>
              <input
                id="ci-owner"
                className="input-field text-sm"
                placeholder="Who is accountable?"
                value={v.owner_name}
                onChange={e => set('owner_name', e.target.value)}
              />
            </div>
            <div className="field-row gap-3">
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-start">Start</label>
                <input id="ci-start" type="date" className="input-field text-sm" value={v.start_date} onChange={e => set('start_date', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-target">Target</label>
                <input id="ci-target" type="date" className="input-field text-sm" value={v.target_date} onChange={e => set('target_date', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-est">Estimated savings ($)</label>
              <input id="ci-est" type="number" min="0" className="input-field text-sm" placeholder="0" value={v.estimated_savings} onChange={e => set('estimated_savings', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-act">Actual savings ($)</label>
              <input id="ci-act" type="number" min="0" className="input-field text-sm" placeholder="0" value={v.actual_savings} onChange={e => set('actual_savings', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
            {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task create / edit modal ──────────────────────────────────────────────────

interface TaskModalProps {
  projectId: string;
  task: CIProjectTask | null;
  /** Every other task in the project — the candidates for a predecessor. */
  siblings: CIProjectTask[];
  defaultStart: string;
  onClose: () => void;
  onSaved: () => void;
}

function TaskModal({ projectId, task, siblings, defaultStart, onClose, onSaved }: TaskModalProps) {
  const [name, setName] = useState(task?.name ?? '');
  const [status, setStatus] = useState<CITaskStatus>(task?.status ?? 'not_started');
  const [assignee, setAssignee] = useState(task?.assignee_name ?? '');
  const [startDate, setStartDate] = useState(dateInputValue(task?.start_date) || (task ? '' : defaultStart));
  const [endDate, setEndDate] = useState(dateInputValue(task?.end_date));
  const [progress, setProgress] = useState(task ? task.progress : 0);
  const [dependsOn, setDependsOn] = useState(task?.depends_on ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const candidates = siblings.filter(s => s.id !== task?.id);

  const handleSave = async () => {
    if (!name.trim()) { setError('Task name is required'); return; }
    if (startDate && endDate && endDate < startDate) { setError('The end date cannot be before the start date'); return; }
    setSaving(true);
    setError('');
    const payload = {
      name: name.trim(),
      status,
      assignee_name: assignee.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      progress,
      depends_on: dependsOn || null,
    };
    try {
      if (task) await api.updateCIProjectTask(projectId, task.id, payload);
      else await api.createCIProjectTask(projectId, payload);
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to save the task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    setDeleting(true);
    try {
      await api.deleteCIProjectTask(projectId, task.id);
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to delete the task');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-blue-600" />
            <h2 className="text-gray-900 font-semibold text-base">{task ? 'Edit task' : 'Add task'}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">{error}</div>}

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-name">Task name *</label>
            <input id="ci-task-name" className="input-field text-sm" placeholder="e.g. Run the time study" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className="field-row gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-status">Status</label>
              <select id="ci-task-status" className="input-field text-sm" value={status} onChange={e => setStatus(e.target.value as CITaskStatus)}>
                {TASK_STATUSES.map(s => <option key={s} value={s}>{TASK_VISUALS[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-assignee">Assignee</label>
              <input id="ci-task-assignee" className="input-field text-sm" placeholder="Who is doing it?" value={assignee} onChange={e => setAssignee(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-start">Start</label>
              <input id="ci-task-start" type="date" className="input-field text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-end">End</label>
              <input id="ci-task-end" type="date" className="input-field text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            A task with no dates stays on the list but not on the timeline — the chart says so rather than guessing a window.
          </p>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-progress">
              Progress — {progress}%
            </label>
            <input
              id="ci-task-progress"
              type="range"
              min={0}
              max={100}
              step={5}
              className="w-full accent-blue-600"
              value={progress}
              onChange={e => setProgress(Number(e.target.value))}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1" htmlFor="ci-task-dep">Starts after (finish-to-start)</label>
            <select id="ci-task-dep" className="input-field text-sm" value={dependsOn} onChange={e => setDependsOn(e.target.value)}>
              <option value="">No predecessor</option>
              {candidates.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
          {task ? (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <button onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />{deleting ? 'Deleting…' : 'Confirm'}
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 hover:text-red-800">
                <Trash2 className="w-3.5 h-3.5" />Delete task
              </button>
            )
          ) : <span />}
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm disabled:opacity-50">
              {saving ? 'Saving…' : task ? 'Save task' : 'Add task'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Project detail (list of tasks + Gantt) ────────────────────────────────────

function ProjectDetail({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [project, setProject] = useState<CIProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [taskModal, setTaskModal] = useState<{ open: boolean; task: CIProjectTask | null }>({ open: false, task: null });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deptFilter = useDepartmentFilter('ci-projects');

  const load = useCallback(async () => {
    try {
      const data = await api.getCIProject(projectId);
      setProject(data);
      setNotFound(false);
      setError('');
    } catch (e: unknown) {
      const message = (e as Error).message || '';
      if (/not found/i.test(message)) setNotFound(true);
      else setError(message || 'Failed to load the project');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const auto = useAutoRefresh(load, 60_000);

  const tasks = useMemo(() => project?.tasks ?? [], [project]);
  // Recomputed locally so an edit updates the header in the same beat the Gantt
  // redraws, instead of waiting for the next poll.
  const progress = useMemo(() => rollupProgress(tasks), [tasks]);

  const handleDeleteProject = async () => {
    try {
      await api.deleteCIProject(projectId);
      navigate('/ci-projects');
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to delete the project');
      setConfirmDelete(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !project) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-lg mx-auto text-center py-24">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-gray-900 font-semibold text-lg mb-1">This project isn't here</h1>
          <p className="text-gray-500 text-sm mb-6">It may have been deleted, or it belongs to another company.</p>
          <Link to="/ci-projects" className="btn-primary text-sm inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const overdue = isOverdue(project);
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const done = tasks.filter(t => t.status === 'done').length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 space-y-5 overflow-x-hidden">
      <Link to="/ci-projects" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800">
        <ArrowLeft className="w-3.5 h-3.5" />All CI projects
      </Link>

      <PageHeader
        title={
          <span className="flex items-center gap-3 flex-wrap">
            <span className="font-mono text-sm text-gray-400">{project.number}</span>
            <span className="break-words">{project.name}</span>
            <StatusChip status={project.status} />
            {overdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 ring-1 ring-inset ring-red-200">
                <AlertTriangle className="w-3 h-3" />Past target
              </span>
            )}
          </span>
        }
        subtitle={project.description || 'No description'}
        actions={
          <>
            <LastRefreshed at={auto.lastRefreshed} refreshing={auto.refreshing} onRefresh={() => { void auto.refresh(); }} />
            <button onClick={() => setEditing(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5" />Edit
            </button>
            <button onClick={() => setTaskModal({ open: true, task: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" />Add task
            </button>
          </>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">{error}</div>}

      {/* Where this project came from — the link back to the idea. */}
      {project.kaizen_idea_id && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm">
          <Lightbulb className="w-4 h-4 text-amber-700 shrink-0" />
          <span className="text-amber-900">
            Started from Kaizen idea{' '}
            <span className="font-mono text-xs">{project.kaizen_idea_number ?? ''}</span>
            {project.kaizen_idea_title ? ` — ${project.kaizen_idea_title}` : ''}
          </span>
          <Link to="/kaizen" className="ml-auto text-xs font-medium text-amber-800 hover:underline whitespace-nowrap">Open Ideas</Link>
        </div>
      )}

      {/* Facts */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <FactCard icon={<User className="w-4 h-4 text-gray-400" />} label="Owner" value={project.owner_name || '—'} />
        <FactCard icon={<Building2 className="w-4 h-4 text-gray-400" />} label="Department" value={project.department_name || '—'} />
        <FactCard icon={<Calendar className="w-4 h-4 text-gray-400" />} label="Start" value={formatDate(project.start_date)} />
        <FactCard
          icon={<Calendar className={`w-4 h-4 ${overdue ? 'text-red-500' : 'text-gray-400'}`} />}
          label="Target"
          value={formatDate(project.target_date)}
          valueClass={overdue ? 'text-red-700' : undefined}
        />
        <FactCard icon={<DollarSign className="w-4 h-4 text-gray-400" />} label="Est. savings" value={formatCurrency(project.estimated_savings)} />
        <FactCard
          icon={<DollarSign className="w-4 h-4 text-gray-400" />}
          label="Actual savings"
          value={formatCurrency(project.actual_savings)}
          valueClass={project.actual_savings ? 'text-emerald-700' : undefined}
        />
      </div>

      {/* Rollup */}
      <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-6 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 mb-1">Progress</p>
          <ProgressCell progress={progress} taskCount={tasks.length} />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Tasks</p>
          <p className="text-sm font-semibold text-gray-800 [font-variant-numeric:tabular-nums]">
            {tasks.length === 0 ? '—' : `${done} of ${tasks.length} done`}
          </p>
        </div>
        {blocked > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Blocked</p>
            <p className="text-sm font-semibold text-red-700 [font-variant-numeric:tabular-nums]">{blocked}</p>
          </div>
        )}
      </div>

      {/* Gantt */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Schedule</h2>
        <GanttChart
          tasks={tasks}
          projectStart={project.start_date}
          projectTarget={project.target_date}
          onSelectTask={t => setTaskModal({ open: true, task: t })}
        />
      </div>

      {/* Task table — the same tasks, with the numbers the bars can only hint at */}
      {tasks.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Tasks</h2>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Task</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Assignee</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Window</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Progress</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  const vis = taskVisual(t.status);
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50 cursor-pointer"
                      onClick={() => setTaskModal({ open: true, task: t })}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-gray-800">{t.name}</span>
                        {t.depends_on_name && (
                          <span className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                            <Link2 className="w-3 h-3" />after {t.depends_on_name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                          <span className={`w-2 h-2 rounded-full ${vis.dot}`} />{vis.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{t.assignee_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                        {t.start_date || t.end_date ? `${formatDate(t.start_date)} → ${formatDate(t.end_date)}` : <span className="text-gray-400 italic">not scheduled</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-semibold text-gray-700 [font-variant-numeric:tabular-nums]">{t.progress}%</td>
                      <td className="px-4 py-2.5 text-right"><ChevronRight className="w-4 h-4 text-gray-300 inline" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Danger zone */}
      <div className="pt-2">
        {confirmDelete ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 inline-flex items-center gap-3 flex-wrap">
            <span className="text-red-700 text-sm font-medium">Delete {project.number} and all its tasks?</span>
            <button onClick={handleDeleteProject} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700">
              <Trash2 className="w-3.5 h-3.5" />Yes, delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-500 hover:text-gray-800">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-red-700">
            <Trash2 className="w-3.5 h-3.5" />Delete project
          </button>
        )}
      </div>

      {editing && (
        <ProjectModal
          project={project}
          departments={deptFilter.departments}
          onClose={() => setEditing(false)}
          onSaved={saved => setProject(saved)}
        />
      )}

      {taskModal.open && (
        <TaskModal
          projectId={project.id}
          task={taskModal.task}
          siblings={tasks}
          defaultStart={dateInputValue(project.start_date) || TODAY_KEY()}
          onClose={() => setTaskModal({ open: false, task: null })}
          onSaved={() => { void auto.refresh(); }}
        />
      )}
    </div>
  );
}

function FactCard({ icon, label, value, valueClass = 'text-gray-800' }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">{icon}{label}</p>
      <p className={`text-sm font-semibold truncate ${valueClass}`} title={value}>{value}</p>
    </div>
  );
}

// ── Project list ──────────────────────────────────────────────────────────────

function ProjectsList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<CIProject[]>([]);
  const [summary, setSummary] = useState<CIProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CIProjectStatus>('All');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const deptFilter = useDepartmentFilter('ci-projects');

  // Everything is fetched once and narrowed in the browser, so the status chip
  // counts and the summary strip stay honest for the chosen department.
  const load = useCallback(async () => {
    try {
      const [rows, sum] = await Promise.all([api.getCIProjects(), api.getCIProjectSummary()]);
      setProjects(rows);
      setSummary(sum);
      setError('');
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const auto = useAutoRefresh(load, 60_000);

  const deptProjects = useMemo(() => projects.filter(deptFilter.matches), [projects, deptFilter.matches]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deptProjects.filter(p => {
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;
      if (q && !`${p.name} ${p.number} ${p.owner_name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deptProjects, statusFilter, search]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { All: deptProjects.length };
    for (const s of PROJECT_STATUSES) out[s] = deptProjects.filter(p => p.status === s).length;
    return out;
  }, [deptProjects]);

  // Under "All departments" the server's tally is authoritative; once a
  // department is chosen the server can't answer (the summary takes no
  // department), so the same numbers are recomputed from that department's rows
  // rather than left reading plant-wide.
  const stats = useMemo(() => {
    if (!deptFilter.active) {
      return summary
        ? { total: summary.total, active: summary.active, overdue: summary.overdue, fromIdeas: summary.from_ideas, estimated: summary.estimated_savings }
        : null;
    }
    if (loading) return null;
    return {
      total: deptProjects.length,
      active: deptProjects.filter(p => p.status === 'active').length,
      overdue: deptProjects.filter(isOverdue).length,
      fromIdeas: deptProjects.filter(p => p.kaizen_idea_id).length,
      estimated: deptProjects.reduce((sum, p) => sum + (p.estimated_savings || 0), 0),
    };
  }, [deptFilter.active, deptProjects, summary, loading]);

  const filtersActive = statusFilter !== 'All' || !!search.trim();
  const deptName = deptFilter.selected?.name ?? 'this department';

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 space-y-5 overflow-x-hidden">
      <PageHeader
        title={<span className="flex items-center gap-2"><FolderKanban className="w-6 h-6 text-blue-600" />CI Projects</span>}
        subtitle="Improvement work from idea to done — owners, schedules and Gantt charts"
        actions={
          <>
            <LastRefreshed at={auto.lastRefreshed} refreshing={auto.refreshing} onRefresh={() => { void auto.refresh(); }} />
            <button onClick={() => setCreating(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" />New project
            </button>
          </>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">{error}</div>}

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatTile label={deptFilter.selected ? `Projects — ${deptFilter.selected.name}` : 'Projects'} value={stats?.total ?? '—'} />
        <StatTile label="Active" value={stats?.active ?? '—'} color="text-blue-700" />
        <StatTile label="Past target" value={stats?.overdue ?? '—'} color={stats?.overdue ? 'text-red-700' : 'text-gray-900'} />
        <StatTile label="From ideas" value={stats?.fromIdeas ?? '—'} color="text-amber-700" />
        <StatTile label="Est. savings" value={stats ? formatCurrency(stats.estimated) : '—'} color="text-emerald-700" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              className="input-field text-sm pl-9"
              placeholder="Search projects…"
              aria-label="Search projects"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <DepartmentFilter
            filter={deptFilter}
            matchCount={deptProjects.length}
            matchNoun={deptProjects.length === 1 ? 'project' : 'projects'}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {(['All', ...PROJECT_STATUSES] as const).map(s => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}
              >
                {s === 'All' ? 'All' : STATUS_CONFIG[s].label}
                <span className="ml-1.5 opacity-70 [font-variant-numeric:tabular-nums]">{counts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rows */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyProjects
          reason={deptFilter.active ? 'department' : filtersActive ? 'filters' : 'none'}
          deptName={deptName}
          onClear={() => { setStatusFilter('All'); setSearch(''); deptFilter.clear(); }}
          onCreate={() => setCreating(true)}
        />
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="border-b border-gray-200 text-left">
                {['Project', 'Status', 'Owner', 'Department', 'Window', 'Progress', 'Savings'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody data-testid="ci-project-rows">
              {visible.map(p => {
                const overdue = isOverdue(p);
                return (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => navigate(`/ci-projects/${p.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span className="block font-mono text-[11px] text-gray-400">{p.number}</span>
                      <span className="block font-medium text-gray-800">{p.name}</span>
                      {p.kaizen_idea_id && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 mt-0.5">
                          <Lightbulb className="w-3 h-3" />
                          from {p.kaizen_idea_number ?? 'a Kaizen idea'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusChip status={p.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-600">{p.owner_name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{p.department_name || '—'}</td>
                    <td className={`px-4 py-3 text-xs whitespace-nowrap ${overdue ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                      {formatDate(p.start_date)} → {formatDate(p.target_date)}
                      {overdue && <span className="block text-[10px]">past target</span>}
                    </td>
                    <td className="px-4 py-3"><ProgressCell progress={p.progress} taskCount={p.task_count} /></td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {p.actual_savings ? (
                        <span className="text-emerald-700 font-medium inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{formatCurrency(p.actual_savings)}</span>
                      ) : (
                        <span title="Estimated — nothing banked yet">{formatCurrency(p.estimated_savings)} est.</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right"><ChevronRight className="w-4 h-4 text-gray-300 inline" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <ProjectModal
          project={null}
          departments={deptFilter.departments}
          onClose={() => setCreating(false)}
          onSaved={saved => navigate(`/ci-projects/${saved.id}`)}
        />
      )}
    </div>
  );
}

function StatTile({ label, value, color = 'text-gray-900' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <p className="text-xs text-gray-500 mb-0.5 truncate" title={label}>{label}</p>
      <p className={`text-2xl font-bold [font-variant-numeric:tabular-nums] ${color}`}>{value}</p>
    </div>
  );
}

/**
 * "Nothing here yet" and "nothing matches what you asked for" are different
 * facts and need different offers — one to create, one to widen.
 */
function EmptyProjects({ reason, deptName, onClear, onCreate }: {
  reason: 'none' | 'filters' | 'department';
  deptName: string;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center" data-testid={`ci-empty-${reason}`}>
      <div className="w-16 h-16 bg-blue-50 border border-blue-200 rounded-full flex items-center justify-center mb-4">
        <FolderKanban className="w-8 h-8 text-blue-600" />
      </div>
      {reason === 'none' ? (
        <>
          <h3 className="text-gray-900 font-semibold text-lg mb-1">No CI projects yet</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm">
            A project is where an improvement idea gets a schedule, an owner and a Gantt chart. Start one — or open a
            Kaizen idea and start a project from it.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button onClick={onCreate} className="btn-primary text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />Create your first project
            </button>
            <Link to="/kaizen" className="btn-secondary text-sm inline-flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />Browse ideas
            </Link>
          </div>
        </>
      ) : reason === 'department' ? (
        <>
          <h3 className="text-gray-900 font-semibold text-lg mb-1">No projects in {deptName}</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-sm">
            Nothing here matches the current filters. Other departments may have projects that do.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button onClick={onClear} className="btn-secondary text-sm inline-flex items-center gap-2">
              <X className="w-4 h-4" />Clear filters
            </button>
            <button onClick={onCreate} className="btn-primary text-sm inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />New project
            </button>
          </div>
        </>
      ) : (
        <>
          <h3 className="text-gray-900 font-semibold text-lg mb-1">No matching projects</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-xs">
            There are projects here, but none match the current search and status filter.
          </p>
          <button onClick={onClear} className="btn-secondary text-sm inline-flex items-center gap-2">
            <X className="w-4 h-4" />Clear filters
          </button>
        </>
      )}
    </div>
  );
}

// ── Route entry ───────────────────────────────────────────────────────────────

export default function CIProjects() {
  const { id } = useParams<{ id: string }>();
  return id ? <ProjectDetail key={id} projectId={id} /> : <ProjectsList />;
}
