import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Users, Building2, Activity, Server, RefreshCw,
  Search, AlertCircle, TrendingUp, CheckCircle2,
  Database, Cpu, Clock, Package, ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Skeleton, SkeletonTable, SkeletonStats } from '../components/shared/Skeleton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminStats {
  total_companies: number;
  total_users: number;
  total_completions: number;
  total_work_orders: number;
  companies_this_month: number;
  users_this_month: number;
  active_trials: number;
  past_due_count: number;
}

interface Company {
  id: string;
  name: string;
  slug: string | null;
  plan: string | null;
  subscription_status: string | null;
  user_count: number;
  owner_email: string | null;
  monthly_completions: number;
  created_at: string;
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: number;
  last_login: string | null;
  created_at: string;
  company_name: string | null;
}

interface ActivityEntry {
  id: string;
  company_id: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  created_at: string;
  company_name: string | null;
}

interface HealthData {
  uptime_seconds: number;
  memory_mb: number;
  db_size_mb: number;
  node_version: string;
  timestamp: string;
}

// ─── Sub-components ────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ElementType;
  value: number | string;
  label: string;
  sub?: string;
  color?: string;
}

function StatCard({ icon: Icon, value, label, sub, color = 'text-blue-400' }: StatCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start gap-4">
      <div className={`mt-0.5 p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-sm text-gray-400">{label}</div>
        {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

interface PlanBadgeProps {
  plan: string | null;
  status?: string | null;
}

function PlanBadge({ plan, status }: PlanBadgeProps) {
  if (status === 'past_due') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-red-400 border border-red-800">
        Past Due
      </span>
    );
  }
  if (status === 'trialing') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-900/40 text-yellow-400 border border-yellow-800">
        Trial
      </span>
    );
  }

  const tier = plan?.toLowerCase() ?? 'free';
  const styles: Record<string, string> = {
    enterprise: 'bg-purple-900/40 text-purple-400 border-purple-800',
    pro:        'bg-blue-900/40 text-blue-400 border-blue-800',
    free:       'bg-gray-800 text-gray-400 border-gray-700',
  };
  const label: Record<string, string> = {
    enterprise: 'Enterprise',
    pro:        'Pro',
    free:       'Free',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[tier] ?? styles.free}`}>
      {label[tier] ?? tier}
    </span>
  );
}

interface RoleBadgeProps {
  role: string;
}

function RoleBadge({ role }: RoleBadgeProps) {
  const styles: Record<string, string> = {
    developer:  'bg-purple-900/40 text-purple-400',
    manager:    'bg-blue-900/40 text-blue-400',
    supervisor: 'bg-cyan-900/40 text-cyan-400',
    operator:   'bg-green-900/40 text-green-400',
    viewer:     'bg-gray-800 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[role] ?? styles.viewer}`}>
      {role}
    </span>
  );
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ─── Tab: Overview ────────────────────────────────────────────────────────

interface OverviewTabProps {
  stats: AdminStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function OverviewTab({ stats, loading, error, onRetry }: OverviewTabProps) {
  if (loading) return <SkeletonStats count={8} />;
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!stats) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Building2}    value={stats.total_companies}     label="Total Companies"    color="text-blue-400" />
        <StatCard icon={Users}        value={stats.total_users}         label="Total Users"        color="text-green-400" />
        <StatCard icon={CheckCircle2} value={stats.total_completions}   label="Completions"        color="text-cyan-400" />
        <StatCard icon={Package}      value={stats.total_work_orders}   label="Work Orders"        color="text-purple-400" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          value={stats.companies_this_month}
          label="New Companies"
          sub="This month"
          color="text-emerald-400"
        />
        <StatCard
          icon={Users}
          value={stats.users_this_month}
          label="New Users"
          sub="This month"
          color="text-sky-400"
        />
        <StatCard
          icon={Clock}
          value={stats.active_trials}
          label="Active Trials"
          color="text-yellow-400"
        />
        <StatCard
          icon={AlertCircle}
          value={stats.past_due_count}
          label="Past Due"
          color={stats.past_due_count > 0 ? 'text-red-400' : 'text-gray-500'}
        />
      </div>
    </div>
  );
}

// ─── Tab: Customers ───────────────────────────────────────────────────────

