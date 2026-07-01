import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import { Dashboard } from '../types';
import { LayoutGrid, Plus, Trash2, Edit, Clock, BarChart3, RefreshCw, Database, AlertTriangle } from 'lucide-react';
import UpgradeModal from '../components/shared/UpgradeModal';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { usePlan } from '../context/PlanContext';
import { useAuth } from '../context/AuthContext';

export default function Dashboards() {
  const navigate = useNavigate();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [limitReason, setLimitReason] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState('');
  const [loadError, setLoadError] = useState('');
  const { refresh: refreshPlan } = usePlan();
  const { isAtLeast, canEdit } = useAuth();

  const load = () => {
    setLoading(true);
    api.getDashboards()
      .then(d => { setDashboards(d); setLoadError(''); })
      .catch((err: any) => setLoadError(err?.message || 'Failed to load dashboards'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const d = await api.createDashboard({ name: newName.trim(), description: newDesc.trim(), cards: [] });
      refreshPlan();
      navigate(`/dashboards/${d.id}/edit`);
    } catch (err: any) {
      if (err.status === 402) {
        setCreating(false);
        setLimitReason(err.message);
      } else {
        alert(err.message || 'Failed to create dashboard');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete dashboard "${name}"?`)) return;
    try {
      await api.deleteDashboard(id);
      setDashboards(prev => prev.filter(d => d.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to delete dashboard');
    }
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

  const CARD_ICONS: Record<string, any> = {
    'metric': '📊', 'time_series': '📈', 'distribution': '🥧',
    'leaderboard': '🏆', 'wo_status': '📋', 'table': '📄',
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      <ModuleOnboarding
        moduleId="dashboards"
        title="Dashboards"
        description="Dashboards are customizable views built from live data widgets."
        steps={[
          "Click + to create a new dashboard",
          "Add widgets: charts, KPIs, tables, status cards",
          "Drag to arrange the layout",
          "Share the URL with managers or display on a TV",
        ]}
        icon={LayoutGrid}
        color="#ec4899"
      />
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Dashboards</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Build custom analytics dashboards from your production data</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary"
          >
            <Plus size={16} /> New Dashboard
          </button>
        )}
      </div>

      {/* Create form */}
      {canEdit && creating && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
          <div className="text-sm font-semibold text-gray-900">Create New Dashboard</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dashboard Name *</label>
              <input className="input-field" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Production Overview, Quality Report..." autoFocus
                onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input className="input-field" value={newDesc} onChange={e => setNewDesc(e.target.value)}
                placeholder="Optional description..." />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCreate} disabled={!newName.trim() || saving} className="btn-primary text-sm">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
              Create & Edit
            </button>
            <button onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }} className="btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 shadow-sm h-40 animate-pulse" />
          ))}
        </div>
      ) : loadError && dashboards.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={40} className="text-red-400" />
          <div>
            <p className="font-medium text-gray-500">Couldn't load dashboards</p>
            <p className="text-sm text-gray-400 mt-1">{loadError}</p>
          </div>
          <button className="btn-secondary" onClick={load}>Retry</button>
        </div>
      ) : dashboards.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 text-center">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-200" />
          <div className="text-gray-500 font-medium">No dashboards yet</div>
          <p className="text-gray-400 text-sm mt-1">Create your first custom analytics dashboard</p>
          {canEdit && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button onClick={() => setCreating(true)} className="btn-primary">
                <Plus size={16} /> Create Dashboard
              </button>
              {isAtLeast('manager') && (
                <button onClick={handleLoadSampleData} disabled={loadingSample} className="btn-secondary">
                  {loadingSample ? <RefreshCw size={16} className="animate-spin" /> : <Database size={16} />}
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
          {dashboards.map(d => {
            const cards = d.cards ?? [];
            const updated = new Date(d.updated_at);
            return (
            <div key={d.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all group">
              <Link to={`/dashboards/${d.id}`} className="block p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
                    <LayoutGrid size={18} />
                  </div>
                  <span className="text-xs text-gray-400 font-mono">{cards.length} card{cards.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="font-bold text-gray-900 text-base leading-tight">{d.name}</div>
                {d.description && <div className="text-gray-500 text-xs mt-1 line-clamp-2">{d.description}</div>}
                {cards.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {[...new Set(cards.map(c => c.type))].slice(0, 4).map(t => (
                      <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {CARD_ICONS[t]} {t.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1 text-xs text-gray-400 mt-3">
                  <Clock size={11} />
                  Updated {isNaN(updated.getTime()) ? '—' : updated.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </div>
              </Link>
              {canEdit && (
                <div className="border-t border-gray-100 px-4 py-2.5 flex items-center justify-end gap-1">
                  <Link
                    to={`/dashboards/${d.id}/edit`}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <Edit size={12} /> Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(d.id, d.name)}
                    className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {limitReason && (
        <UpgradeModal
          feature="dashboard"
          reason={limitReason}
          onClose={() => setLimitReason(null)}
          onPurchased={() => setCreating(true)}
        />
      )}
    </div>
  );
}
