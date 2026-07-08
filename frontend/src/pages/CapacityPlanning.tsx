import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend
} from 'recharts';
import {
  Users, Clock, Package, AlertTriangle, RefreshCw, TrendingUp, Calendar,
  CheckCircle2, ChevronDown, ChevronUp, Pencil, Check, X
} from 'lucide-react';

interface WOCapacity {
  id: string;
  work_order_number: string;
  part_name: string;
  part_number: string;
  quantity: number;
  quantity_completed: number;
  remaining: number;
  takt_time_minutes: number;
  avg_cycle_minutes: number;
  hours_required: number;
  daily_hours: number;
  operators_needed_8h: number;
  days_remaining: number | null;
  scheduled_end: string;
  priority: string;
  status: string;
  department_name: string;
  department_color: string;
}

interface DeptSummary {
  name: string;
  color: string;
  headcount: number;
  hours_required: number;
  work_order_count: number;
  available_hours_per_day: number;
  demand_by_day: { date: string; hours: number }[];
  peak_day_hours: number;
  peak_utilization_pct: number | null;
  operators_gap: number;
  status: 'over' | 'tight' | 'ok';
}

interface CapacityData {
  work_orders: WOCapacity[];
  summary: {
    total_hours_required: number;
    total_operators_needed_8h: number;
    total_headcount: number;
    total_available_hours_per_day: number;
    plant_peak_day_hours: number;
    plant_peak_utilization_pct: number | null;
    horizon_days: number;
    timeline: Record<string, any>[];
    departments: DeptSummary[];
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#3b82f6', low: '#9ca3af',
};

export default function CapacityPlanning() {
  const { canEdit } = useAuth();
  const [data, setData] = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'days' | 'hours' | 'operators'>('days');
  const [showTable, setShowTable] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    api.getCapacity()
      .then(setData)
      .catch((err: any) => setLoadError(err?.message || 'Failed to load capacity data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const sortedWOs = [...(data?.work_orders ?? [])].sort((a, b) => {
    if (sortBy === 'hours') return b.hours_required - a.hours_required;
    if (sortBy === 'operators') return b.operators_needed_8h - a.operators_needed_8h;
    return (a.days_remaining ?? 999) - (b.days_remaining ?? 999);
  });

  const depts = data?.summary.departments ?? [];
  const overDepts = depts.filter(d => d.status === 'over');
  const tightDepts = depts.filter(d => d.status === 'tight');

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Capacity Planning</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Do you have enough people to finish the work on time?</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin text-blue-500' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw size={28} className="animate-spin text-blue-500" />
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertTriangle size={28} className="text-red-400" />
          <p className="text-gray-500 font-medium">Couldn't load capacity data</p>
          <p className="text-xs text-gray-400">{loadError}</p>
          <button onClick={load} className="btn-secondary">Retry</button>
        </div>
      ) : !data ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users size={32} className="mb-3 text-gray-300" />
          <p className="text-gray-500 font-medium">No capacity data available</p>
          <p className="text-gray-400 text-xs mt-1">Create work orders with due dates on the Schedule page to see staffing requirements.</p>
        </div>
      ) : (
        <>
          {/* Verdict banner */}
          {overDepts.length > 0 ? (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-red-800">
                  {overDepts.length} department{overDepts.length > 1 ? 's are' : ' is'} over capacity in the next {data.summary.horizon_days} days
                </div>
                <div className="text-sm text-red-600 mt-0.5">
                  {overDepts.map(d =>
                    `${d.name} needs ${d.operators_gap > 0 ? `+${d.operators_gap} operator${d.operators_gap > 1 ? 's' : ''}` : 'more staff'} to cover its peak day (${d.peak_day_hours}h of work vs ${d.available_hours_per_day}h available)`
                  ).join(' · ')}
                </div>
              </div>
            </div>
          ) : tightDepts.length > 0 ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-800">Capacity is tight in {tightDepts.map(d => d.name).join(', ')}</div>
                <div className="text-sm text-amber-600 mt-0.5">
                  Peak days run at {tightDepts.map(d => `${d.peak_utilization_pct}%`).join(' / ')} of available hours — any disruption will put schedules at risk.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
              <CheckCircle2 size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-green-800">Current staffing covers all scheduled work for the next {data.summary.horizon_days} days</div>
                <div className="text-sm text-green-600 mt-0.5">
                  Plant peak load is {data.summary.plant_peak_utilization_pct ?? 0}% of available hours ({data.summary.plant_peak_day_hours}h of {data.summary.total_available_hours_per_day}h).
                </div>
              </div>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={16} className="text-blue-500" />
                <span className="text-xs text-gray-500 font-medium">Work Remaining</span>
              </div>
              <div className="text-3xl font-bold text-gray-900">{data.summary.total_hours_required}h</div>
              <div className="text-xs text-gray-400 mt-1">across all active work orders</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-green-500" />
                <span className="text-xs text-gray-500 font-medium">Operators On Staff</span>
              </div>
              <div className="text-3xl font-bold text-gray-900">{data.summary.total_headcount}</div>
              <div className="text-xs text-gray-400 mt-1">{data.summary.total_available_hours_per_day}h available per day</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-purple-500" />
                <span className="text-xs text-gray-500 font-medium">Peak Utilization</span>
              </div>
              <div className={`text-3xl font-bold ${
                (data.summary.plant_peak_utilization_pct ?? 0) > 100 ? 'text-red-600' :
                (data.summary.plant_peak_utilization_pct ?? 0) >= 85 ? 'text-amber-600' : 'text-gray-900'
              }`}>
                {data.summary.plant_peak_utilization_pct ?? '—'}%
              </div>
              <div className="text-xs text-gray-400 mt-1">busiest day vs available hours</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-amber-500" />
                <span className="text-xs text-gray-500 font-medium">Due This Week</span>
              </div>
              <div className="text-3xl font-bold text-amber-600">
                {(data.work_orders ?? []).filter(w => w.days_remaining !== null && w.days_remaining <= 7).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">work orders</div>
            </div>
          </div>

          {/* Department capacity cards */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Capacity by Department</h2>
            {depts.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm py-10 text-center">
                <Users size={28} className="mx-auto mb-2 text-gray-300" />
                <p className="text-gray-500 font-medium text-sm">No departments yet</p>
                <p className="text-gray-400 text-xs mt-1">Add departments with headcount to see per-department capacity.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {depts.map(dept => <DeptCapacityCard key={dept.name} dept={dept} onSaved={load} canEdit={canEdit} />)}
              </div>
            )}
          </div>

          {/* Load timeline */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="text-sm font-semibold text-gray-900">Daily Workload — Next {data.summary.horizon_days} Days</div>
              <span className="text-xs text-gray-400">dashed line = total available hours/day</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">Each work order's remaining hours spread across the days until it's due. Bars above the line mean you can't finish everything on time with current staff.</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.summary.timeline ?? []} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })} />
                <YAxis tick={{ fontSize: 10 }} label={{ value: 'hours', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }} />
                <Tooltip
                  labelFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  formatter={(v: any, name: any) => [`${v}h`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {depts.filter(d => d.work_order_count > 0).map(d => (
                  <Bar key={d.name} dataKey={d.name} stackId="demand" fill={d.color || '#3b82f6'} radius={[0, 0, 0, 0]} />
                ))}
                {data.summary.total_available_hours_per_day > 0 && (
                  <ReferenceLine
                    y={data.summary.total_available_hours_per_day}
                    stroke="#dc2626"
                    strokeDasharray="6 4"
                    label={{ value: `${data.summary.total_available_hours_per_day}h available`, position: 'insideTopRight', style: { fontSize: 10, fill: '#dc2626' } }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Work order detail (collapsible) */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowTable(s => !s)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
            >
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Package size={15} className="text-gray-400" />
                Work Order Detail ({sortedWOs.length})
              </h2>
              {showTable ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
            </button>
            {showTable && (
              <>
                <div className="flex items-center gap-2 px-4 pb-3 border-b border-gray-100 flex-wrap">
                  <span className="text-xs text-gray-500">Sort by:</span>
                  {(['days', 'hours', 'operators'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                        sortBy === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {s === 'days' ? 'Due Date' : s === 'hours' ? 'Hours' : 'Operators'}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-4 py-3">Work Order</th>
                        <th className="text-left px-4 py-3">Department</th>
                        <th className="text-right px-4 py-3">Qty Remaining</th>
                        <th className="text-right px-4 py-3">Avg Cycle</th>
                        <th className="text-right px-4 py-3">Hours Req.</th>
                        <th className="text-right px-4 py-3">Daily Load</th>
                        <th className="text-right px-4 py-3">Due Date</th>
                        <th className="text-right px-4 py-3">Days Left</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sortedWOs.map(wo => {
                        const urgent = wo.days_remaining !== null && wo.days_remaining <= 3;
                        const overdue = wo.days_remaining !== null && wo.days_remaining <= 0;
                        return (
                          <tr key={wo.id} className={`hover:bg-gray-50 transition-colors ${overdue ? 'bg-red-50' : urgent ? 'bg-amber-50' : ''}`}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-2 h-2 rounded-full flex-shrink-0"
                                  style={{ backgroundColor: PRIORITY_COLORS[wo.priority] || '#9ca3af' }}
                                />
                                <div>
                                  <div className="font-medium text-gray-900 text-xs">{wo.work_order_number}</div>
                                  <div className="text-gray-500 text-xs truncate max-w-[140px]">{wo.part_name}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: (wo.department_color || '#6b7280') + '22',
                                  color: wo.department_color || '#6b7280'
                                }}
                              >
                                {wo.department_name}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              <span className="font-semibold text-gray-900">{wo.remaining}</span>
                              <span className="text-gray-400"> / {wo.quantity}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs">
                              <span className="font-medium text-gray-900">{wo.avg_cycle_minutes}m</span>
                              {wo.avg_cycle_minutes !== wo.takt_time_minutes && wo.takt_time_minutes > 0 && (
                                <div className="text-gray-400">takt: {wo.takt_time_minutes}m</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="font-bold text-gray-900">{wo.hours_required}h</span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-700 tabular-nums">
                              {wo.daily_hours}h/day
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-600">
                              <div className="flex items-center justify-end gap-1">
                                <Calendar size={11} className="text-gray-400" />
                                {fmtDate(wo.scheduled_end)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {wo.days_remaining === null ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : overdue ? (
                                <span className="text-xs font-bold text-red-600 flex items-center justify-end gap-1">
                                  <AlertTriangle size={11} /> Overdue
                                </span>
                              ) : (
                                <span className={`text-xs font-bold ${urgent ? 'text-amber-600' : 'text-gray-900'}`}>
                                  {wo.days_remaining}d
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {sortedWOs.length === 0 && (
                        <tr>
                          <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                            No active work orders requiring capacity planning
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Assumptions note */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 space-y-1">
            <div className="font-semibold text-blue-800 flex items-center gap-1.5">
              <TrendingUp size={13} /> Calculation Assumptions
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-blue-600">
              <li>Hours required = remaining quantity × average cycle time (from actual completions, or takt time if no history yet)</li>
              <li>Each work order's hours are spread evenly across the days until its due date; overdue work lands entirely on today</li>
              <li>Available hours = department headcount × 8h shifts — set headcount on each department card above</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function DeptCapacityCard({ dept, onSaved, canEdit }: { dept: DeptSummary; onSaved: () => void; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(dept.headcount));
  const [saving, setSaving] = useState(false);

  const utilization = dept.peak_utilization_pct;
  const barPct = utilization === null ? 100 : Math.min(100, utilization);
  const barColor = dept.status === 'over' ? 'bg-red-500' : dept.status === 'tight' ? 'bg-amber-500' : 'bg-green-500';

  const save = async () => {
    setSaving(true);
    try {
      const depts = await api.getDepartments();
      const match = depts.find((d: any) => d.name === dept.name);
      if (match) await api.updateDepartment(match.id, { headcount: Math.max(0, parseInt(value) || 0) });
      setEditing(false);
      onSaved();
    } catch (err: any) {
      alert(err?.message || 'Failed to update headcount');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-8 rounded-full" style={{ backgroundColor: dept.color || '#6b7280' }} />
          <div>
            <div className="font-semibold text-gray-900 text-sm">{dept.name}</div>
            <div className="text-xs text-gray-400">{dept.work_order_count} work order{dept.work_order_count !== 1 ? 's' : ''} · {dept.hours_required}h remaining</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!canEdit ? (
            <div className="flex items-center gap-1.5 text-sm text-gray-700 px-2 py-1">
              <Users size={13} className="text-gray-400" />
              <span className="font-semibold">{dept.headcount}</span>
              <span className="text-xs text-gray-400">operators</span>
            </div>
          ) : editing ? (
            <>
              <input
                type="number" min={0} autoFocus
                className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right"
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
              />
              <button onClick={save} disabled={saving} className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700"><Check size={12} /></button>
              <button onClick={() => { setEditing(false); setValue(String(dept.headcount)); }} className="p-1.5 bg-gray-200 text-gray-600 rounded-lg hover:bg-gray-300"><X size={12} /></button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-sm text-gray-700 hover:bg-gray-50 px-2 py-1 rounded-lg group"
              title="Edit headcount"
            >
              <Users size={13} className="text-gray-400" />
              <span className="font-semibold">{dept.headcount}</span>
              <span className="text-xs text-gray-400">operators</span>
              <Pencil size={11} className="text-gray-300 group-hover:text-gray-500" />
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Busiest day: {dept.peak_day_hours}h of work</span>
          <span>{dept.available_hours_per_day}h available/day</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barPct}%` }} />
        </div>
        <div className="mt-1.5 text-xs font-medium">
          {dept.status === 'over' ? (
            <span className="text-red-600">
              {dept.headcount === 0 ? 'No operators assigned' : `${utilization}% loaded`} — needs {dept.operators_gap > 0 ? `+${dept.operators_gap}` : 'more'} operator{dept.operators_gap > 1 ? 's' : ''} on its peak day
            </span>
          ) : dept.status === 'tight' ? (
            <span className="text-amber-600">{utilization}% loaded on peak day — little slack for disruptions</span>
          ) : (
            <span className="text-green-600">
              {utilization}% loaded{dept.operators_gap < 0 ? ` — ${-dept.operators_gap} operator${-dept.operators_gap > 1 ? 's' : ''} of slack` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