interface CompanyTableProps {
  companies: Company[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  planFilter: string;
  onPlanChange: (v: string) => void;
  onRetry: () => void;
  onChangePlan: (company: Company) => void;
}

function CompanyTable({
  companies, loading, error, search, onSearchChange,
  planFilter, onPlanChange, onRetry, onChangePlan,
}: CompanyTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="Search companies..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <select
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          value={planFilter}
          onChange={e => onPlanChange(e.target.value)}
        >
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Company</th>
                <th className="text-left px-4 py-3 font-medium">Plan</th>
                <th className="text-center px-4 py-3 font-medium">Users</th>
                <th className="text-center px-4 py-3 font-medium">Completions (30d)</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-500">No companies found</td>
                </tr>
              ) : (
                companies.map(c => (
                  <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{c.name}</div>
                      {c.owner_email && (
                        <div className="text-xs text-gray-500 mt-0.5">{c.owner_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PlanBadge plan={c.plan} status={c.subscription_status} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">{c.user_count}</td>
                    <td className="px-4 py-3 text-center text-gray-300">{c.monthly_completions}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(c.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onChangePlan(c)}
                        className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 ml-auto"
                      >
                        Change plan <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Users ───────────────────────────────────────────────────────────

interface UserTableProps {
  users: AdminUser[];
  loading: boolean;
  error: string | null;
  search: string;
  onSearchChange: (v: string) => void;
  roleFilter: string;
  onRoleChange: (v: string) => void;
  onRetry: () => void;
}

function UserTable({
  users, loading, error, search, onSearchChange,
  roleFilter, onRoleChange, onRetry,
}: UserTableProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            placeholder="Search users..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <select
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          value={roleFilter}
          onChange={e => onRoleChange(e.target.value)}
        >
          <option value="">All roles</option>
          <option value="developer">Developer</option>
          <option value="manager">Manager</option>
          <option value="supervisor">Supervisor</option>
          <option value="operator">Operator</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>

      {loading ? (
        <SkeletonTable rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Email</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Company</th>
                <th className="text-left px-4 py-3 font-medium">Joined</th>
                <th className="text-left px-4 py-3 font-medium">Last Login</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-500">No users found</td>
                </tr>
              ) : (
                users.map(u => (
                  <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{u.display_name}</div>
                      {!u.is_active && (
                        <span className="text-xs text-red-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{u.email}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3 text-gray-400">{u.company_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {u.last_login ? formatRelative(u.last_login) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Activity ────────────────────────────────────────────────────────

interface ActivityFeedProps {
  activity: ActivityEntry[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function ActivityFeed({ activity, loading, error, onRetry }: ActivityFeedProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-14 bg-gray-900 border border-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {activity.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No activity yet</div>
      ) : (
        <div className="divide-y divide-gray-800">
          {activity.map(a => (
            <div key={a.id} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-800/30 transition-colors">
              <Activity size={14} className="mt-1 text-gray-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm">{a.action}</span>
                  {a.company_name && (
                    <span className="text-xs bg-gray-800 border border-gray-700 text-gray-400 px-1.5 py-0.5 rounded">
                      {a.company_name}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex gap-2">
                  <span>{a.entity_type}</span>
                  {a.actor && <span>by {a.actor}</span>}
                  <span>{formatRelative(a.created_at)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: System Health ───────────────────────────────────────────────────

interface SystemHealthProps {
  health: HealthData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function SystemHealth({ health, loading, error, onRetry }: SystemHealthProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 bg-gray-900 border border-gray-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!health) return null;

  const cards = [
    { icon: Clock,    label: 'Uptime',       value: formatUptime(health.uptime_seconds), color: 'text-green-400' },
    { icon: Cpu,      label: 'Memory',       value: `${health.memory_mb} MB`,             color: 'text-blue-400' },
    { icon: Database, label: 'DB Size',      value: `${health.db_size_mb} MB`,            color: 'text-purple-400' },
    { icon: Server,   label: 'Node Version', value: health.node_version,                  color: 'text-cyan-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className={`mb-3 ${c.color}`}><c.icon size={20} /></div>
            <div className="text-xl font-bold text-white">{c.value}</div>
            <div className="text-sm text-gray-400 mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500">Last checked: {new Date(health.timestamp).toLocaleString()}</div>
        <div className="mt-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm text-green-400">All systems operational</span>
        </div>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-gray-900 border border-red-900/50 rounded-xl p-6 flex flex-col items-center gap-3 text-center">
      <AlertCircle size={24} className="text-red-400" />
      <p className="text-red-400 text-sm">{message}</p>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
      >
        <RefreshCw size={14} /> Retry
      </button>
    </div>
  );
}

// ─── Plan Change Modal ────────────────────────────────────────────────────

interface PlanModalProps {
  company: Company;
  onClose: () => void;
  onSave: (tier: string, note: string) => Promise<void>;
}

function PlanModal({ company, onClose, onSave }: PlanModalProps) {
  const [tier, setTier] = useState(company.plan ?? 'free');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(tier, note);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update plan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold text-white mb-1">Change Plan</h2>
        <p className="text-sm text-gray-400 mb-5">{company.name}</p>

        <label className="block text-sm text-gray-300 mb-1.5">Plan tier</label>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-blue-500"
          value={tier}
          onChange={e => setTier(e.target.value)}
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>

        <label className="block text-sm text-gray-300 mb-1.5">Note (optional)</label>
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-5 focus:outline-none focus:border-blue-500 placeholder-gray-600"
          placeholder="Reason for change..."
          value={note}
          onChange={e => setNote(e.target.value)}
        />

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

type Tab = 'overview' | 'customers' | 'users' | 'activity' | 'system';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview',   label: 'Overview',   icon: TrendingUp },
  { id: 'customers',  label: 'Customers',  icon: Building2 },
  { id: 'users',      label: 'Users',      icon: Users },
  { id: 'activity',   label: 'Activity',   icon: Activity },
  { id: 'system',     label: 'System',     icon: Server },
];

export default function Admin() {
  const { isAtLeast } = useAuth();

  // Role guard — developer only
  if (!isAtLeast('developer')) return <Navigate to="/dashboard" replace />;

  const [tab, setTab] = useState<Tab>('overview');

  // ── Overview
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // ── Companies
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companySearch, setCompanySearch] = useState('');
  const [companyPlan, setCompanyPlan] = useState('');
  const [planModal, setPlanModal] = useState<Company | null>(null);

  // ── Users
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userRole, setUserRole] = useState('');

  // ── Activity
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // ── Health
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  // ── Loaders
  const loadStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError(null);
    api.getAdminStats()
      .then(setStats)
      .catch((e: unknown) => setStatsError(e instanceof Error ? e.message : 'Failed to load stats'))
      .finally(() => setStatsLoading(false));
  }, []);

  const loadCompanies = useCallback(() => {
    setCompaniesLoading(true);
    setCompaniesError(null);
    api.getAdminCompanies({ search: companySearch || undefined, plan: companyPlan || undefined, limit: 100 })
      .then(setCompanies)
      .catch((e: unknown) => setCompaniesError(e instanceof Error ? e.message : 'Failed to load companies'))
      .finally(() => setCompaniesLoading(false));
  }, [companySearch, companyPlan]);

  const loadUsers = useCallback(() => {
    setUsersLoading(true);
    setUsersError(null);
    api.getAdminUsers({ search: userSearch || undefined, role: userRole || undefined, limit: 200 })
      .then(setUsers)
      .catch((e: unknown) => setUsersError(e instanceof Error ? e.message : 'Failed to load users'))
      .finally(() => setUsersLoading(false));
  }, [userSearch, userRole]);

  const loadActivity = useCallback(() => {
    setActivityLoading(true);
    setActivityError(null);
    api.getAdminActivity({ limit: 100 })
      .then(setActivity)
      .catch((e: unknown) => setActivityError(e instanceof Error ? e.message : 'Failed to load activity'))
      .finally(() => setActivityLoading(false));
  }, []);

  const loadHealth = useCallback(() => {
    setHealthLoading(true);
    setHealthError(null);
    api.getAdminHealth()
      .then(setHealth)
      .catch((e: unknown) => setHealthError(e instanceof Error ? e.message : 'Failed to load health'))
      .finally(() => setHealthLoading(false));
  }, []);

  // Load stats immediately
  useEffect(() => { loadStats(); }, [loadStats]);

  // Load tab data on switch
  useEffect(() => {
    if (tab === 'customers') loadCompanies();
    if (tab === 'users')     loadUsers();
    if (tab === 'activity')  loadActivity();
    if (tab === 'system')    loadHealth();
  }, [tab, loadCompanies, loadUsers, loadActivity, loadHealth]);

  // Debounce company search
  useEffect(() => {
    if (tab !== 'customers') return;
    const t = setTimeout(loadCompanies, 300);
    return () => clearTimeout(t);
  }, [companySearch, companyPlan, tab, loadCompanies]);

  // Debounce user search
  useEffect(() => {
    if (tab !== 'users') return;
    const t = setTimeout(loadUsers, 300);
    return () => clearTimeout(t);
  }, [userSearch, userRole, tab, loadUsers]);

  const handleChangePlan = async (tier: string, note: string) => {
    if (!planModal) return;
    await api.updateAdminCompanyPlan(planModal.id, tier, note);
    await loadCompanies();
  };

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-purple-900/30 border border-purple-800 rounded-xl">
          <ShieldCheck size={22} className="text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-sm text-gray-500">Platform management — developer only</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewTab
          stats={stats}
          loading={statsLoading}
          error={statsError}
          onRetry={loadStats}
        />
      )}

      {tab === 'customers' && (
        <CompanyTable
          companies={companies}
          loading={companiesLoading}
          error={companiesError}
          search={companySearch}
          onSearchChange={setCompanySearch}
          planFilter={companyPlan}
          onPlanChange={setCompanyPlan}
          onRetry={loadCompanies}
          onChangePlan={c => setPlanModal(c)}
        />
      )}

      {tab === 'users' && (
        <UserTable
          users={users}
          loading={usersLoading}
          error={usersError}
          search={userSearch}
          onSearchChange={setUserSearch}
          roleFilter={userRole}
          onRoleChange={setUserRole}
          onRetry={loadUsers}
        />
      )}

      {tab === 'activity' && (
        <ActivityFeed
          activity={activity}
          loading={activityLoading}
          error={activityError}
          onRetry={loadActivity}
        />
      )}

      {tab === 'system' && (
        <SystemHealth
          health={health}
          loading={healthLoading}
          error={healthError}
          onRetry={loadHealth}
        />
      )}

      {/* Plan change modal */}
      {planModal && (
        <PlanModal
          company={planModal}
          onClose={() => setPlanModal(null)}
          onSave={handleChangePlan}
        />
      )}
    </div>
  );
}
