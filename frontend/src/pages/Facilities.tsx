import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network, Building2, Layers, Monitor, ClipboardList, ChevronRight,
  ArrowLeft, MapPin, RefreshCw,
} from 'lucide-react';
import { api } from '../api/client';
import { usePlan } from '../context/PlanContext';
import { timeAgo } from '../utils/time';

// Enterprise multi-level drill-down:
//   Facility (site) → Department → Work Center (station) → Operations (completions)
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

  const siteId = useMemo(() => trail.find(c => c.level === 'departments')?.id ?? null, [trail]);
  const deptId = useMemo(() => trail.find(c => c.level === 'workcenters')?.id ?? null, [trail]);
  const stationId = useMemo(() => trail.find(c => c.level === 'operations')?.id ?? null, [trail]);

  const load = async () => {
    setLoading(true);
    try {
      if (current.level === 'facilities') {
        setSites(await api.getSites());
      } else if (current.level === 'departments') {
        setDepartments(await api.getDepartments(siteId ? { site_id: siteId } : undefined));
      } else if (current.level === 'workcenters') {
        const all = await api.getStations(siteId ? { site_id: siteId } : undefined);
        setStations(deptId ? all.filter(s => s.department_id === deptId) : all);
      } else if (current.level === 'operations') {
        const all = await api.getCompletions({ limit: 200 });
        setOperations(all.filter((c: any) => c.station_id === stationId));
      }
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
            Roll up multiple facilities and drill down into departments, work centers, and
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
            <p className="text-xs text-gray-500 hidden sm:block">Drill from facility to department to work center to operations</p>
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

      {!loading && current.level === 'facilities' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sites.length === 0 && <Empty label="No facilities yet. Add sites in Settings." />}
          {sites.map(s => (
            <button
              key={s.id}
              onClick={() => drill('departments', s.id, s.name)}
              className="text-left bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
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
                <StatCard icon={Layers} label="departments" value={s.department_count ?? 0} color="#7c3aed" />
                <StatCard icon={Monitor} label="work centers" value={s.station_count ?? 0} color="#0891b2" />
                <StatCard icon={ClipboardList} label="open work orders" value={s.work_order_count ?? 0} color="#ea580c" />
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && current.level === 'departments' && (
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
                <StatCard icon={Monitor} label="work centers" value={d.station_count ?? 0} color="#0891b2" />
                <StatCard icon={ClipboardList} label="open work orders" value={d.work_order_count ?? d.open_work_orders ?? 0} color="#ea580c" />
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && current.level === 'workcenters' && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stations.length === 0 && <Empty label="No work centers in this department yet." />}
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

      {!loading && current.level === 'operations' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {operations.length === 0 ? (
            <Empty label="No operations have been run at this work center yet." />
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
                    <div className="text-xs text-gray-400 truncate">{op.operator_name} · {op.status.replace('_', ' ')}</div>
                  </div>
                  <div className="text-xs text-gray-400 flex-shrink-0">{timeAgo(op.completed_at || op.started_at)}</div>
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

function Empty({ label }: { label: string }) {
  return (
    <div className="col-span-full py-12 text-center text-sm text-gray-400">{label}</div>
  );
}
