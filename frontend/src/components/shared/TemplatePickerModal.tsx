import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AppTemplatesResponse } from '../../api/client';
import { App } from '../../types';
import { X, FileText, FilePlus2, Sparkles, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';

/** What the user picked as the starting point for the new app. */
type Selection =
  | { kind: 'blank' }
  | { kind: 'built_in'; key: string }
  | { kind: 'mine'; id: string };

interface Props {
  onClose: () => void;
  /** Called with the freshly created draft app (caller navigates to the builder). */
  onCreated: (app: App) => void;
  /** Called with the server's message when the plan's app limit is hit (402). */
  onLimit: (reason: string) => void;
}

export default function TemplatePickerModal({ onClose, onCreated, onLimit }: Props) {
  const [templates, setTemplates] = useState<AppTemplatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'blank' });
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    api.getAppTemplates()
      .then(setTemplates)
      .catch((err: any) => setLoadError(err.message || 'Failed to load templates'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const select = (sel: Selection, templateName?: string) => {
    setSelection(sel);
    // Prefill the app name from the template until the user types their own.
    if (!nameTouched) setName(sel.kind === 'blank' ? '' : (templateName || ''));
  };

  const isSelected = (sel: Selection) => {
    if (selection.kind !== sel.kind) return false;
    if (sel.kind === 'built_in') return (selection as { key: string }).key === sel.key;
    if (sel.kind === 'mine') return (selection as { id: string }).id === sel.id;
    return true;
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      let app: App;
      if (selection.kind === 'blank') {
        app = await api.createApp({ name: trimmed, description });
      } else if (selection.kind === 'built_in') {
        app = await api.createAppFromTemplate({ built_in_key: selection.key, name: trimmed });
      } else {
        app = await api.createAppFromTemplate({ template_id: selection.id, name: trimmed });
      }
      onCreated(app);
    } catch (err: any) {
      if (err.status === 402) onLimit(err.message);
      else alert(err.message || 'Failed to create app');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this template? Apps already created from it are unaffected.')) return;
    setDeletingId(id);
    try {
      await api.deleteAppTemplate(id);
      setTemplates(t => t ? { ...t, mine: t.mine.filter(m => m.id !== id) } : t);
      if (selection.kind === 'mine' && selection.id === id) setSelection({ kind: 'blank' });
    } catch (err: any) {
      alert(err.message || 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  const cardClass = (selected: boolean) =>
    `w-full text-left border rounded-xl p-4 transition-all cursor-pointer ${
      selected ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50/50' : 'border-gray-200 hover:border-gray-300 hover:shadow-sm bg-white'
    }`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Create New App</h2>
            <p className="text-sm text-gray-500">Start from scratch or from a template</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 overflow-y-auto flex-1 space-y-5 pb-2">
          {/* Blank */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Blank</h3>
            <button className={cardClass(isSelected({ kind: 'blank' }))} onClick={() => select({ kind: 'blank' })}>
              <div className="flex items-center gap-2">
                <FilePlus2 size={16} className="text-gray-400" />
                <span className="font-semibold text-gray-900 text-sm">Blank App</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Start with a single empty step and build from scratch.</p>
            </button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-20 rounded-xl animate-pulse bg-gray-100" />)}
            </div>
          ) : loadError ? (
            <div className="text-center py-6">
              <AlertTriangle size={24} className="mx-auto mb-2 text-red-400" />
              <p className="text-sm text-gray-500">{loadError}</p>
              <button onClick={load} className="btn-secondary mt-3 mx-auto">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : templates && (
            <>
              {/* Built-in model templates */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Model templates</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {templates.built_in.map(t => (
                    <button
                      key={t.key}
                      className={cardClass(isSelected({ kind: 'built_in', key: t.key }))}
                      onClick={() => select({ kind: 'built_in', key: t.key }, t.name)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{t.name}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                          <Sparkles size={9} /> HartMonitor
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</p>
                      <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                        <FileText size={11} /> {t.step_count} {t.step_count === 1 ? 'step' : 'steps'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* My templates */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">My templates</h3>
                {templates.mine.length === 0 ? (
                  <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl p-4">
                    No saved templates yet — open an app's menu and choose "Save as template" to add one.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {templates.mine.map(t => (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        className={`relative ${cardClass(isSelected({ kind: 'mine', id: t.id }))}`}
                        onClick={() => select({ kind: 'mine', id: t.id }, t.name)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') select({ kind: 'mine', id: t.id }, t.name); }}
                      >
                        <span className="font-semibold text-gray-900 text-sm block pr-7">{t.name}</span>
                        {t.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{t.description}</p>}
                        <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                          <FileText size={11} /> {t.step_count} {t.step_count === 1 ? 'step' : 'steps'}
                        </p>
                        <button
                          title="Delete template"
                          disabled={deletingId === t.id}
                          onClick={e => { e.stopPropagation(); handleDeleteTemplate(t.id); }}
                          className="absolute top-3 right-3 p-1 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Name + actions */}
        <div className="px-6 py-4 border-t border-gray-100 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">App Name *</label>
            <input
              className="input-field"
              placeholder="e.g. PCB Assembly Process"
              value={name}
              onChange={e => { setName(e.target.value); setNameTouched(true); }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          {selection.kind === 'blank' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                className="input-field resize-none"
                rows={2}
                placeholder="Brief description of this process..."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button onClick={handleCreate} disabled={!name.trim() || creating} className="btn-primary flex-1">
              {creating ? 'Creating…' : 'Create & Edit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
