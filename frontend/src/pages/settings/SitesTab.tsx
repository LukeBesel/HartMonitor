// ─── Sites, departments, work stations and shifts ───────────────────────────
import Toggle from '../../components/shared/Toggle';
import { useState, useEffect, useRef } from 'react';
import { Building2, Plus, Trash2, Edit2, X, ChevronRight, MapPin, Network, Code, Cpu } from 'lucide-react';
import { api } from '../../api/client';
import type { Site } from '../../types';
import { Toast, timeZoneOptions } from './shared';

// ─── Tab 7: Sites ─────────────────────────────────────────────────────────────

interface SiteForm {
  name: string;
  code: string;
  address: string;
  timezone: string;
  is_primary: boolean;
}

const DEFAULT_SITE_FORM: SiteForm = {
  name: '',
  code: '',
  address: '',
  timezone: 'America/New_York',
  is_primary: false,
};

function SiteModal({ site, onClose, onSaved, onError }: {
  site: Site | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const isEdit = !!site;
  const [form, setForm] = useState<SiteForm>(() => site ? {
    name: site.name ?? '',
    code: site.code ?? '',
    address: site.address ?? '',
    timezone: site.timezone || 'America/New_York',
    is_primary: !!site.is_primary,
  } : DEFAULT_SITE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof SiteForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) { setError('Site name is required'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateSite(site!.id, {
          name: form.name,
          code: form.code,
          address: form.address,
          timezone: form.timezone,
          ...(form.is_primary ? { is_primary: 1 } : {}),
        });
        onSaved('Site updated');
      } else {
        await api.createSite({ name: form.name, code: form.code, address: form.address, timezone: form.timezone });
        onSaved('Site created');
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save site');
      onError(err.message || 'Failed to save site');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit Site' : 'Add Site'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
            <input className="input-field w-full" value={form.name} onChange={set('name')} required placeholder="Main Plant" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
            <input className="input-field w-full" value={form.code} onChange={set('code')} placeholder="MAIN" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <textarea className="input-field w-full resize-none" rows={2} value={form.address} onChange={set('address')} placeholder="123 Main St, Springfield, IL 62701" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Timezone</label>
            <select className="input-field w-full" value={form.timezone} onChange={set('timezone')}>
              {timeZoneOptions(form.timezone).map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          {isEdit && !site!.is_primary && (
            <div className="flex items-center justify-between py-1">
              <div>
                <div className="text-sm font-medium text-gray-800">Set as primary site</div>
                <div className="text-xs text-gray-500 mt-0.5">The primary site is the default for company-wide views</div>
              </div>
              <Toggle checked={form.is_primary} onChange={(v) => setForm(f => ({ ...f, is_primary: v }))} />
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Site'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SitesTab() {
  const [sites, setSites] = useState<Site[]>([]);
  const [depts, setDepts] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingStations, setLoadingStations] = useState(false);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [selectedDept, setSelectedDept] = useState<any | null>(null);
  const [modalSite, setModalSite] = useState<Site | null | false>(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [addingDept, setAddingDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [savingDept, setSavingDept] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [newStationName, setNewStationName] = useState('');
  const [savingStation, setSavingStation] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const loadSites = (keepSelected?: boolean) => {
    setLoadingSites(true);
    api.getSites()
      .then(data => {
        setSites(data);
        if (!keepSelected) {
          const primary = data.find((s: Site) => s.is_primary) ?? data[0];
          if (primary) { setSelectedSite(primary); loadDepts(primary.id); }
        } else if (selectedSite) {
          const refreshed = data.find((s: Site) => s.id === selectedSite.id);
          if (refreshed) setSelectedSite(refreshed);
        }
      })
      .catch(() => setSites([]))
      .finally(() => setLoadingSites(false));
  };

  const loadDepts = (siteId: string) => {
    setLoadingDepts(true);
    api.getDepartments({ site_id: siteId })
      .then(setDepts)
      .catch(() => setDepts([]))
      .finally(() => setLoadingDepts(false));
  };

  const loadStations = (deptId: string) => {
    setLoadingStations(true);
    api.getStations({ department_id: deptId })
      .then(setStations)
      .catch(() => setStations([]))
      .finally(() => setLoadingStations(false));
  };

  useEffect(() => { loadSites(); }, []);

  const handleSelectSite = (site: Site) => {
    setSelectedSite(site);
    setSelectedDept(null);
    setStations([]);
    setAddingDept(false);
    setAddingStation(false);
    loadDepts(site.id);
  };

  const handleSelectDept = (dept: any) => {
    setSelectedDept(dept);
    setAddingStation(false);
    loadStations(dept.id);
  };

  const handleAddDept = async () => {
    if (!newDeptName.trim() || !selectedSite) return;
    setSavingDept(true);
    try {
      await api.createDepartment({ name: newDeptName.trim(), site_id: selectedSite.id });
      setNewDeptName(''); setAddingDept(false);
      loadDepts(selectedSite.id);
    } catch (err: any) { showToast(err.message || 'Failed to add department', 'error'); }
    finally { setSavingDept(false); }
  };

  const handleDeleteDept = async (id: string, name: string) => {
    if (!confirm(`Delete department "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.deleteDepartment(id);
      if (selectedDept?.id === id) { setSelectedDept(null); setStations([]); }
      if (selectedSite) loadDepts(selectedSite.id);
    } catch (err: any) { showToast(err.message || 'Failed to delete department', 'error'); }
    finally { setDeletingId(null); }
  };

  const handleAddStation = async () => {
    if (!newStationName.trim() || !selectedDept) return;
    setSavingStation(true);
    try {
      await api.createStation({ name: newStationName.trim(), department_id: selectedDept.id, site_id: selectedSite!.id });
      setNewStationName(''); setAddingStation(false);
      loadStations(selectedDept.id);
    } catch (err: any) { showToast(err.message || 'Failed to add workstation', 'error'); }
    finally { setSavingStation(false); }
  };

  const handleDeleteStation = async (id: string, name: string) => {
    if (!confirm(`Delete workstation "${name}"?`)) return;
    setDeletingId(id);
    try {
      await api.deleteStation(id);
      if (selectedDept) loadStations(selectedDept.id);
    } catch (err: any) { showToast(err.message || 'Failed to delete workstation', 'error'); }
    finally { setDeletingId(null); }
  };

  const handleDeleteSite = async (site: Site) => {
    if (!confirm(`Delete site "${site.name}"? This cannot be undone.`)) return;
    setDeletingId(site.id);
    try {
      await api.deleteSite(site.id);
      showToast(`Site "${site.name}" deleted`);
      if (selectedSite?.id === site.id) { setSelectedSite(null); setDepts([]); setStations([]); }
      loadSites(true);
    } catch (err: any) { showToast(err.message || 'Failed to delete site', 'error'); }
    finally { setDeletingId(null); }
  };

  const colCls = 'flex flex-col border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm';
  const headCls = 'flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100 flex-shrink-0';
  const emptyCls = 'p-6 text-center text-xs text-gray-400 flex flex-col items-center gap-2 flex-1 justify-center';

  return (
    <div className="max-w-5xl space-y-4">
      <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3.5 flex items-start gap-2.5">
        <Network size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-gray-600 leading-relaxed">
          <span className="font-semibold text-gray-800">Build your facility hierarchy here.</span>
          {' '}Click a <span className="font-medium text-gray-700">Site</span> to see its departments,
          then click a <span className="font-medium text-gray-700">Department</span> to manage its workstations.
          Apps and work orders are then assigned to these.
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" style={{ height: 500 }}>
        {/* Column 1: Sites */}
        <div className={colCls}>
          <div className={headCls}>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sites</span>
            <button onClick={() => setModalSite(null)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              <Plus size={11} /> Add
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingSites ? (
              <div className={emptyCls}>Loading…</div>
            ) : sites.length === 0 ? (
              <div className={emptyCls}>
                <MapPin size={22} className="text-gray-200" />
                Add your first site to get started
              </div>
            ) : sites.map(site => (
              <button
                key={site.id}
                onClick={() => handleSelectSite(site)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-50 transition-colors group ${
                  selectedSite?.id === site.id ? 'bg-[var(--accent)] text-white' : 'hover:bg-gray-50'
                }`}
              >
                <MapPin size={13} className="flex-shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{site.name}</div>
                  <div className={`text-[10px] truncate ${selectedSite?.id === site.id ? 'text-white/70' : 'text-gray-400'}`}>
                    {site.code ? `${site.code} · ` : ''}{site.department_count ?? 0} dept{(site.department_count ?? 0) !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!!site.is_primary && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full mr-1 ${selectedSite?.id === site.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>
                      PRIMARY
                    </span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); setModalSite(site); }}
                    className={`p-1 rounded ${selectedSite?.id === site.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                  >
                    <Edit2 size={11} />
                  </button>
                  {!site.is_primary && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteSite(site); }}
                      disabled={deletingId === site.id}
                      className={`p-1 rounded ${selectedSite?.id === site.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                {!!site.is_primary && selectedSite?.id !== site.id && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 flex-shrink-0 group-hover:hidden">
                    PRIMARY
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Column 2: Departments */}
        <div className={colCls}>
          <div className={headCls}>
            <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">Departments</span>
              {selectedSite && <span className="text-xs text-gray-400 truncate">· {selectedSite.name}</span>}
            </div>
            {selectedSite && (
              <button onClick={() => setAddingDept(a => !a)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0 ml-2">
                <Plus size={11} /> Add
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedSite ? (
              <div className={emptyCls}>
                <ChevronRight size={22} className="text-gray-200" />
                Select a site first
              </div>
            ) : loadingDepts ? (
              <div className={emptyCls}>Loading…</div>
            ) : depts.length === 0 && !addingDept ? (
              <div className={emptyCls}>
                <Building2 size={22} className="text-gray-200" />
                No departments yet — click Add
              </div>
            ) : depts.map(dept => (
              <button
                key={dept.id}
                onClick={() => handleSelectDept(dept)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-gray-50 transition-colors group ${
                  selectedDept?.id === dept.id ? 'bg-[var(--accent)] text-white' : 'hover:bg-gray-50'
                }`}
              >
                <Building2 size={13} className="flex-shrink-0 opacity-70" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{dept.name}</div>
                  {dept.description && (
                    <div className={`text-[10px] truncate ${selectedDept?.id === dept.id ? 'text-white/70' : 'text-gray-400'}`}>{dept.description}</div>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); handleDeleteDept(dept.id, dept.name); }}
                  disabled={deletingId === dept.id}
                  className={`p-1 rounded flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${
                    selectedDept?.id === dept.id ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                >
                  <Trash2 size={11} />
                </button>
              </button>
            ))}
          </div>
          {selectedSite && addingDept && (
            <div className="border-t border-gray-100 p-2.5 flex-shrink-0 space-y-1.5">
              <input
                className="input-field w-full text-xs"
                placeholder="Department name (e.g. Assembly)"
                value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddDept(); if (e.key === 'Escape') setAddingDept(false); }}
              />
              <div className="flex gap-1.5">
                <button onClick={handleAddDept} disabled={!newDeptName.trim() || savingDept} className="btn-primary text-xs py-1 px-3 flex-1">
                  {savingDept ? 'Saving…' : 'Add Department'}
                </button>
                <button onClick={() => { setAddingDept(false); setNewDeptName(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕</button>
              </div>
            </div>
          )}
        </div>

        {/* Column 3: Workstations */}
        <div className={colCls}>
          <div className={headCls}>
            <div className="min-w-0 flex items-center gap-1.5 overflow-hidden">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">Workstations</span>
              {selectedDept && <span className="text-xs text-gray-400 truncate">· {selectedDept.name}</span>}
            </div>
            {selectedDept && (
              <button onClick={() => setAddingStation(a => !a)} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 flex-shrink-0 ml-2">
                <Plus size={11} /> Add
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {!selectedDept ? (
              <div className={emptyCls}>
                <Cpu size={22} className="text-gray-200" />
                Select a department first
              </div>
            ) : loadingStations ? (
              <div className={emptyCls}>Loading…</div>
            ) : stations.length === 0 && !addingStation ? (
              <div className={emptyCls}>
                <Cpu size={22} className="text-gray-200" />
                No workstations yet — click Add
              </div>
            ) : stations.map(s => (
              <div key={s.id} className="flex items-center justify-between px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 group">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Cpu size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="text-sm text-gray-700 font-medium truncate">{s.name}</span>
                </div>
                <button
                  onClick={() => handleDeleteStation(s.id, s.name)}
                  disabled={deletingId === s.id}
                  className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          {selectedDept && addingStation && (
            <div className="border-t border-gray-100 p-2.5 flex-shrink-0 space-y-1.5">
              <input
                className="input-field w-full text-xs"
                placeholder="Workstation name (e.g. Station A-1)"
                value={newStationName}
                onChange={e => setNewStationName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddStation(); if (e.key === 'Escape') setAddingStation(false); }}
              />
              <div className="flex gap-1.5">
                <button onClick={handleAddStation} disabled={!newStationName.trim() || savingStation} className="btn-primary text-xs py-1 px-3 flex-1">
                  {savingStation ? 'Saving…' : 'Add Workstation'}
                </button>
                <button onClick={() => { setAddingStation(false); setNewStationName(''); }} className="text-xs text-gray-400 hover:text-gray-600 px-2">✕</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalSite !== false && (
        <SiteModal
          site={modalSite}
          onClose={() => setModalSite(false)}
          onSaved={(msg) => { showToast(msg); loadSites(true); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
