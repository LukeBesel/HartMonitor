import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network, Building2, Layers, Monitor, ClipboardList, ChevronRight,
  ArrowLeft, MapPin, RefreshCw, AlertTriangle,
  Clock, Plus, Pencil, Trash2, X, Check,
} from 'lucide-react';
import { api } from '../api/client';
import type { SiteShiftInput } from '../api/client';
import { usePlan } from '../context/PlanContext';
import { useToast } from '../context/ToastContext';
import { timeAgo } from '../utils/time';
import { runStatusLabel } from '../utils/runStatus';
import { DAY_LETTERS, formatShiftRange, parseDays } from '../utils/shifts';
import type { SiteShift } from '../utils/shifts';

// Enterprise multi-level drill-down:
//   Facility (site) → Department → Station → Operations (completions)
// Reuses the existing sites / departments / stations / completions data so there
// are no schema changes — it's a roll-up view for multi-facility operators.

type Level = 'facilities' | 'departments' | 'workcenters' | 'operations';

interface Crumb { level: Level; id: string | null; label: string; }

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number | string; color: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <Icon size={14} style={{ color }} />
      <span className="font-semibold text-gray-700">{value}</span>
      <span>{label}</span>
    </div>
  );
}

export default function Facilities() {
  const navigate = useNavigate();
  const { isEnterprise } = usePlan();

  const [trail, setTrail] = useState<Crumb[]>([{ level: 'facilities', id: null, label: 'All Facilities' }]);
  const current = trail[trail.length - 1];

  const [sites, setSites] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteId = useMemo(() => trail.find(c => c.level === 'departments')?.id ?? null, [trail]);
  const deptId = useMemo(() => trail.find(c => c.level === 'workcenters')?.id ?? null, [trail]);
  const stationId = useMemo(() => trail.find(c => c.level === 'operations')?.id ?? null, [trail]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (current.level === 'facilities') {
        const s = await api.getSites();
        setSites(Array.isArray(s) ? s : []);
      } else if (current.level === 'departments') {
        const d = await api.getDepartments(siteId ? { site_id: siteId } : undefined);
        setDepartments(Array.isArray(d) ? d : []);
      } else if (current.level === 'workcenters') {
        const all = await api.getStations(siteId ? { site_id: siteId } : undefined);
        const list = Array.isArray(all) ? all : [];
        setStations(deptId ? list.filter(s => s.department_id === deptId) : list);
      } else if (current.level === 'operations') {
        const all = await api.getCompletions({ limit: 200 });
        setOperations((Array.isArray(all) ? all : []).filter((c: any) => c.station_id === stationId));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [trail]);

  const drill = (level: Level, id: string, label: string) => {
    setTrail(t => [...t, { level, id, label }]);
  };
  const jumpTo = (index: number) => {
    setTrail(t => t.slice(0, index + 1));
  };

  if (!isEnterprise) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Network size={26} className="text-amber-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Facilities is an Enterprise feature</h1>
          <p className="text-gray-500 mt-2 max-w-md mx-auto text-sm">
            Roll up multiple facilities and drill down into departments, stations, and
            individual operations from one place. Upgrade to Enterprise to unlock it.
          </p>
          <button onClick={() => navigate('/settings?tab=plan')} className="btn-primary mt-5">
            View Enterprise plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 flex items-center justify-center flex-shrink-0">
            <Network size={18} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">Facilities</h1>
            <p className="text-xs text-gray-500 hidden sm:block">Drill from facility to department to station to operations</p>
          </div>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-1.5 flex-shrink-0" title="Refresh">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap text-sm mt-3 mb-4">
        {trail.length > 1 && (
          <button onClick={() => jumpTo(trail.length - 2)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 mr-1">
            <ArrowLeft size={15} />
          </button>
        )}
        {trail.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="text-gray-300" />}
            <button
              onClick={() => jumpTo(i)}
              className={`px-1.5 py-0.5 rounded-md ${i === trail.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'}`}
            >
              {c.label}
            </button>
          </span>
        ))}
      </div>

      {loading && (
        <div className="py-16 flex justify-center">
          <div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && error && (
        <div className="py-16 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={28} className="text-red-400" />
          <p className="text-gray-500 font-medium text-sm">Couldn't load this view</p>
          <p className="text-xs text-gray-400">{error}</p>
          <button onClick={load} className="btn-secondary">
            <RefreshCw size={14} /> Retry
          </button>
        </div>
      )}

      {!loading && !error && current.level === 'facilities' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sites.length === 0 && <Empty label="No facilities yet. Add sites in Settings." />}
          {sites.map(s => (
            <div
              key={s.id}
              className="bg-white rounded-2xl border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all flex flex-col"
            >
              <button
                onClick={() => drill('departments', s.id, s.name)}
                className="text-left p-4 w-full"
              >
                <div className="flex items-center justify-between">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                    <Building2 size={18} className="text-blue-600" />
                  </div>
                  {s.is_primary ? <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Primary</span> : null}
                </div>
                <div className="mt-3 font-semibold text-gray-900">{s.name}</div>
                {s.code && <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><MapPin size={11} />{s.code}</div>}
                <div className="mt-3 space-y-1">
                  {/* "assigned" matters: departments and stations can exist
                      company-wide without being tied to a facility, so a 0 here
                      means "none assigned to this site", not "none exist". */}
                  <StatCard icon={Layers} label="departments assigned" value={s.department_count ?? 0} color="#7c3aed" />
                  <StatCard icon={Monitor} label="stations assigned" value={s.station_count ?? 0} color="#0891b2" />
                  <StatCard icon={ClipboardList} label="open work orders" value={s.work_order_count ?? 0} color="#ea580c" />
                </div>
              </button>
              <ShiftsSection siteId={s.id} />
            </div>
          ))}
        </div>
      )}

      {!loading && !error && current.level === 'departments' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {departments.length === 0 && <Empty label="No departments in this facility yet." />}
          {departments.map(d => (
            <button
              key={d.id}
              onClick={() => drill('workcenters', d.id, d.name)}
              className="text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: (d.color || '#3b82f6') + '20' }}>
                  <Layers size={18} style={{ color: d.color || '#3b82f6' }} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{d.name}</div>
                  {d.manager_name && <div className="text-xs text-gray-400 truncate">Mgr: {d.manager_name}</div>}
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <StatCard icon={Monitor} label="stations" value={d.station_count ?? 0} color="#0891b2" />
                <StatCard icon={ClipboardList} label="open work orders" value={d.work_order_count ?? d.open_work_orders ?? 0} color="#ea580c" />
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && !error && current.level === 'workcenters' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stations.length === 0 && <Empty label="No stations in this department yet." />}
          {stations.map(st => (
            <button
              key={st.id}
              onClick={() => drill('operations', st.id, st.name)}
              className="text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-xl bg-cyan-50 flex items-center justify-center">
                  <Monitor size={18} className="text-cyan-600" />
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                  st.status === 'active' ? 'bg-green-50 text-green-600' : st.status === 'maintenance' ? 'bg-amber-50 text-amber-600' : 'bg-gray-100 text-gray-500'
                }`}>{st.status || 'idle'}</span>
              </div>
              <div className="mt-3 font-semibold text-gray-900">{st.name}</div>
              {st.department_name && <div className="text-xs text-gray-400 mt-0.5">{st.department_name}</div>}
              <div className="mt-3">
                <StatCard icon={ClipboardList} label="completions logged" value={st.completion_count ?? 0} color="#0891b2" />
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && !error && current.level === 'operations' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {operations.length === 0 ? (
            <Empty label="No operations have been run at this station yet." />
          ) : (
            <div className="divide-y divide-gray-100">
              {operations.map(op => (
                <button
                  key={op.id}
                  onClick={() => navigate(`/completions/${op.id}`)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    op.status === 'completed' ? 'bg-green-500' : op.status === 'in_progress' ? 'bg-blue-500' : 'bg-red-400'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 text-sm truncate">{op.app_name}</div>
                    <div className="text-xs text-gray-400 truncate">{op.operator_name} · {runStatusLabel(op.status)}</div>
                  </div>
                  {/* No second parse of the stamp here: `timeAgo` states an
                      unreadable one as "—" itself, and the guard this row
                      used to carry did it with the very local-time parse that
                      was wrong. */}
                  <div className="text-xs text-gray-400 flex-shrink-0">
                    {timeAgo(op.completed_at || op.started_at)}
                  </div>
                  <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Facility shifts (site_shifts) ───────────────────────────────────────────

const SHIFT_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#64748b'];

function DayDots({ days, color }: { days: SiteShift['days']; color?: string | null }) {
  const active = parseDays(days);
  return (
    <span className="inline-flex items-center gap-0.5" title={`Active days: ${active.length}`}>
      {DAY_LETTERS.map((letter, i) => (
        <span
          key={i}
          className={`w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center ${
            active.includes(i) ? 'text-white' : 'bg-gray-100 text-gray-400'
          }`}
          style={active.includes(i) ? { backgroundColor: color || '#3b82f6' } : undefined}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

interface ShiftFormState {
  name: string;
  starts_at: string;
  ends_at: string;
  days: number[];
  color: string;
}

function ShiftForm({ initial, saving, onSave, onCancel }: {
  initial: ShiftFormState;
  saving: boolean;
  onSave: (values: ShiftFormState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ShiftFormState>(initial);

  const toggleDay = (d: number) => {
    setForm(f => ({
      ...f,
      days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d].sort((a, b) => a - b),
    }));
  };

  const valid = form.name.trim() !== '' && form.starts_at !== '' && form.ends_at !== ''
    && form.starts_at !== form.ends_at && form.days.length > 0;

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 space-y-2.5">
      <input
        type="text"
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="Shift name (e.g. Night)"
        className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={form.starts_at}
          onChange={e => setForm(f => ({ ...f, starts_at: e.target.value }))}
          className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-gray-400">to</span>
        <input
          type="time"
          value={form.ends_at}
          onChange={e => setForm(f => ({ ...f, ends_at: e.target.value }))}
          className="flex-1 bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {form.starts_at && form.ends_at && form.ends_at < form.starts_at && (
        <p className="text-[11px] text-amber-600">Overnight shift — ends the next day.</p>
      )}
      <div className="flex items-center gap-1">
        {DAY_LETTERS.map((letter, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleDay(i)}
            className={`w-7 h-7 rounded-lg text-xs font-semibold transition-colors ${
              form.days.includes(i)
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-400 hover:border-blue-300'
            }`}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {SHIFT_COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setForm(f => ({ ...f, color: c }))}
            className={`w-5 h-5 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:bg-gray-100"
        >
          <X size={12} /> Cancel
        </button>
        <button
          type="button"
          disabled={!valid || saving}
          onClick={() => onSave({ ...form, name: form.name.trim() })}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={12} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const EMPTY_SHIFT_FORM: ShiftFormState = {
  name: '', starts_at: '06:00', ends_at: '14:00', days: [1, 2, 3, 4, 5], color: SHIFT_COLORS[0],
};

function ShiftsSection({ siteId }: { siteId: string }) {
  const { addToast } = useToast();
  const [shifts, setShifts] = useState<SiteShift[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadShifts = () => {
    api.getSiteShifts(siteId)
      .then(list => setShifts(Array.isArray(list) ? list : []))
      .catch(() => setShifts([]));
  };

  useEffect(() => { loadShifts(); /* eslint-disable-next-line */ }, [siteId]);

  const toPayload = (values: ShiftFormState): SiteShiftInput => ({
    name: values.name,
    starts_at: values.starts_at,
    ends_at: values.ends_at,
    days: values.days,
    color: values.color,
  });

  const handleCreate = async (values: ShiftFormState) => {
    setSaving(true);
    try {
      await api.createSiteShift(siteId, { ...toPayload(values), sort_order: shifts.length });
      addToast(`Shift "${values.name}" added`, 'success');
      setAdding(false);
      loadShifts();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add shift', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (shiftId: string, values: ShiftFormState) => {
    setSaving(true);
    try {
      await api.updateSiteShift(siteId, shiftId, toPayload(values));
      addToast(`Shift "${values.name}" updated`, 'success');
      setEditingId(null);
      loadShifts();
    } catch (err: any) {
      addToast(err?.message || 'Failed to update shift', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (shift: SiteShift) => {
    if (!confirm(`Delete shift "${shift.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteSiteShift(siteId, shift.id);
      addToast(`Shift "${shift.name}" deleted`, 'success');
      loadShifts();
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete shift', 'error');
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
          <Clock size={12} /> Shifts
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null); }}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus size={12} /> Add shift
          </button>
        )}
      </div>

      {shifts.length === 0 && !adding && (
        <p className="text-xs text-gray-400">No shifts defined for this facility yet.</p>
      )}

      <div className="space-y-1.5">
        {shifts.map(shift => (
          editingId === shift.id ? (
            <ShiftForm
              key={shift.id}
              initial={{
                name: shift.name,
                starts_at: shift.starts_at,
                ends_at: shift.ends_at,
                days: parseDays(shift.days),
                color: shift.color || SHIFT_COLORS[0],
              }}
              saving={saving}
              onSave={values => handleUpdate(shift.id, values)}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div key={shift.id} className="flex items-center gap-2 group">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: shift.color || '#3b82f6' }} />
              <span className="text-sm font-medium text-gray-800 truncate">{shift.name}</span>
              <span className="text-[11px] font-mono text-gray-600 bg-gray-100 rounded-md px-1.5 py-0.5 whitespace-nowrap">
                {formatShiftRange(shift)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <DayDots days={shift.days} color={shift.color} />
                <button
                  onClick={() => { setEditingId(shift.id); setAdding(false); }}
                  className="text-gray-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit shift"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => handleDelete(shift)}
                  className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete shift"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          )
        ))}

        {adding && (
          <ShiftForm
            initial={EMPTY_SHIFT_FORM}
            saving={saving}
            onSave={handleCreate}
            onCancel={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="col-span-full py-12 flex flex-col items-center gap-2 text-center">
      <ClipboardList size={28} className="text-gray-300" />
      <p className="text-sm font-medium text-gray-500">Nothing here yet</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
