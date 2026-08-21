import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShieldAlert, CheckCircle2, Truck, DollarSign, Smile, Leaf,
  Plus, Search, X, ChevronRight, Lightbulb,
  Users, Target, Edit3, Trash2, LayoutList, LayoutGrid,
} from 'lucide-react';
import { api } from '../api/client';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import DepartmentFilter from '../components/shared/DepartmentFilter';

// ── Types ────────────────────────────────────────────────────────────────────

interface KaizenIdea {
  id: string;
  idea_number: string;
  title: string;
  description: string;
  category: 'safety' | 'quality' | 'delivery' | 'cost' | 'morale' | 'environment';
  type: 'improvement' | 'problem' | 'suggestion';
  status: 'submitted' | 'reviewing' | 'approved' | 'in_progress' | 'implemented' | 'rejected' | 'on_hold';
  // GET /kaizen selects k.* plus a joined d.name, so rows carry both the id and
  // the display name of the department.
  department_id?: string;
  department_name?: string;
  submitter_name: string;
  champion_name?: string;
  estimated_savings: number;
  actual_savings: number;
  target_date?: string;
  completed_at?: string;
  before_description?: string;
  after_description?: string;
  created_at: string;
}

interface KaizenSummary {
  total: number;
  implemented: number;
  total_savings: number;
  in_progress: number;
  submitted_this_month: number;
}

/** Just enough of a department to offer it in the submit form. */
interface Department {
  id: string;
  name: string;
}

// ── Category & Status configs ─────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  safety:      { label: 'Safety',      color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    icon: ShieldAlert },
  quality:     { label: 'Quality',     color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', icon: CheckCircle2 },
  delivery:    { label: 'Delivery',    color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   icon: Truck },
  cost:        { label: 'Cost',        color: 'text-emerald-700',  bg: 'bg-emerald-50',  border: 'border-emerald-200',  icon: DollarSign },
  morale:      { label: 'Morale',      color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: Smile },
  environment: { label: 'Environment', color: 'text-cyan-700',   bg: 'bg-cyan-50',   border: 'border-cyan-200',   icon: Leaf },
} as const;

const STATUS_CONFIG = {
  submitted:   { label: 'Submitted',   color: 'text-gray-700',   bg: 'bg-gray-100' },
  reviewing:   { label: 'Reviewing',   color: 'text-amber-700', bg: 'bg-amber-50' },
  under_review:{ label: 'Reviewing',   color: 'text-amber-700', bg: 'bg-amber-50' }, // DB CHECK vocab alias
  approved:    { label: 'Approved',    color: 'text-blue-700',   bg: 'bg-blue-50' },
  in_progress: { label: 'In Progress', color: 'text-amber-700',  bg: 'bg-amber-50' },
  implemented: { label: 'Implemented', color: 'text-emerald-700',  bg: 'bg-emerald-50' },
  rejected:    { label: 'Rejected',    color: 'text-red-700',    bg: 'bg-red-50' },
  on_hold:     { label: 'On Hold',     color: 'text-gray-500',   bg: 'bg-gray-100' },
} as const;

// Unknown category/status values (older data, imports, seeds) must degrade to a
// neutral chip — an unguarded lookup here once took the whole page down.
interface CatCfg { label: string; color: string; bg: string; border: string; icon: React.ElementType }
interface StatusCfg { label: string; color: string; bg: string }
const FALLBACK_CAT: CatCfg = { label: 'Other', color: 'text-gray-700', bg: 'bg-gray-100', border: 'border-gray-300', icon: Lightbulb };
const FALLBACK_STATUS: StatusCfg = { label: 'Unknown', color: 'text-gray-700', bg: 'bg-gray-100' };
function catOf(category: string): CatCfg {
  return (CATEGORY_CONFIG as unknown as Record<string, CatCfg>)[category] ?? FALLBACK_CAT;
}
function statusOf(status: string): StatusCfg {
  return (STATUS_CONFIG as unknown as Record<string, StatusCfg>)[status] ?? FALLBACK_STATUS;
}

const STATUS_FILTERS = ['All', 'submitted', 'reviewing', 'approved', 'in_progress', 'implemented', 'rejected'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (!n) return '';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0 });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Submit Idea Modal ─────────────────────────────────────────────────────────

interface SubmitIdeaModalProps {
  departments: Department[];
  onClose: () => void;
  onSubmitted: () => void;
}

