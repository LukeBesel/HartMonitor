import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Station, App, Department } from '../types';
import { Plus, Trash2, Monitor, Edit3, X, Check, Play, MapPin, Activity } from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';
import { useSite } from '../context/SiteContext';

const STATUS_COLORS: Record<Station['status'], string> = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  maintenance: 'bg-yellow-100 text-yellow-700',
};

export default function Stations() {
  const { selectedSiteId } = useSite();
  const [stations, setStations] = useState<Station[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', location: '', department_id: '' });
  const [editForm, setEditForm] = useState<Partial<Station>>({});

  const load = () => {
    const siteParams = { site_id: selectedSiteId || undefined };
    return Promise.all([api.getStations(siteParams), api.getApps(), api.getDepartments(siteParams)]).then(([s, a, d]) => {
      setStations(s);
      setApps(a.filter((a: App) => a.status === 'published'));
      setDepartments(d);
    });
  };

  useEffect(() => { load(); }, [selectedSiteId]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await api.createStation({ ...form, department_id: form.department_id || null });
    setShowCreate(false);
    setForm({ name: '', description: '', location: '', department_id: '' });
    load();
  };

  const handleEdit = (station: Station) => {
    setEditingId(station.id);
    setEditForm({ name: station.name, description: station.description, location: station.location, status: station.status, current_app_id: station.current_app_id, department_id: station.department_id });
  };

  const handleSaveEdit = async (id: string) => {
    await api.updateStation(id, editForm);
    setEditingId(null);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this station?')) return;
    await api.deleteStation(id);
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <ModuleOnboarding
        moduleId="stations"
        title="Stations"
        description="Stations are your physical workstations linked to apps. Configure each station's ideal cycle time and shift hours."
        steps={[
          "Create a station for each physical workstation",
          "Assign an app to define what operators see",
          "Set ideal cycle time for OEE tracking",
          "Monitor status from Plant View or Command Center",
        ]}
        icon={Monitor}
        color="#f59e0b"
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stations</h1>
          <p className="text-gray-500 text-sm mt-0.5">Physical workstations and kiosks running apps</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> New Station
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1.5 text-green-600"><Activity size={13} />{stations.filter(s => s.status === 'active').length} active</span>
        <span className="text-gray-400">{stations.filter(s => s.status === 'inactive').length} inactive</span>
        <span className="text-yellow-600">{stations.filter(s => s.status === 'maintenance').length} maintenance</span>
      </div>

      {stations.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Monitor size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No stations yet</p>
          <p className="text-sm">Create workstations to deploy apps to the shop floor</p>
          <button onClick={() => setShowCreate(true)} className="btn-primary mt-4"><Plus size={14} /> Add Station</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stations.map(station => {
            const assignedApp = apps.find(a => a.id === station.current_app_id);
            const isEditing = editingId === station.id;

            return (
              <div key={station.id} className="card p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      station.status === 'active' ? 'bg-green-50' : station.status === 'maintenance' ? 'bg-yellow-50' : 'bg-gray-50'
                    }`}>
                      <Monitor size={18} className={
                        station.status === 'active' ? 'text-green-600' : station.status === 'maintenance' ? 'text-yellow-600' : 'text-gray-400'
                      } />
                    </div>
                    <div>
                      {isEditing ? (
                        <input className="input-field py-1 text-sm font-semibold" value={editForm.name || ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      ) : (
                        <Link to={`/stations/${station.id}`} className="font-semibold text-gray-900 hover:text-blue-600 transition-colors">{station.name}</Link>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[station.status]}`}>
                          {station.status}
                        </span>
                        {station.department_name && !isEditing && (
                          <span className="inline-flex text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: (station.department_color || '#6b7280') + '22', color: station.department_color || '#6b7280' }}>
                            {station.department_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={() => handleSaveEdit(station.id)} className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700"><Check size={13} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"><X size={13} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => handleEdit(station)} className="p-1.5 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600"><Edit3 size={13} /></button>
                        <button onClick={() => handleDelete(station.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <input className="input-field text-sm" placeholder="Description" value={editForm.description || ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                    <input className="input-field text-sm" placeholder="Location" value={editForm.location || ''} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} />
                    <select className="input-field text-sm w-full" value={editForm.department_id || ''} onChange={e => setEditForm(f => ({ ...f, department_id: e.target.value || null }))}>
                      <option value="">No department</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <select className="input-field text-sm flex-1" value={editForm.status || 'active'} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as Station['status'] }))}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                      <select className="input-field text-sm flex-1" value={editForm.current_app_id || ''} onChange={e => setEditForm(f => ({ ...f, current_app_id: e.target.value || null }))}>
                        <option value="">No app assigned</option>
                        {apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {station.description && <p className="text-sm text-gray-600">{station.description}</p>}
                    {station.location && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <MapPin size={11} /> {station.location}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-400">{station.completion_count} total completions</div>
                    </div>
                  </div>
                )}

                {/* Assigned app */}
                <div className="pt-3 border-t border-gray-100">
                  {assignedApp ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-gray-500 mb-0.5">Assigned App</div>
                        <div className="text-sm font-medium text-gray-800">{assignedApp.name}</div>
                      </div>
                      <Link
                        to={`/play/${assignedApp.id}?station=${station.id}`}
                        target="_blank"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                      >
                        <Play size={11} /> Launch
                      </Link>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 italic">No app assigned</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">New Station</h2>
              <button onClick={() => setShowCreate(false)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input className="input-field" placeholder="e.g. Assembly Station A1" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input className="input-field" placeholder="What happens at this station?" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input className="input-field" placeholder="e.g. Building A, Floor 2" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select className="input-field" value={form.department_id} onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}>
                  <option value="">No department</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 p-5 border-t border-gray-200">
              <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCreate} disabled={!form.name.trim()} className="btn-primary flex-1">Create Station</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
