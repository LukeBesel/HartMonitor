import { useEffect, useState, useCallback } from 'react';
import {
  ShieldAlert, CheckCircle2, Truck, DollarSign, Smile, Leaf,
  Plus, Search, X, ChevronRight, Lightbulb,
  Users, Target, Edit3, Trash2, LayoutList, LayoutGrid,
} from 'lucide-react';
import { api } from '../api/client';

// ── Types ────────────────────────────────────────────────────────────────────

interface KaizenIdea {
  id: string;
  idea_number: string;
  title: string;
  description: string;
  category: 'safety' | 'quality' | 'delivery' | 'cost' | 'morale' | 'environment';
  type: 'improvement' | 'problem' | 'suggestion';
  status: 'submitted' | 'reviewing' | 'approved' | 'in_progress' | 'implemented' | 'rejected' | 'on_hold';
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

interface Department {
  id: string;
  name: string;
}

// ── Category & Status configs ─────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  safety:      { label: 'Safety',      color: 'text-red-400',    bg: 'bg-red-500/20',    border: 'border-red-500/30',    icon: ShieldAlert },
  quality:     { label: 'Quality',     color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30', icon: CheckCircle2 },
  delivery:    { label: 'Delivery',    color: 'text-blue-400',   bg: 'bg-blue-500/20',   border: 'border-blue-500/30',   icon: Truck },
  cost:        { label: 'Cost',        color: 'text-green-400',  bg: 'bg-green-500/20',  border: 'border-green-500/30',  icon: DollarSign },
  morale:      { label: 'Morale',      color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', icon: Smile },
  environment: { label: 'Environment', color: 'text-teal-400',   bg: 'bg-teal-500/20',   border: 'border-teal-500/30',   icon: Leaf },
} as const;

const STATUS_CONFIG = {
  submitted:   { label: 'Submitted',   color: 'text-gray-300',   bg: 'bg-gray-700' },
  reviewing:   { label: 'Reviewing',   color: 'text-yellow-300', bg: 'bg-yellow-500/20' },
  approved:    { label: 'Approved',    color: 'text-blue-300',   bg: 'bg-blue-500/20' },
  in_progress: { label: 'In Progress', color: 'text-amber-300',  bg: 'bg-amber-500/20' },
  implemented: { label: 'Implemented', color: 'text-green-300',  bg: 'bg-green-500/20' },
  rejected:    { label: 'Rejected',    color: 'text-red-300',    bg: 'bg-red-500/20' },
  on_hold:     { label: 'On Hold',     color: 'text-gray-400',   bg: 'bg-gray-800' },
} as const;

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
      <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-yellow-400" />
            <h2 className="text-white font-semibold text-lg">Submit Kaizen Idea</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Title *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Brief title for the idea"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Description *</label>
            <textarea
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="Describe the idea in detail"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* Category Grid */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-2">Category *</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CATEGORY_CONFIG) as KaizenIdea['category'][]).map(cat => {
                const cfg = CATEGORY_CONFIG[cat];
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
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
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
              <label className="text-xs font-medium text-gray-400 block mb-1">Type</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={type}
                onChange={e => setType(e.target.value as KaizenIdea['type'])}
              >
                <option value="improvement">Improvement</option>
                <option value="problem">Problem</option>
                <option value="suggestion">Suggestion</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Department</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
            <label className="text-xs font-medium text-gray-400 block mb-1">Your Name *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Enter your name"
              value={submitterName}
              onChange={e => setSubmitterName(e.target.value)}
            />
          </div>

          {/* Before Description */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Current Situation (optional)</label>
            <textarea
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
              placeholder="What's the current situation or problem?"
              value={beforeDescription}
              onChange={e => setBeforeDescription(e.target.value)}
            />
          </div>

          {/* Estimated Savings */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Estimated Savings ($, optional)</label>
            <input
              type="number"
              min="0"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="0"
              value={estimatedSavings}
              onChange={e => setEstimatedSavings(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
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

  const catCfg = CATEGORY_CONFIG[idea.category];
  const statCfg = STATUS_CONFIG[idea.status];
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
      <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-gray-900 border-l border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800 shrink-0">
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
            <h2 className="text-white font-semibold text-base leading-snug">{idea.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors shrink-0 mt-0.5">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Description */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">Description</p>
            <p className="text-gray-300 text-sm leading-relaxed">{idea.description}</p>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Submitter</p>
              <p className="text-gray-300 flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-gray-500" />
                {idea.submitter_name}
              </p>
            </div>
            {idea.department_name && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Department</p>
                <p className="text-gray-300">{idea.department_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Type</p>
              <p className="text-gray-300 capitalize">{idea.type}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Submitted</p>
              <p className="text-gray-300">{formatDate(idea.created_at)}</p>
            </div>
            {idea.estimated_savings > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Est. Savings</p>
                <p className="text-green-400 font-medium">{formatCurrency(idea.estimated_savings)}</p>
              </div>
            )}
          </div>

          <hr className="border-gray-800" />

          {/* Editable fields */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
              <Edit3 className="w-3.5 h-3.5" /> Edit Details
            </p>

            {/* Champion Name */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Champion Name</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="Who is leading this?"
                value={championName}
                onChange={e => setChampionName(e.target.value)}
              />
            </div>

            {/* Status */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Status</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={status}
                onChange={e => setStatus(e.target.value as KaizenIdea['status'])}
              >
                {(Object.keys(STATUS_CONFIG) as KaizenIdea['status'][]).map(s => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>

            {/* Target Date */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Target Date</label>
              <input
                type="date"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
              />
            </div>

            {/* Actual Savings */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Actual Savings ($)</label>
              <input
                type="number"
                min="0"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="0"
                value={actualSavings}
                onChange={e => setActualSavings(e.target.value)}
              />
            </div>

            {/* Before Description */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Before (Current Situation)</label>
              <textarea
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                placeholder="Describe the current/before state"
                value={beforeDesc}
                onChange={e => setBeforeDesc(e.target.value)}
              />
            </div>

            {/* After Description */}
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">After (Improved State)</label>
              <textarea
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                placeholder="Describe the improved/after state"
                value={afterDesc}
                onChange={e => setAfterDesc(e.target.value)}
              />
            </div>

            {saveError && (
              <div className="text-red-400 text-xs">{saveError}</div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 w-full justify-center"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>

          <hr className="border-gray-800" />

          {/* Delete section */}
          <div>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-red-400 border border-gray-700 rounded-lg text-sm font-medium hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Delete Idea
              </button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 space-y-2">
                <p className="text-red-400 text-sm font-medium">Delete this idea permanently?</p>
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
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-gray-200 border border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
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
  const catCfg = CATEGORY_CONFIG[idea.category];
  const statCfg = STATUS_CONFIG[idea.status];
  const Icon = catCfg.icon;

  return (
    <div
      onClick={onClick}
      className="bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors flex items-start gap-4"
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
        <p className="text-white font-semibold text-sm leading-snug mb-1">{idea.title}</p>
        <p className="text-gray-400 text-xs leading-relaxed line-clamp-2 mb-2">{idea.description}</p>
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
          <span className="text-green-400 text-xs font-medium flex items-center gap-0.5">
            <Target className="w-3 h-3" />
            {formatCurrency(idea.estimated_savings)}
          </span>
        )}
        {idea.target_date && (
          <span className="text-gray-500 text-xs">{formatDate(idea.target_date)}</span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-600" />
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
  const catCfg = CATEGORY_CONFIG[idea.category];
  const statCfg = STATUS_CONFIG[idea.status];
  const Icon = catCfg.icon;

  return (
    <div
      onClick={onClick}
      className="bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-pointer hover:border-gray-700 transition-colors flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${catCfg.bg} border ${catCfg.border}`}>
          <Icon className={`w-4.5 h-4.5 ${catCfg.color}`} />
        </div>
        <span className="text-xs font-mono text-gray-500 mt-1">{idea.idea_number}</span>
      </div>
      <div>
        <p className="text-white font-semibold text-sm leading-snug line-clamp-2 mb-1">{idea.title}</p>
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
          <p className="text-green-400 font-medium">{formatCurrency(idea.estimated_savings)}</p>
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

function SummaryCard({ label, value, color = 'text-white', icon }: SummaryCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
      {icon && <div className="shrink-0">{icon}</div>}
      <div>
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Kaizen() {
  const [ideas, setIdeas] = useState<KaizenIdea[]>([]);
  const [summary, setSummary] = useState<KaizenSummary | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  const [selectedIdea, setSelectedIdea] = useState<KaizenIdea | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);

  const fetchIdeas = useCallback(async () => {
    try {
      const data = await api.getKaizenIdeas({
        status: statusFilter !== 'All' ? statusFilter : undefined,
        category: categoryFilter || undefined,
        search: search || undefined,
      });
      setIdeas(data);
    } catch {
      // ignore
    }
  }, [statusFilter, categoryFilter, search]);

  const fetchSummary = useCallback(async () => {
    try {
      const data = await api.getKaizenSummary();
      setSummary(data);
    } catch {
      // ignore
    }
  }, []);

  const fetchDepartments = useCallback(async () => {
    try {
      const data = await api.getDepartments();
      setDepartments(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchIdeas(), fetchSummary(), fetchDepartments()]).finally(() => setLoading(false));
  }, [fetchIdeas, fetchSummary, fetchDepartments]);

  const handleRefresh = () => {
    fetchIdeas();
    fetchSummary();
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500/20 border border-yellow-500/30 rounded-xl flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-white font-bold text-xl">Kaizen / CI Ideas</h1>
            <p className="text-gray-400 text-xs">Continuous improvement ideas tracker</p>
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
          label="Total Ideas"
          value={summary?.total ?? '—'}
          icon={<Lightbulb className="w-5 h-5 text-yellow-400" />}
        />
        <SummaryCard
          label="Implemented"
          value={summary?.implemented ?? '—'}
          color="text-green-400"
          icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
        />
        <SummaryCard
          label="Total Savings"
          value={summary?.total_savings ? formatCurrency(summary.total_savings) : '$0'}
          color="text-green-400"
          icon={<DollarSign className="w-5 h-5 text-green-400" />}
        />
        <SummaryCard
          label="In Progress"
          value={summary?.in_progress ?? '—'}
          color="text-amber-400"
          icon={<Target className="w-5 h-5 text-amber-400" />}
        />
      </div>

      {/* Filter row */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 space-y-3">
        {/* Search + category */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="Search ideas…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {(Object.keys(CATEGORY_CONFIG) as KaizenIdea['category'][]).map(cat => (
              <option key={cat} value={cat}>{CATEGORY_CONFIG[cat].label}</option>
            ))}
          </select>

          {/* View toggle */}
          <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              title="List view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-hide">
          {STATUS_FILTERS.map(s => {
            const active = statusFilter === s;
            const label = s === 'All' ? 'All' : STATUS_CONFIG[s as KaizenIdea['status']].label;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
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
      ) : ideas.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-20 h-20 bg-yellow-500/10 border border-yellow-500/20 rounded-full flex items-center justify-center mb-4">
            <Lightbulb className="w-10 h-10 text-yellow-400" />
          </div>
          <h3 className="text-white font-semibold text-lg mb-1">No ideas yet</h3>
          <p className="text-gray-400 text-sm mb-6 max-w-xs">
            Be the first to submit a continuous improvement idea
          </p>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl text-base font-semibold hover:bg-green-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            Submit Your First Idea
          </button>
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-3">
          {ideas.map(idea => (
            <IdeaListCard
              key={idea.id}
              idea={idea}
              onClick={() => setSelectedIdea(idea)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ideas.map(idea => (
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
          departments={departments}
          onClose={() => setShowSubmitModal(false)}
          onSubmitted={handleRefresh}
        />
      )}
    </div>
  );
}