function SubmitIdeaModal({ departments, onClose, onSubmitted }: SubmitIdeaModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<KaizenIdea['category'] | ''>('');
  const [type, setType] = useState<KaizenIdea['type']>('improvement');
  const [departmentId, setDepartmentId] = useState('');
  const [submitterName, setSubmitterName] = useState('');
  const [beforeDescription, setBeforeDescription] = useState('');
  const [estimatedSavings, setEstimatedSavings] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    if (!category) { setError('Please select a category'); return; }
    if (!submitterName.trim()) { setError('Submitter name is required'); return; }

    setSaving(true);
    setError('');
    try {
      await api.createKaizenIdea({
        title: title.trim(),
        description: description.trim(),
        category,
        type,
        department_id: departmentId || undefined,
        submitter_name: submitterName.trim(),
        before_description: beforeDescription.trim() || undefined,
        estimated_savings: estimatedSavings ? parseFloat(estimatedSavings) : 0,
      });
      onSubmitted();
      onClose();
    } catch (e: unknown) {
      const err = e as Error;
      setError(err.message || 'Failed to submit idea');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-700" />
            <h2 className="text-gray-900 font-semibold text-lg">Submit Kaizen Idea</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Title *</label>
            <input
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Brief title for the idea"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Description *</label>
            <textarea
              rows={3}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="Describe the idea in detail"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Category Grid */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-2">Category *</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CATEGORY_CONFIG) as KaizenIdea['category'][]).map(cat => {
                const cfg = catOf(cat);
                const Icon = cfg.icon;
                const selected = category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-sm font-medium ${
                      selected
                        ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                        : 'bg-gray-100 border-gray-300 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type & Department row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Type</label>
              <select
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={type}
                onChange={e => setType(e.target.value as KaizenIdea['type'])}
              >
                <option value="improvement">Improvement</option>
                <option value="problem">Problem</option>
                <option value="suggestion">Suggestion</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Department</label>
              <select
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={departmentId}
                onChange={e => setDepartmentId(e.target.value)}
              >
                <option value="">— No Department —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Submitter Name */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Your Name *</label>
            <input
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Enter your name"
              value={submitterName}
              onChange={e => setSubmitterName(e.target.value)}
            />
          </div>

          {/* Before Description */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Current Situation (optional)</label>
            <textarea
              rows={2}
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="What's the current situation or problem?"
              value={beforeDescription}
              onChange={e => setBeforeDescription(e.target.value)}
            />
          </div>

          {/* Estimated Savings */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Estimated Savings ($, optional)</label>
            <input
              type="number"
              min="0"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="0"
              value={estimatedSavings}
              onChange={e => setEstimatedSavings(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-base font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Plus className="w-5 h-5" />
            {saving ? 'Submitting…' : 'Submit Idea'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Idea Side Panel ───────────────────────────────────────────────────────────

interface IdeaSidePanelProps {
  idea: KaizenIdea;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}

function IdeaSidePanel({ idea, onClose, onUpdated, onDeleted }: IdeaSidePanelProps) {
  const [championName, setChampionName] = useState(idea.champion_name ?? '');
  const [status, setStatus] = useState<KaizenIdea['status']>(idea.status);
  const [targetDate, setTargetDate] = useState(idea.target_date ?? '');
  const [actualSavings, setActualSavings] = useState(String(idea.actual_savings ?? ''));
  const [beforeDesc, setBeforeDesc] = useState(idea.before_description ?? '');
  const [afterDesc, setAfterDesc] = useState(idea.after_description ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState('');

  const catCfg = catOf(idea.category);
  const statCfg = statusOf(idea.status);
  const Icon = catCfg.icon;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await api.updateKaizenIdea(idea.id, {
        champion_name: championName.trim() || undefined,
        status,
        target_date: targetDate || undefined,
        actual_savings: actualSavings ? parseFloat(actualSavings) : 0,
        before_description: beforeDesc.trim() || undefined,
        after_description: afterDesc.trim() || undefined,
      });
      onUpdated();
    } catch (e: unknown) {
      const err = e as Error;
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteKaizenIdea(idea.id);
      onDeleted();
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-gray-500">{idea.idea_number}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${catCfg.bg} ${catCfg.color} border ${catCfg.border}`}>
                <Icon className="w-3 h-3" />
                {catCfg.label}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statCfg.bg} ${statCfg.color}`}>
                {statCfg.label}
              </span>
            </div>
            <h2 className="text-gray-900 font-semibold text-base leading-snug">{idea.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 transition-colors shrink-0 mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Description */}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Description</p>
            <p className="text-gray-700 text-sm leading-relaxed">{idea.description}</p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Submitter</p>
              <p className="text-gray-700 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-gray-500" />
                {idea.submitter_name}
              </p>
            </div>
            {idea.department_name && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Department</p>
                <p className="text-gray-700">{idea.department_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Type</p>
              <p className="text-gray-700 capitalize">{idea.type}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Submitted</p>
              <p className="text-gray-700">{formatDate(idea.created_at)}</p>
            </div>
            {idea.estimated_savings > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Est. Savings</p>
                <p className="text-emerald-700 font-medium">{formatCurrency(idea.estimated_savings)}</p>
              </div>
            )}
          </div>

          <hr className="border-gray-200" />

          {/* Editable fields */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5" /> Edit Details
            </p>

            {/* Champion Name */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Champion Name</label>
              <input
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Who is leading this?"
                value={championName}
                onChange={e => setChampionName(e.target.value)}
              />
            </div>

            {/* Status */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Status</label>
              <select
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={status}
                onChange={e => setStatus(e.target.value as KaizenIdea['status'])}
              >
                {(Object.keys(STATUS_CONFIG) as KaizenIdea['status'][]).map(s => (
                  <option key={s} value={s}>{statusOf(s).label}</option>
                ))}
              </select>
            </div>

            {/* Target Date */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Target Date</label>
              <input
                type="date"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>

            {/* Actual Savings */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Actual Savings ($)</label>
              <input
                type="number"
                min="0"
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="0"
                value={actualSavings}
                onChange={e => setActualSavings(e.target.value)}
              />
            </div>

            {/* Before Description */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Before (Current Situation)</label>
              <textarea
                rows={2}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                placeholder="Describe the current/before state"
                value={beforeDesc}
                onChange={e => setBeforeDesc(e.target.value)}
              />
            </div>

            {/* After Description */}
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">After (Improved State)</label>
              <textarea
                rows={2}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                placeholder="Describe the improved/after state"
                value={afterDesc}
                onChange={e => setAfterDesc(e.target.value)}
              />
            </div>

            {saveError && (
              <div className="text-red-700 text-xs">{saveError}</div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 w-full justify-center"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          <hr className="border-gray-200" />

          {/* Delete section */}
          <div>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-red-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-red-100 hover:border-red-200 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Idea
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-red-700 text-sm font-medium">Delete this idea permanently?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="h-4" />
        </div>
      </div>
    </>
  );
}

// ── Idea List Card ────────────────────────────────────────────────────────────

interface IdeaListCardProps {
  idea: KaizenIdea;
  onClick: () => void;
}

function IdeaListCard({ idea, onClick }: IdeaListCardProps) {
  const catCfg = catOf(idea.category);
  const statCfg = statusOf(idea.status);
  const Icon = catCfg.icon;

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-300 transition-colors flex items-start gap-4"
    >
      {/* Left: icon + idea number */}
      <div className="shrink-0 flex flex-col items-center gap-1.5">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${catCfg.bg} border ${catCfg.border}`}>
          <Icon className={`w-5 h-5 ${catCfg.color}`} />
        </div>
        <span className="text-xs font-mono text-gray-500">{idea.idea_number}</span>
      </div>

      {/* Center */}
      <div className="flex-1 min-w-0">
        <p className="text-gray-900 font-semibold text-sm leading-snug mb-1">{idea.title}</p>
        <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 mb-2">{idea.description}</p>
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span className="flex items-center gap-1">
            <Users className="w-3 h-3" />
            {idea.submitter_name}
          </span>
          {idea.department_name && (
            <span>{idea.department_name}</span>
          )}
          <span>{timeAgo(idea.created_at)}</span>
        </div>
      </div>

      {/* Right */}
      <div className="shrink-0 flex flex-col items-end gap-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statCfg.bg} ${statCfg.color}`}>
          {statCfg.label}
        </span>
        {idea.estimated_savings > 0 && (
          <span className="text-emerald-700 text-xs font-medium flex items-center gap-0.5">
            <Target className="w-3 h-3" />
            {formatCurrency(idea.estimated_savings)}
          </span>
        )}
        {idea.target_date && (
          <span className="text-gray-500 text-xs">{formatDate(idea.target_date)}</span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400" />
      </div>
    </div>
  );
}

// ── Idea Grid Card ────────────────────────────────────────────────────────────

interface IdeaGridCardProps {
  idea: KaizenIdea;
  onClick: () => void;
}

function IdeaGridCard({ idea, onClick }: IdeaGridCardProps) {
  const catCfg = catOf(idea.category);
  const statCfg = statusOf(idea.status);
  const Icon = catCfg.icon;

  return (
    <div
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-gray-300 transition-colors flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${catCfg.bg} border ${catCfg.border}`}>
          <Icon className={`w-4.5 h-4.5 ${catCfg.color}`} />
        </div>
        <span className="text-xs font-mono text-gray-500 mt-1">{idea.idea_number}</span>
      </div>
      <div>
        <p className="text-gray-900 font-semibold text-sm leading-snug line-clamp-2 mb-1">{idea.title}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${catCfg.bg} ${catCfg.color} border ${catCfg.border}`}>
            {catCfg.label}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statCfg.bg} ${statCfg.color}`}>
            {statCfg.label}
          </span>
        </div>
      </div>
      <div className="mt-auto text-xs text-gray-500">
        <p>{idea.submitter_name}</p>
        {idea.estimated_savings > 0 && (
          <p className="text-emerald-700 font-medium">{formatCurrency(idea.estimated_savings)}</p>
        )}
      </div>
    </div>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string | number;
  color?: string;
  icon?: React.ReactNode;
}

function SummaryCard({ label, value, color = 'text-gray-900', icon }: SummaryCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3">
      {icon && <div className="shrink-0">{icon}</div>}
      <div>
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Kaizen() {
  const [ideas, setIdeas] = useState<KaizenIdea[]>([]);
  const [summary, setSummary] = useState<KaizenSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const [selectedIdea, setSelectedIdea] = useState<KaizenIdea | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const deptFilter = useDepartmentFilter('kaizen');

  // The whole company's ideas are fetched once and narrowed in the browser.
  // Status/category/search used to be server-side, but the summary strip has to
  // be recomputed for the chosen department and that needs every idea in the
  // department, not just the ones surviving the status chip.
  const fetchIdeas = useCallback(async () => {
    try {
      const data = await api.getKaizenIdeas();
      setIdeas(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.getKaizenSummary();
      setSummary(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchIdeas(), fetchSummary()]).finally(() => setLoading(false));
  }, [fetchIdeas, fetchSummary]);

  const handleRefresh = () => {
    fetchIdeas();
    fetchSummary();
  };

  // Everything the chosen department owns, before the status/category/search
  // chips are applied — this is what the summary strip counts.
  const deptIdeas = useMemo(() => ideas.filter(deptFilter.matches), [ideas, deptFilter.matches]);

  // What the list actually shows.
  const visibleIdeas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deptIdeas.filter(idea => {
      if (statusFilter !== 'All' && idea.status !== statusFilter) return false;
      if (categoryFilter && idea.category !== categoryFilter) return false;
      if (q) {
        const haystack = `${idea.title ?? ''} ${idea.idea_number ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [deptIdeas, statusFilter, categoryFilter, search]);

  // Under "All departments" the server's own tally is authoritative. Once a
  // department is chosen the server can't answer — /kaizen/summary takes no
  // department — so the same four numbers are recomputed from that
  // department's ideas rather than left showing the whole plant.
  const stats = useMemo(() => {
    if (!deptFilter.active) {
      return summary
        ? {
            total: summary.total,
            implemented: summary.implemented,
            totalSavings: summary.total_savings,
            inProgress: summary.in_progress,
          }
        : null;
    }
    if (loading) return null; // don't flash zeros before the ideas arrive
    const implemented = deptIdeas.filter(i => i.status === 'implemented');
    return {
      total: deptIdeas.length,
      implemented: implemented.length,
      totalSavings: implemented.reduce((sum, i) => sum + (i.actual_savings || 0), 0),
      inProgress: deptIdeas.filter(i => i.status === 'approved' || i.status === 'in_progress').length,
    };
  }, [deptFilter.active, deptIdeas, summary, loading]);

  const otherFiltersActive = statusFilter !== 'All' || !!categoryFilter || !!search.trim();

  // A remembered department id filters correctly from the first render, but its
  // name only arrives with the departments fetch — so copy that would otherwise
  // read "No ideas in undefined" falls back to a generic phrase for that beat.
  const deptName = deptFilter.selected?.name ?? 'this department';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-gray-900 font-bold text-xl">Kaizen / CI Ideas</h1>
            <p className="text-gray-500 text-xs">Continuous improvement ideas tracker</p>
          </div>
        </div>
        <button
          onClick={() => setShowSubmitModal(true)}
          className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-base font-semibold hover:bg-green-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Submit Idea
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label={deptFilter.selected ? `Total Ideas — ${deptFilter.selected.name}` : 'Total Ideas'}
          value={stats?.total ?? '—'}
          icon={<Lightbulb className="w-5 h-5 text-amber-700" />}
        />
        <SummaryCard
          label="Implemented"
          value={stats?.implemented ?? '—'}
          color="text-emerald-700"
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-700" />}
        />
        <SummaryCard
          // Sums the ACTUAL savings recorded on implemented ideas. With none
          // recorded it shows "—", not a $0 that reads like "we saved nothing".
          label="Savings Recorded"
          value={stats?.totalSavings ? formatCurrency(stats.totalSavings) : '—'}
          color="text-emerald-700"
          icon={<DollarSign className="w-5 h-5 text-emerald-700" />}
        />
        <SummaryCard
          label="In Progress"
          value={stats?.inProgress ?? '—'}
          color="text-amber-700"
          icon={<Target className="w-5 h-5 text-amber-700" />}
        />
      </div>

      {/* Filter row */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
        {/* Search + category */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Search ideas…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {(Object.keys(CATEGORY_CONFIG) as KaizenIdea['category'][]).map(cat => (
              <option key={cat} value={cat}>{catOf(cat).label}</option>
            ))}
          </select>

          {/* Department — sits in the same filter row as category and the
              status chips, so the page has one place to narrow the view. */}
          <DepartmentFilter
            filter={deptFilter}
            matchCount={deptIdeas.length}
            matchNoun={deptIdeas.length === 1 ? 'idea' : 'ideas'}
          />

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-gray-100 border border-gray-300 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              title="List view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
          {STATUS_FILTERS.map(s => {
            const active = statusFilter === s;
            const label = s === 'All' ? 'All' : statusOf(s).label;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ideas */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : visibleIdeas.length === 0 ? (
        /* Empty state — an empty department reads very differently from an
           empty company, so say which one this is. */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 bg-amber-50 border border-amber-200 rounded-full flex items-center justify-center mb-4">
            <Lightbulb className="w-10 h-10 text-amber-700" />
          </div>
          {deptFilter.active ? (
            <>
              <h3 className="text-gray-900 font-semibold text-lg mb-1">
                No ideas in {deptName}
              </h3>
              <p className="text-gray-500 text-sm mb-6 max-w-sm">
                {otherFiltersActive
                  ? `Nothing in ${deptName} matches the current filters. Other departments may have ideas that do.`
                  : `No continuous improvement ideas are assigned to ${deptName} yet. Other departments may have some.`}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={deptFilter.clear}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-white text-gray-700 border border-gray-300 rounded-xl text-base font-semibold hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                  Show all departments
                </button>
                <button
                  onClick={() => setShowSubmitModal(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-base font-semibold hover:bg-green-700 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Submit Idea
                </button>
              </div>
            </>
          ) : otherFiltersActive ? (
            <>
              <h3 className="text-gray-900 font-semibold text-lg mb-1">No matching ideas</h3>
              <p className="text-gray-500 text-sm mb-6 max-w-xs">
                No ideas match the current search and filters
              </p>
              <button
                onClick={() => { setSearch(''); setStatusFilter('All'); setCategoryFilter(''); }}
                className="inline-flex items-center gap-2 px-5 py-3 bg-white text-gray-700 border border-gray-300 rounded-xl text-base font-semibold hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
                Clear filters
              </button>
            </>
          ) : (
            <>
              <h3 className="text-gray-900 font-semibold text-lg mb-1">No ideas yet</h3>
              <p className="text-gray-500 text-sm mb-6 max-w-xs">
                Be the first to submit a continuous improvement idea
              </p>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-base font-semibold hover:bg-green-700 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Submit Your First Idea
              </button>
            </>
          )}
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-3">
          {visibleIdeas.map(idea => (
            <IdeaListCard
              key={idea.id}
              idea={idea}
              onClick={() => setSelectedIdea(idea)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleIdeas.map(idea => (
            <IdeaGridCard
              key={idea.id}
              idea={idea}
              onClick={() => setSelectedIdea(idea)}
            />
          ))}
        </div>
      )}

      {/* Side panel */}
      {selectedIdea && (
        <IdeaSidePanel
          idea={selectedIdea}
          onClose={() => setSelectedIdea(null)}
          onUpdated={() => {
            handleRefresh();
            setSelectedIdea(null);
          }}
          onDeleted={() => {
            handleRefresh();
          }}
        />
      )}

      {/* Submit modal */}
      {showSubmitModal && (
        <SubmitIdeaModal
          // Same department list the filter uses — one source of truth, and it
          // follows the selected site like the rest of the app.
          departments={deptFilter.departments}
          onClose={() => setShowSubmitModal(false)}
          onSubmitted={handleRefresh}
        />
      )}
    </div>
  );
}
