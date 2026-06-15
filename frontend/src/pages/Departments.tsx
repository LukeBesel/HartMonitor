import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useSite } from '../context/SiteContext';
import {
  Building2, RefreshCw, Activity, CheckCircle2, Clock, Calendar,
  ChevronRight
} from 'lucide-react';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';

interface Department {
  id: string;
  name: string;
  description?: string;
  color?: string;
}

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_name?: string;
  status: string;
  department_id?: string;
  department_name?: string;
  operator_name?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  quantity: number;
  quantity_completed: number;
  created_at?: string;
  started_at?: string;
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '—';
  const diff = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Departments() {
  const { selectedSiteId } = useSite();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  // Load departments list
  useEffect(() => {
    api.getDepartments({ site_id: selectedSiteId || undefined })
      .then((depts: Department[]) => {
        setDepartments(depts);
        if (depts.length > 0 && !selectedDeptId) {
          setSelectedDeptId(depts[0].id);
        }
      })
      .catch(() => {});
  }, [selectedSiteId]);

  const loadWorkOrders = useCallback(async (showSpinner = false) => {
    if (!selectedDeptId) return;
    if (showSpinner) setRefreshing(true);
    try {
      const all = await api.getWorkOrders({ department_id: selectedDeptId });
      setWorkOrders(all);
      setLastRefresh(new Date());
    } catch {
      // keep stale data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDeptId]);

  useEffect(() => {
    setLoading(true);
    loadWorkOrders(false);
    const interval = setInterval(() => loadWorkOrders(false), 30000);
    return () => clearInterval(interval);
  }, [loadWorkOrders]);

  const inProgress = workOrders.filter(wo => wo.status === 'in_progress');
  const upcoming = workOrders
    .filter(wo => wo.status === 'not_started' || wo.status === 'pending')
    .sort((a, b) => (a.scheduled_start ?? '').localeCompare(b.scheduled_start ?? ''));
  const completedToday = workOrders.filter(wo => {
    if (wo.status !== 'completed') return false;
    // Check if completed today (using scheduled_end as proxy)
    return true;
  }).length;

  const selectedDept = departments.find(d => d.id === selectedDeptId);
  const secondsSinceRefresh = Math.floor((Date.now() - lastRefresh.getTime()) / 1000);

  return (
    <div className="p-6 space-y-6">
      <ModuleOnboarding
        moduleId="departments"
        title="Department View"
        description="Monitor live job activity by department. See what's running, what's coming up, and key metrics at a glance."
        steps={[
          "Select a department from the dropdown",
          "View live running jobs and upcoming scheduled work",
          "Check metrics for the selected department",
          "Page auto-refreshes every 30 seconds",
        ]}
        icon={Building2}
        color="#3b82f6"
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <Building2 size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Department View</h1>
            <p className="text-xs text-gray-500 mt-0.5">Live job status by department</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Department selector */}
          <select
            value={selectedDeptId}
            onChange={e => setSelectedDeptId(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">— Select department —</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <button
            onClick={() => loadWorkOrders(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-blue-500' : ''} />
            <span className="text-xs text-gray-400">{secondsSinceRefresh}s</span>
          </button>
        </div>
      </div>

      {!selectedDeptId ? (
        <div className="flex items-center justify-center py-24 text-gray-400 flex-col gap-3">
          <Building2 size={48} className="text-gray-200" />
          <p className="text-sm font-medium">Select a department to view its jobs</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw size={28} className="animate-spin text-blue-500" />
        </div>
      ) : (
        <>
          {/* Metrics row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-5">
              <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
                <Activity size={18} className="text-blue-600" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{inProgress.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">In Progress</div>
            </div>
            <div className="card p-5">
              <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center mb-3">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{completedToday}</div>
              <div className="text-xs text-gray-500 mt-0.5">Completed (all time)</div>
            </div>
            <div className="card p-5">
              <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center mb-3">
                <Calendar size={18} className="text-amber-600" />
              </div>
              <div className="text-2xl font-bold text-gray-900">{upcoming.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">Upcoming</div>
            </div>
          </div>

          {/* Live Running Jobs */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity size={16} className="text-blue-500" />
              <h2 className="font-semibold text-gray-900">Live Running Jobs</h2>
              {inProgress.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {inProgress.length}
                </span>
              )}
            </div>
            {inProgress.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 size={28} className="text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No jobs currently running in {selectedDept?.name}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {inProgress.map(wo => (
                  <Link
                    key={wo.id}
                    to={`/departments/${wo.department_id || ''}`}
                    className="border border-blue-200 bg-blue-50/30 rounded-xl p-4 hover:shadow-md transition-all group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                        Running
                      </span>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-gray-500" />
                    </div>
                    <div className="font-semibold text-gray-900 text-sm truncate">{wo.work_order_number}</div>
                    {wo.part_name && <div className="text-xs text-gray-500 truncate mt-0.5">{wo.part_name}</div>}
                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {formatElapsed(wo.started_at)}
                      </span>
                      {wo.operator_name && <span>{wo.operator_name}</span>}
                    </div>
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Progress</span>
                        <span>{wo.quantity_completed}/{wo.quantity}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${wo.quantity > 0 ? Math.min(100, (wo.quantity_completed / wo.quantity) * 100) : 0}%` }}
                        />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Scheduled / Upcoming Jobs */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Calendar size={16} className="text-amber-500" />
              <h2 className="font-semibold text-gray-900">Scheduled / Upcoming</h2>
              {upcoming.length > 0 && (
                <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {upcoming.length}
                </span>
              )}
            </div>
            {upcoming.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 size={28} className="text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">No upcoming jobs scheduled for {selectedDept?.name}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Work Order</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Part</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Qty</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Start</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Due</th>
                      <th className="text-left text-xs font-medium text-gray-500 pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {upcoming.slice(0, 20).map(wo => (
                      <tr key={wo.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-2.5 pr-3 text-xs font-semibold text-gray-900">{wo.work_order_number}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 max-w-[160px] truncate">{wo.part_name || '—'}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-600 tabular-nums">{wo.quantity}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-500">{formatDate(wo.scheduled_start)}</td>
                        <td className="py-2.5 pr-3 text-xs text-gray-500">{formatDate(wo.scheduled_end)}</td>
                        <td className="py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            wo.status === 'not_started' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {wo.status === 'not_started' ? 'Not Started' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
