import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { App } from '../types';
import {
  Plus, Play, Edit3, Trash2, Search, CheckCircle,
  Clock, FileText, MoreVertical, Globe, Lock, Copy, Download, RefreshCw, Database, AppWindow
} from 'lucide-react';
import UpgradeModal from '../components/shared/UpgradeModal';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';

export default function AppsLibrary() {
  const [apps, setApps] = useState<App[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newApp, setNewApp] = useState({ name: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [limitReason, setLimitReason] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const { refresh: refreshPlan } = usePlan();
  const { isAtLeast, canEdit } = useAuth();
  const navigate = useNavigate();

  const load = () => api.getApps().then(setApps).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newApp.name.trim()) return;
    try {
      const app = await api.createApp(newApp);
      setShowCreate(false);
      setNewApp({ name: '', description: '' });
      refreshPlan();
      navigate(`/apps/${app.id}/build`);
    } catch (err: any) {
      if (err.status === 402) {
        setShowCreate(false);
        setLimitReason(err.message);
      } else {
        alert(err.message || 'Failed to create app');
      }
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm('Delete this app and all its data?')) return;
    await api.deleteApp(id);
    load();
  };

  const handlePublish = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    await api.publishApp(id);
    load();
  };

  const handleLoadSampleData = async () => {
    setLoadingSample(true);
    setSampleError('');
    try {
      await api.loadSampleData();
      load();
    } catch (err: any) {
      setSampleError(err?.message || 'Failed to load sample data');
    } finally {
      setLoadingSample(false);
    }
  };

  const filtered = apps.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <ModuleOnboarding
        moduleId="apps"
        title="App Library"
        description="Apps are digital work instructions and data-collection forms. Build them once, run them on any station."
        steps={[
          "Browse published apps in the library",
          "Click an app to preview its steps",
          "Use App Builder to create or edit apps",
          "Publish when ready — operators see it instantly",
        ]}
        icon={AppWindow}
        color="#8b5cf6"
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">App Library</h1>
          <p className="text-gray-500 text-sm mt-0.5">Build and manage manufacturing process apps</p>
        </div>
        {canEdit && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} />
            New App
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input-field pl-9 max-w-sm"
          placeholder="Search apps..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-sm text-gray-500">
        <span>{apps.length} total</span>
        <span className="text-green-600 font-medium">{apps.filter(a => a.status === 'published').length} published</span>
        <span className="text-yellow-600 font-medium">{apps.filter(a => a.status === 'draft').length} drafts</span>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="card h-48 animate-pulse bg-gray-100" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No apps found</p>
          <p className="text-sm">Create your first manufacturing app to get started</p>
          {canEdit && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                <Plus size={14} /> Create App
              </button>
              {isAtLeast('manager') && (
                <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-secondary">
                  {loadingSample ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                  Load Sample Data
                </button>
              )}
            </div>
          )}
          {sampleError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3 max-w-sm mx-auto">{sampleError}</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(app => (
            <AppCard
              key={app.id}
              app={app}
              canEdit={canEdit}
              onDelete={handleDelete}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Create New App</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">App Name *</label>
                <input
                  className="input-field"
                  placeholder="e.g. PCB Assembly Process"
                  value={newApp.name}
                  onChange={e => setNewApp(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  className="input-field resize-none"
                  rows={3}
                  placeholder="Brief description of this process..."
                  value={newApp.description}
                  onChange={e => setNewApp(p => ({ ...p, description: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCreate} disabled={!newApp.name.trim()} className="btn-primary flex-1">
                Create & Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {limitReason && (
        <UpgradeModal
          feature="app"
          reason={limitReason}
          onClose={() => setLimitReason(null)}
          onPurchased={() => setShowCreate(true)}
        />
      )}
    </div>
  );
}

function AppCard({ app, canEdit, onDelete, onPublish }: { app: App; canEdit: boolean; onDelete: any; onPublish: any }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async (e: React.MouseEvent, kind: 'completions' | 'bundle') => {
    e.preventDefault();
    setMenuOpen(false);
    setExporting(true);
    try {
      if (kind === 'completions') await api.downloadAppCompletions(app.id);
      else await api.downloadAppBundle(app.id);
    } catch (err: any) {
      alert(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              app.status === 'published'
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {app.status === 'published' ? <Globe size={10} /> : <Lock size={10} />}
              {app.status}
            </span>
          </div>
          <h3 className="font-semibold text-gray-900 mt-1.5 truncate">{app.name}</h3>
          {app.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{app.description}</p>
          )}
        </div>
        <div className="relative ml-2">
          <button
            onClick={e => { e.preventDefault(); setMenuOpen(!menuOpen); }}
            className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1 w-48">
              {canEdit && app.status === 'draft' && (
                <button
                  onClick={e => { setMenuOpen(false); onPublish(app.id, e); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 w-full text-green-600"
                >
                  <Globe size={13} /> Publish
                </button>
              )}
              <button
                onClick={e => handleExport(e, 'completions')}
                disabled={exporting}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 w-full text-gray-700 disabled:opacity-50"
              >
                <Download size={13} /> Export completions (CSV)
              </button>
              <button
                onClick={e => handleExport(e, 'bundle')}
                disabled={exporting}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 w-full text-gray-700 disabled:opacity-50"
              >
                <Download size={13} /> Export app bundle (JSON)
              </button>
              {canEdit && (
                <button
                  onClick={e => { setMenuOpen(false); onDelete(app.id, e); }}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 w-full text-red-600"
                >
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><FileText size={12} />{app.steps.length} steps</span>
        <span>Updated {new Date(app.updated_at).toLocaleDateString()}</span>
      </div>

      <div className="flex gap-2 mt-auto pt-2 border-t border-gray-100">
        {canEdit && (
          <Link
            to={`/apps/${app.id}/build`}
            className="btn-secondary flex-1 justify-center text-xs"
          >
            <Edit3 size={12} /> Edit
          </Link>
        )}
        {app.status === 'published' && (
          <Link
            to={`/play/${app.id}`}
            className="btn-primary flex-1 justify-center text-xs"
          >
            <Play size={12} /> Run
          </Link>
        )}
      </div>
    </div>
  );
}
