import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { AnalyticsOverview, App, Completion } from '../types';
import {
  CheckCircle, Clock, Zap, TrendingUp, Play, AlertCircle,
  ArrowRight, Users, BarChart2
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [throughput, setThroughput] = useState<any[]>([]);
  const [recentCompletions, setRecentCompletions] = useState<Completion[]>([]);
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    Promise.all([
      api.getOverview(),
      api.getThroughput(14),
      api.getCompletions({ limit: 8 }),
      api.getApps(),
    ]).then(([ov, tp, comps, appList]) => {
      setOverview(ov);
      setThroughput(tp);
      setRecentCompletions(comps);
      setApps(appList);
    });
  }, []);

  const publishedApps = apps.filter(a => a.status === 'published');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manufacturing operations overview</p>
        </div>
        <Link to="/apps" className="btn-primary">
          <Zap size={14} />
          New App
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<CheckCircle size={20} className="text-green-600" />}
          bg="bg-green-50"
          label="Today's Completions"
          value={overview?.todayCompletions ?? '—'}
          sub={`${overview?.totalCompletions ?? 0} total`}
        />
        <StatCard
          icon={<Clock size={20} className="text-blue-600" />}
          bg="bg-blue-50"
          label="Avg Cycle Time"
          value={overview ? `${overview.avgCycleTime}m` : '—'}
          sub="per completion"
        />
        <StatCard
          icon={<TrendingUp size={20} className="text-purple-600" />}
          bg="bg-purple-50"
          label="Pass Rate"
          value={overview ? `${overview.passRate}%` : '—'}
          sub="quality checks"
        />
        <StatCard
          icon={<Zap size={20} className="text-orange-600" />}
          bg="bg-orange-50"
          label="In Progress"
          value={overview?.inProgress ?? '—'}
          sub={`${overview?.activeStations ?? 0} active stations`}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Throughput chart */}
        <div className="col-span-2 card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Daily Throughput</h2>
            <span className="text-xs text-gray-400">Last 14 days</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={throughput}>
              <defs>
                <linearGradient id="tpGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v) => [v, 'Completions']} labelFormatter={l => `Date: ${l}`} />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="url(#tpGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Quick stats */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Platform Status</h2>
          <div className="space-y-3">
            <PlatformStat label="Published Apps" value={overview?.publishedApps ?? 0} total={overview?.totalApps ?? 0} color="blue" />
            <PlatformStat label="Active Stations" value={overview?.activeStations ?? 0} total={overview?.activeStations ?? 0} color="green" />
          </div>
          <div className="pt-2 border-t border-gray-100 space-y-2">
            <Link to="/apps" className="flex items-center justify-between text-sm text-blue-600 hover:text-blue-700">
              <span>View all apps</span>
              <ArrowRight size={14} />
            </Link>
            <Link to="/analytics" className="flex items-center justify-between text-sm text-blue-600 hover:text-blue-700">
              <span>Full analytics</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Published apps */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Published Apps</h2>
            <Link to="/apps" className="text-xs text-blue-600 hover:text-blue-700">View all</Link>
          </div>
          <div className="space-y-2">
            {publishedApps.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-4">No published apps yet</p>
            )}
            {publishedApps.slice(0, 5).map(app => (
              <div key={app.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                <div>
                  <div className="font-medium text-sm text-gray-900">{app.name}</div>
                  <div className="text-xs text-gray-500">{app.steps.length} steps</div>
                </div>
                <Link
                  to={`/play/${app.id}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                >
                  <Play size={11} />
                  Run
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* Recent completions */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Recent Activity</h2>
            <Link to="/analytics" className="text-xs text-blue-600 hover:text-blue-700">View all</Link>
          </div>
          <div className="space-y-2">
            {recentCompletions.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-4">No completions yet</p>
            )}
            {recentCompletions.map(c => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                <StatusDot status={c.status} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-xs text-gray-900 truncate">{c.app_name}</div>
                  <div className="text-xs text-gray-500">{c.operator_name} · {formatTime(c.started_at)}</div>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  c.status === 'completed' ? 'bg-green-100 text-green-700' :
                  c.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {c.status === 'in_progress' ? 'Running' : c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, bg, label, value, sub }: any) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>{icon}</div>
        <div>
          <div className="text-2xl font-bold text-gray-900">{value}</div>
          <div className="text-xs text-gray-500 font-medium">{label}</div>
          <div className="text-xs text-gray-400">{sub}</div>
        </div>
      </div>
    </div>
  );
}

function PlatformStat({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full bg-${color}-500 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
      status === 'completed' ? 'bg-green-500' :
      status === 'in_progress' ? 'bg-blue-500' : 'bg-gray-400'
    }`} />
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}
