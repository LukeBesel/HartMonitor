import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  Factory, ChevronRight, Package, Clock, AlertTriangle, CheckCircle, User, Tablet,
  Briefcase, History as HistoryIcon, LogOut, RefreshCw, Send, ArrowLeft, ScanLine, WifiOff,
  MessageSquare,
} from 'lucide-react';
import { timeAgo } from '../utils/time';
import BarcodeScannerModal from '../components/shared/BarcodeScannerModal';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { getQueuedNCRs, queueNCR, syncQueuedNCRs } from '../utils/offlineQueue';
import { useMessages } from '../context/MessagesContext';
import type { MessageSeverity } from '../types';

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

interface Completion {
  id: string;
  app_id: string;
  app_name: string;
  operator_name: string;
  work_order_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'in_progress' | 'completed' | 'abandoned';
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#3b82f6', low: '#9ca3af',
};

const COMPLETION_STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-500/15 text-green-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  abandoned: 'bg-red-500/15 text-red-300',
};

const SEVERITY_OPTIONS: { value: 'minor' | 'major' | 'critical'; label: string; activeClass: string }[] = [
  { value: 'minor', label: 'Minor', activeClass: 'border-blue-400 bg-blue-500/20 text-blue-300' },
  { value: 'major', label: 'Major', activeClass: 'border-amber-400 bg-amber-500/20 text-amber-300' },
  { value: 'critical', label: 'Critical', activeClass: 'border-red-400 bg-red-500/20 text-red-300' },
];

