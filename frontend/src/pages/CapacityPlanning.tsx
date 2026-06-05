import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { Users, Clock, Package, AlertTriangle, RefreshCw, TrendingUp, Calendar } from 'lucide-react';

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
  hours_required: number;
  operators_needed: number;
  work_order_count: number;
}

interface CapacityData {
  work_orders: WOCapacity[];
  summary: {
    total_hours_required: number;
    total_operators_needed_8h: number;
    departments: DeptSummary[];
  };
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#3b82f6', low: '#9ca3af',
};

export default function CapacityPlanning() {
  const [data, setData] = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'hours' | 'operators' | 'days'>('hours');

  const load = () => {
    setLoading(true);
    api.getCapacity()
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const sortedWOs = [...(data?.work_orders ?? [])].sort((a, b) => {
    if (sortBy === 'hours') return b.hours_required - a.hours_required;
    if (sortBy === 'operators') return b.operators_needed_8h - a.operators_needed_8h;
    if (sortBy === 'days') return (a.days_remaining ?? 999) - (b.days_remaining ?? 999);
    return 0;
  });

  const depts = data?.summary.departments ?? [];

  return (
    <div className="min-h-screen bg-[#f8fafc] p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users size={20} className="text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Capacity Planning</h1>
          </div>
          <p className="text-gray-500 text-sm mt-0.5">Labor needed to complete active work orders based on cycle times</p>
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
      ) : !data ? (
        <div className="text-center py-16 text-gray-400">No capacity data available</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={16} className="text-blue-500" />
                <span className="text-xs text-gray-500 font-medium">Total Hours Required</span>
              </div>
              <div className="text-3xl font-bold text-gray-900">{data.summary.total_hours_required}h</div>
              <div className="text-xs text-gray-400 mt-1">across all active WOs</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-green-500" />
                <span className="text-xs text-gray-500 font-medium">Operators Needed</span>
              </div>
              <div className="text-3xl font-bold text-gray-900">{data.summary.total_operators_needed_8h}</div>
              <div className="text-xs text-gray-400 mt-1">per 8-hour shift (to hit schedule)</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} className="text-purple-500" />
                <span className="text-xs text-gray-500 font-medium">Active Work Orders</span>
              </div>
              <div className="text-3xl font-bold text-gray-900">{data.work_orders.length}</div>
              <div className="text-xs text-gray-400 mt-1">requiring labor</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-amber-500" />
                <span className="text-xs text-gray-500 font-medium">Due This Week</span>
              </div>
              <div className="text-3xl font-bold text-amber-600">
                {data.work_orders.filter(w => w.days_remaining !== null && w.days_remaining <= 7).length}
              </div>
              <div className="text-xs text-gray-400 mt-1">work orders</div>
            </div>
          </div>

          {/* Department breakdown */}
          {depts.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Dept chart */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="text-sm font-semibold text-gray-900 mb-4">Hours Required by Department</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={depts} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => [`${v}h`, 'Hours Required']} />
                    <Bar dataKey="hours_required" radius={[4, 4, 0, 0]}>
                      {depts.map((d, i) => (
                        <Cell key={i} fill={d.color || '#3b82f6'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Dept cards */}
              <div className="space-y-3">
                {depts.map(dept => (
                  <div key={dept.name} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-4">
                    <div
                      className="w-3 h-12 rounded-full flex-shrink-0"
                      style={{ backgroundColor: dept.color || '#6b7280' }}
                    />
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 text-sm">{dept.name}</div>
                      <div className="text-xs text-gray-400">{dept.work_order_count} work order{dept.work_order_count > 1 ? 's' : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900">{dept.hours_required}h</div>
                      <div className="text-xs text-gray-400">hours needed</div>
                    </div>
                    <div className="text-right ml-4">
                      <div className="font-bold text-blue-600">{dept.operators_needed}</div>
                      <div className="text-xs text-gray-400">operators/shift</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Work order detail table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Work Order Detail</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Sort by:</span>
                {(['hours', 'operators', 'days'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      sortBy === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {s === 'hours' ? 'Hours' : s === 'operators' ? 'Operators' : 'Due Date'}
                  </button>
                ))}
              </div>
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
                    <th className="text-right px-4 py-3">Operators/Shift</th>
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
                        <td className="px-4 py-3 text-right">
                          <span className={`font-bold ${wo.operators_needed_8h > 2 ? 'text-amber-600' : 'text-blue-600'}`}>
                            {wo.operators_needed_8h}
                          </span>
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
          </div>

          {/* Assumptions note */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 space-y-1">
            <div className="font-semibold text-blue-800 flex items-center gap-1.5">
              <TrendingUp size={13} /> Calculation Assumptions
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-blue-600">
              <li>Hours Required = Remaining Qty × Avg Cycle Time (from actual completions, or takt time if no history)</li>
              <li>Operators/Shift = Hours Required ÷ (Days Remaining × 8h)</li>
              <li>Operator counts rounded up to nearest 0.1 — plan for whole numbers in practice</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
