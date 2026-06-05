import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Factory, ChevronRight, Package, Clock, AlertTriangle, CheckCircle, User, Tablet } from 'lucide-react';

interface WorkOrder {
  id: string;
  work_order_number: string;
  part_name: string;
  part_number: string;
  quantity: number;
  quantity_completed: number;
  takt_time_minutes: number;
  priority: string;
  status: string;
  app_id: string | null;
  app_name?: string;
  department_name?: string;
  department_color?: string;
  scheduled_end?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#3b82f6', low: '#9ca3af',
};

function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function OperatorPortal() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'name' | 'job'>('name');
  const [operatorName, setOperatorName] = useState('');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('hm_operator_name');
    if (saved) setOperatorName(saved);
  }, []);

  const handleNameSubmit = async () => {
    if (!operatorName.trim()) return;
    localStorage.setItem('hm_operator_name', operatorName.trim());
    setLoading(true);
    try {
      const wos: WorkOrder[] = await api.getWorkOrders();
      const active = wos.filter(wo =>
        wo.app_id &&
        wo.status !== 'completed' &&
        wo.status !== 'cancelled' &&
        wo.quantity_completed < wo.quantity
      );
      setWorkOrders(active);
      setStep('job');
    } finally {
      setLoading(false);
    }
  };

  const handleStartJob = () => {
    if (!selectedWO?.app_id) return;
    navigate(`/play/${selectedWO.app_id}?wo=${selectedWO.id}&name=${encodeURIComponent(operatorName.trim())}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
      {/* Brand bar */}
      <div className="px-6 pt-6 pb-2 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg">
          <Tablet size={20} className="text-white" />
        </div>
        <div>
          <div className="text-white font-bold text-lg leading-tight">HartMonitor</div>
          <div className="text-blue-300/70 text-xs">Operator Portal</div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        {step === 'name' ? (
          /* ── Name Entry ── */
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-blue-500/30">
                <User size={36} className="text-blue-400" />
              </div>
              <h1 className="text-3xl font-bold text-white">Welcome</h1>
              <p className="text-blue-200/70 text-sm mt-2">Enter your name to see your assigned jobs</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-blue-200 mb-2">Your Name</label>
                <input
                  className="w-full h-14 rounded-xl bg-white/10 border border-white/20 text-white text-lg px-4 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
                  placeholder="Enter your name..."
                  value={operatorName}
                  onChange={e => setOperatorName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleNameSubmit()}
                  autoFocus
                  autoComplete="name"
                />
              </div>
              <button
                onClick={handleNameSubmit}
                disabled={!operatorName.trim() || loading}
                className="w-full h-14 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-blue-900/50"
              >
                {loading ? (
                  <span className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>See My Jobs <ChevronRight size={20} /></>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── Job Selection ── */
          <div className="w-full max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-white">
                  Hello, {operatorName}
                </h1>
                <p className="text-blue-200/70 text-sm">
                  {workOrders.length > 0 ? `${workOrders.length} job${workOrders.length !== 1 ? 's' : ''} available` : 'No jobs scheduled yet'}
                </p>
              </div>
              <button
                onClick={() => { setStep('name'); setSelectedWO(null); }}
                className="text-xs text-blue-300 hover:text-white flex items-center gap-1 transition-colors"
              >
                Not you? Switch operator
              </button>
            </div>

            {workOrders.length === 0 ? (
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-10 text-center">
                <CheckCircle size={40} className="mx-auto mb-3 text-green-400" />
                <div className="text-white font-semibold text-lg">All caught up!</div>
                <div className="text-blue-200/70 text-sm mt-1">No active work orders are scheduled right now</div>
                <div className="text-blue-300/50 text-xs mt-3">Check with your supervisor for new assignments</div>
              </div>
            ) : (
              <div className="space-y-3">
                {workOrders.map(wo => {
                  const pct = wo.quantity > 0 ? Math.round((wo.quantity_completed / wo.quantity) * 100) : 0;
                  const isSelected = selectedWO?.id === wo.id;
                  return (
                    <button
                      key={wo.id}
                      onClick={() => setSelectedWO(isSelected ? null : wo)}
                      className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                        isSelected
                          ? 'border-blue-400 bg-blue-600/20 shadow-lg shadow-blue-900/30'
                          : 'border-white/10 bg-white/10 hover:bg-white/15 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 mt-1.5"
                          style={{ backgroundColor: PRIORITY_COLORS[wo.priority] || '#9ca3af' }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-white font-bold text-base leading-tight">{wo.part_name}</div>
                              <div className="text-blue-200/60 text-xs mt-0.5 font-mono">{wo.work_order_number} · {wo.part_number}</div>
                            </div>
                            {isSelected && (
                              <div className="flex-shrink-0 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                                <CheckCircle size={14} className="text-white" />
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex items-center gap-4 text-xs">
                            <div className="flex items-center gap-1 text-blue-200/70">
                              <Package size={12} />
                              {wo.quantity_completed} / {wo.quantity} units
                            </div>
                            {wo.takt_time_minutes > 0 && (
                              <div className="flex items-center gap-1 text-blue-200/70">
                                <Clock size={12} />
                                {wo.takt_time_minutes}m takt
                              </div>
                            )}
                            {wo.department_name && (
                              <span
                                className="text-xs font-medium px-2 py-0.5 rounded-full"
                                style={{
                                  backgroundColor: (wo.department_color || '#6b7280') + '33',
                                  color: wo.department_color || '#9ca3af'
                                }}
                              >
                                {wo.department_name}
                              </span>
                            )}
                            {wo.scheduled_end && (
                              <div className="flex items-center gap-1 text-blue-200/60 ml-auto">
                                <AlertTriangle size={11} />
                                Due {fmtDate(wo.scheduled_end)}
                              </div>
                            )}
                          </div>

                          {/* Progress bar */}
                          <div className="mt-2.5">
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-400 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="text-xs text-blue-300/50 mt-0.5">{pct}% complete</div>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Start button */}
            {selectedWO && (
              <div className="mt-6 sticky bottom-6">
                <button
                  onClick={handleStartJob}
                  disabled={!selectedWO.app_id}
                  className="w-full h-16 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-2xl font-bold text-xl transition-colors flex items-center justify-center gap-3 shadow-2xl shadow-blue-900/50"
                >
                  <Factory size={24} />
                  Start: {selectedWO.part_name}
                  <ChevronRight size={22} />
                </button>
                {!selectedWO.app_id && (
                  <p className="text-center text-xs text-amber-300 mt-2">
                    No app assigned to this work order — contact your supervisor
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Back to management */}
      <div className="px-6 pb-6 text-center">
        <button
          onClick={() => navigate('/')}
          className="text-xs text-blue-400/40 hover:text-blue-300/60 transition-colors"
        >
          Management Dashboard →
        </button>
      </div>
    </div>
  );
}