function fmtDate(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function isToday(iso?: string | null) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

type Tab = 'jobs' | 'history' | 'report' | 'profile';

export default function OperatorPortal() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'name' | 'main'>('name');
  const [activeTab, setActiveTab] = useState<Tab>('jobs');
  const [operatorName, setOperatorName] = useState('');
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedWO, setSelectedWO] = useState<WorkOrder | null>(null);

  const [completions, setCompletions] = useState<Completion[] | null>(null);
  const [completionsLoading, setCompletionsLoading] = useState(false);

  const online = useOnlineStatus();
  const [pendingReports, setPendingReports] = useState(() => getQueuedNCRs().length);

  useEffect(() => {
    const saved = localStorage.getItem('hm_operator_name');
    if (saved) setOperatorName(saved);
  }, []);

  // When connectivity returns, flush any quality reports that were queued while offline.
  useEffect(() => {
    if (!online || pendingReports === 0) return;
    syncQueuedNCRs().then(() => setPendingReports(getQueuedNCRs().length));
  }, [online, pendingReports]);

  const loadWorkOrders = async () => {
    const wos: WorkOrder[] = await api.getWorkOrders();
    const active = wos.filter(wo =>
      wo.app_id &&
      wo.status !== 'completed' &&
      wo.status !== 'cancelled' &&
      wo.quantity_completed < wo.quantity
    );
    setWorkOrders(active);
  };

  const loadCompletions = async () => {
    setCompletionsLoading(true);
    try {
      const rows = await api.getCompletions({ operator_name: operatorName.trim(), limit: 50 });
      setCompletions(rows);
    } finally {
      setCompletionsLoading(false);
    }
  };

  const handleNameSubmit = async () => {
    if (!operatorName.trim()) return;
    localStorage.setItem('hm_operator_name', operatorName.trim());
    setLoading(true);
    try {
      await loadWorkOrders();
      setStep('main');
      setActiveTab('jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleStartJob = () => {
    if (!selectedWO?.app_id) return;
    navigate(`/play/${selectedWO.app_id}?wo=${selectedWO.id}&name=${encodeURIComponent(operatorName.trim())}`);
  };

  const switchOperator = () => {
    setStep('name');
    setSelectedWO(null);
    setCompletions(null);
    setActiveTab('jobs');
  };

  // Lazy-load completion history the first time that tab is opened.
  useEffect(() => {
    if (activeTab === 'history' && completions === null && operatorName) {
      loadCompletions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  if (step === 'name') {
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
        </div>

        <div className="px-6 pb-6 text-center">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-xs text-blue-400/40 hover:text-blue-300/60 transition-colors"
          >
            Management Dashboard →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#0a1628] flex flex-col">
      {/* Compact top bar */}
      <header className="px-4 sm:px-6 pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg flex-shrink-0">
          <Tablet size={16} className="text-white" />
        </div>
        <div className="min-w-0">
          <div className="text-white font-bold text-base leading-tight truncate">Hi, {operatorName}</div>
          <div className="text-blue-300/60 text-xs">
            {activeTab === 'jobs' && 'Your assigned jobs'}
            {activeTab === 'history' && 'Your recent activity'}
            {activeTab === 'report' && 'Report a quality issue'}
            {activeTab === 'profile' && 'Profile & settings'}
          </div>
        </div>
      </header>

      {!online && (
        <div className="px-4 sm:px-6 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-xs font-medium">
            <WifiOff size={14} />
            You're offline — showing cached jobs. New reports will be saved and sent once you're back online.
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 pb-28">
        {activeTab === 'jobs' && (
          <JobsTab
            workOrders={workOrders}
            selectedWO={selectedWO}
            setSelectedWO={setSelectedWO}
            onStartJob={handleStartJob}
            onRefresh={loadWorkOrders}
          />
        )}
        {activeTab === 'history' && (
          <HistoryTab
            completions={completions}
            loading={completionsLoading}
            onRefresh={loadCompletions}
          />
        )}
        {activeTab === 'report' && (
          <ReportTab
            operatorName={operatorName}
            workOrders={workOrders}
            online={online}
            onQueue={() => setPendingReports(getQueuedNCRs().length)}
          />
        )}
        {activeTab === 'profile' && (
          <ProfileTab
            operatorName={operatorName}
            jobCount={workOrders.length}
            onSwitchOperator={switchOperator}
            pendingReports={pendingReports}
          />
        )}
      </main>

      <BottomNav active={activeTab} onChange={setActiveTab} />
    </div>
  );
}

// ── Bottom tab navigation ──────────────────────────────────────────────────────

function BottomNav({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'jobs', label: 'Jobs', icon: Briefcase },
    { id: 'history', label: 'History', icon: HistoryIcon },
    { id: 'report', label: 'Report', icon: AlertTriangle },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-[#0a1628]/95 backdrop-blur-sm border-t border-white/10 grid grid-cols-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
              isActive ? 'text-blue-400' : 'text-blue-200/40 hover:text-blue-200/70'
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

// ── Jobs tab ─────────────────────────────────────────────────────────────────

function JobsTab({
  workOrders, selectedWO, setSelectedWO, onStartJob, onRefresh,
}: {
  workOrders: WorkOrder[];
  selectedWO: WorkOrder | null;
  setSelectedWO: (wo: WorkOrder | null) => void;
  onStartJob: () => void;
  onRefresh: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const handleScan = (code: string) => {
    setShowScanner(false);
    const normalized = code.trim().toLowerCase();
    const match = workOrders.find(wo =>
      wo.work_order_number.toLowerCase() === normalized ||
      wo.part_number.toLowerCase() === normalized
    );
    if (match) {
      setSelectedWO(match);
      setScanMessage('');
    } else {
      setScanMessage(`No job found matching "${code}"`);
    }
  };

  return (
    <div>
      {showScanner && (
        <BarcodeScannerModal
          title="Scan Job Barcode"
          hint="Scan a work order or part barcode to select that job"
          onClose={() => setShowScanner(false)}
          onScan={handleScan}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-blue-200/70 text-sm">
          {workOrders.length > 0 ? `${workOrders.length} job${workOrders.length !== 1 ? 's' : ''} available` : 'No jobs scheduled yet'}
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setScanMessage(''); setShowScanner(true); }}
            className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors"
          >
            <ScanLine size={13} />
            Scan
          </button>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {scanMessage && (
        <div className="mb-3 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-xl px-3 py-2 text-sm">
          {scanMessage}
        </div>
      )}

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

                    <div className="mt-3 flex items-center gap-4 text-xs flex-wrap">
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
        <div className="fixed bottom-20 inset-x-4 sm:inset-x-6 z-30">
          <button
            onClick={onStartJob}
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
  );
}

// ── History tab ──────────────────────────────────────────────────────────────

function HistoryTab({
  completions, loading, onRefresh,
}: {
  completions: Completion[] | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const list = completions ?? [];
  const completedToday = list.filter(c => c.status === 'completed' && isToday(c.completed_at)).length;
  const totalCompleted = list.filter(c => c.status === 'completed').length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
          <div className="text-blue-200/60 text-xs font-medium uppercase tracking-wide">Today</div>
          <div className="text-white text-3xl font-bold mt-1">{completedToday}</div>
          <div className="text-blue-300/50 text-xs mt-0.5">units completed</div>
        </div>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
          <div className="text-blue-200/60 text-xs font-medium uppercase tracking-wide">Recent</div>
          <div className="text-white text-3xl font-bold mt-1">{totalCompleted}</div>
          <div className="text-blue-300/50 text-xs mt-0.5">total in history</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold text-sm">Recent activity</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-blue-300 hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && completions === null ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-10 text-center">
          <HistoryIcon size={36} className="mx-auto mb-3 text-blue-300/40" />
          <div className="text-white font-semibold">No activity yet</div>
          <div className="text-blue-200/70 text-sm mt-1">Completed and started jobs will show up here</div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(c => (
            <div key={c.id} className="bg-white/10 rounded-xl border border-white/10 p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                <Factory size={16} className="text-blue-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-sm font-medium truncate">{c.app_name}</div>
                <div className="text-blue-300/50 text-xs">
                  {c.status === 'completed' ? timeAgo(c.completed_at || c.started_at) : `Started ${timeAgo(c.started_at)}`}
                </div>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-full capitalize flex-shrink-0 ${COMPLETION_STATUS_BADGE[c.status] || 'bg-gray-500/15 text-gray-300'}`}>
                {c.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Report Issue tab ────────────────────────────────────────────────────────

function ReportTab({
  operatorName, workOrders, online, onQueue,
}: {
  operatorName: string;
  workOrders: WorkOrder[];
  online: boolean;
  onQueue: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('minor');
  const [workOrderId, setWorkOrderId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setSeverity('minor');
    setWorkOrderId('');
    setSubmitted(null);
    setQueuedOffline(false);
    setError('');
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Please describe the issue in the title.'); return; }
    setSaving(true);
    setError('');
    const wo = workOrders.find(w => w.id === workOrderId);
    const descPrefix = `Reported by ${operatorName.trim()} from the shop floor.`;
    const payload = {
      title: title.trim(),
      description: description.trim() ? `${descPrefix}\n\n${description.trim()}` : descPrefix,
      severity,
      source: 'production',
      work_order_id: workOrderId || undefined,
      app_id: wo?.app_id || undefined,
    };
    if (!online) {
      queueNCR(payload);
      onQueue();
      setQueuedOffline(true);
      setSubmitted('queued');
      setSaving(false);
      return;
    }
    try {
      const ncr = await api.createNCR(payload);
      setSubmitted(ncr.ncr_number);
    } catch (e: any) {
      setError(e.message || 'Failed to submit report');
    } finally {
      setSaving(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-8 text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border-2 ${queuedOffline ? 'bg-amber-500/20 border-amber-400/30' : 'bg-green-500/20 border-green-400/30'}`}>
          {queuedOffline ? <WifiOff size={32} className="text-amber-400" /> : <CheckCircle size={32} className="text-green-400" />}
        </div>
        {queuedOffline ? (
          <>
            <div className="text-white font-bold text-lg">Saved offline</div>
            <div className="text-blue-200/70 text-sm mt-1">Your report will be submitted automatically once you're back online.</div>
          </>
        ) : (
          <>
            <div className="text-white font-bold text-lg">Issue reported</div>
            <div className="text-blue-200/70 text-sm mt-1">NCR <span className="font-mono">{submitted}</span> has been created</div>
            <div className="text-blue-300/50 text-xs mt-2">Your supervisor and quality team will follow up.</div>
          </>
        )}
        <button
          onClick={reset}
          className="mt-6 w-full h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-colors flex items-center justify-center gap-2"
        >
          Report another issue
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl p-3 text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">What's wrong? *</label>
        <input
          className="w-full h-12 rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
          placeholder="e.g. Bad weld on bracket"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">Details</label>
        <textarea
          className="w-full rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 py-3 placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15 resize-none"
          rows={4}
          placeholder="Describe what happened, what part, what station..."
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-blue-200 mb-1.5">Severity</label>
        <div className="grid grid-cols-3 gap-2">
          {SEVERITY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSeverity(opt.value)}
              className={`h-11 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
                severity === opt.value ? opt.activeClass : 'border-white/10 bg-white/5 text-blue-200/60 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {workOrders.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-blue-200 mb-1.5">Related Job (optional)</label>
          <select
            className="w-full h-12 rounded-xl bg-white/10 border border-white/20 text-white text-sm px-4 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white/15"
            value={workOrderId}
            onChange={e => setWorkOrderId(e.target.value)}
          >
            <option value="" className="text-gray-900">No specific job</option>
            {workOrders.map(wo => (
              <option key={wo.id} value={wo.id} className="text-gray-900">
                {wo.work_order_number} — {wo.part_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!title.trim() || saving}
        className="w-full h-14 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition-colors flex items-center justify-center gap-3 shadow-lg shadow-red-900/30"
      >
        {saving ? (
          <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : online ? (
          <>Submit Report <Send size={18} /></>
        ) : (
          <>Save Offline <WifiOff size={18} /></>
        )}
      </button>
    </div>
  );
}

// ── Messages card ───────────────────────────────────────────────────────────

const MESSAGE_SEVERITY_DOT: Record<MessageSeverity, string> = {
  info: 'bg-blue-400',
  warning: 'bg-amber-400',
  urgent: 'bg-red-400',
};

function MessagesCard() {
  const { messages, unreadCount, markAllRead } = useMessages();
  const recent = messages.slice(0, 5);

  return (
    <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare size={16} className="text-blue-300" />
        <div className="text-white font-semibold text-sm">Messages</div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="ml-auto text-[11px] font-medium text-blue-300 hover:text-blue-200 transition-colors"
          >
            Mark {unreadCount} read
          </button>
        )}
      </div>
      {recent.length === 0 ? (
        <div className="text-blue-300/50 text-xs py-2">No messages yet</div>
      ) : (
        <div className="space-y-2">
          {recent.map(m => (
            <div key={m.id} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${MESSAGE_SEVERITY_DOT[m.severity] ?? MESSAGE_SEVERITY_DOT.info}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-white text-xs font-medium truncate">{m.sender_name}</span>
                  <span className="text-blue-300/40 text-[10px] flex-shrink-0">{timeAgo(m.created_at)}</span>
                </div>
                <div className="text-blue-200/70 text-xs break-words">{m.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profile tab ──────────────────────────────────────────────────────────────

function ProfileTab({
  operatorName, jobCount, onSwitchOperator, pendingReports,
}: {
  operatorName: string;
  jobCount: number;
  onSwitchOperator: () => void;
  pendingReports: number;
}) {
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center mx-auto mb-3 text-white text-2xl font-bold">
          {operatorName.trim()[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="text-white font-bold text-lg">{operatorName}</div>
        <div className="text-blue-300/60 text-xs mt-1">Shop Floor Operator</div>
      </div>

      <div className="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
          <Briefcase size={18} className="text-blue-300" />
        </div>
        <div>
          <div className="text-white font-semibold">{jobCount} job{jobCount !== 1 ? 's' : ''} assigned</div>
          <div className="text-blue-300/50 text-xs">Visible on the Jobs tab</div>
        </div>
      </div>

      {pendingReports > 0 && (
        <div className="bg-amber-500/10 backdrop-blur-sm rounded-2xl border border-amber-500/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <WifiOff size={18} className="text-amber-400" />
          </div>
          <div>
            <div className="text-white font-semibold">{pendingReports} report{pendingReports !== 1 ? 's' : ''} pending sync</div>
            <div className="text-amber-300/70 text-xs">Will be submitted automatically once you're online</div>
          </div>
        </div>
      )}

      <MessagesCard />

      <div className="space-y-2 pt-2">
        <button
          onClick={onSwitchOperator}
          className="w-full h-12 bg-white/10 hover:bg-white/15 border border-white/10 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <ArrowLeft size={16} />
          Switch operator
        </button>
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full h-12 bg-white/5 hover:bg-white/10 border border-white/10 text-blue-200/70 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
        >
          <LogOut size={16} />
          Management Dashboard
        </button>
      </div>
    </div>
  );
}
