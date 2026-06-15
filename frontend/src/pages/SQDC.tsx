import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useSite } from '../context/SiteContext';
import {
  ShieldCheck, CheckCircle2, Truck, DollarSign, RefreshCw, Calendar,
  AlertTriangle, ClipboardList, LayoutGrid,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip, XAxis,
} from 'recharts';
import ModuleOnboarding from '../components/shared/ModuleOnboarding';

interface Department { id: string; name: string; color?: string; }

interface SQDCData {
  date: string;
  department_id: string | null;
  safety: {
    incidents_on_date: number;
    days_since_last_incident: number | null;
    incidents: { id: string; ncr_number: string; title: string; severity: string; status: string }[];
  };
  quality: {
    pass_rate: number | null;
    first_pass_yield: number | null;
    units_inspected: number;
    pass_count: number;
    fail_count: number;
    ncrs_opened: number;
    ncrs_closed: number;
  };
  delivery: {
    due_count: number;
    completed_of_due: number;
    completed_on_date: number;
    on_time_pct: number | null;
    overdue_count: number;
    due_orders: { id: string; work_order_number: string; part_name?: string; status: string; on_time: boolean }[];
  };
  cost: {
    labor_hours: number;
    labor_rate: number;
    labor_cost: number;
    units_produced: number;
    cost_per_unit: number | null;
  };
  trend: { date: string; pass_rate: number; units: number; safety_incidents: number }[];
}

type Status = 'green' | 'amber' | 'red' | 'neutral';

const STATUS_STYLE: Record<Status, { header: string; text: string }> = {
  green:   { header: 'bg-emerald-500', text: 'text-emerald-600' },
  amber:   { header: 'bg-amber-500',   text: 'text-amber-600' },
  red:     { header: 'bg-red-500',     text: 'text-red-600' },
  neutral: { header: 'bg-slate-400',   text: 'text-slate-600' },
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Panel({
  title, icon: Icon, status, statusLabel, headline, headlineSub, children,
}: {
  title: string;
  icon: React.ElementType;
  status: Status;
  statusLabel: string;
  headline: React.ReactNode;
  headlineSub?: string;
  children?: React.ReactNode;
}) {
  const s = STATUS_STYLE[status];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className={`${s.header} px-5 py-3 flex items-center justify-between text-white`}>
        <div className="flex items-center gap-2">
          <Icon size={18} />
          <h2 className="font-semibold tracking-tight">{title}</h2>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full">
          {statusLabel}
        </span>
      </div>
      <div className="p-5 flex flex-col gap-4 flex-1">
        <div>
          <div className={`text-4xl font-bold tracking-tight ${s.text}`}>{headline}</div>
          {headlineSub && <div className="text-xs text-gray-500 mt-1">{headlineSub}</div>}
        </div>
        <div className="space-y-2 flex-1">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

export default function SQDC() {
  const { selectedSiteId } = useSite();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptId, setDeptId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [data, setData] = useState<SQDCData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.getDepartments({ site_id: selectedSiteId || undefined })
      .then(setDepartments)
      .catch(() => {});
  }, [selectedSiteId]);

  const load = useCallback(async (spin = false) => {
    if (spin) setRefreshing(true);
    try {
      const res = await api.getSQDC({ date, department_id: deptId || undefined });
      setData(res);
    } catch {
      /* keep stale */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, deptId]);

  useEffect(() => {
    setLoading(true);
    load(false);
  }, [load]);

  // ─── Status thresholds ─────────────────────────────────────────────────────
  const safetyStatus: Status = !data ? 'neutral'
    : data.safety.incidents_on_date > 0 ? 'red'
    : (data.safety.days_since_last_incident ?? 999) < 7 ? 'amber'
    : 'green';

  const qualityStatus: Status = !data || data.quality.pass_rate == null ? 'neutral'
    : data.quality.pass_rate >= 98 ? 'green'
    : data.quality.pass_rate >= 90 ? 'amber'
    : 'red';

  const deliveryStatus: Status = !data ? 'neutral'
    : data.delivery.overdue_count > 0 ? 'red'
    : data.delivery.on_time_pct == null ? 'green'
    : data.delivery.on_time_pct >= 95 ? 'green'
    : data.delivery.on_time_pct >= 80 ? 'amber'
    : 'red';

  const costStatus: Status = !data ? 'neutral'
    : data.cost.labor_hours === 0 ? 'neutral' : 'green';

  const isToday = date === todayISO();

  return (
    <div className="p-6 space-y-6">
      <ModuleOnboarding
        moduleId="sqdc"
        title="SQDC Production Board"
        description="The four classic lean metrics — Safety, Quality, Delivery, and Cost — for any day. A single board to run your daily stand-up."
        steps={[
          'Pick a date (defaults to today)',
          'Optionally filter to a single department',
          'Each panel turns green, amber, or red against its target',
          'Review the headline number and supporting detail rows',
        ]}
        icon={LayoutGrid}
        color="#6366f1"
      />

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
            <LayoutGrid size={18} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">SQDC Board</h1>
            <p className="text-xs text-gray-500 mt-0.5">Safety · Quality · Delivery · Cost</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg shadow-sm">
            <Calendar size={14} className="text-gray-400" />
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={e => setDate(e.target.value || todayISO())}
              className="text-sm text-gray-700 bg-transparent outline-none"
            />
          </div>
          <select
            value={deptId}
            onChange={e => setDeptId(e.target.value)}
            className="input-field text-sm"
          >
            <option value="">All departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 shadow-sm"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin text-indigo-500' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <RefreshCw size={28} className="animate-spin text-indigo-500" />
        </div>
      ) : !data ? (
        <div className="text-center py-24 text-gray-400">Unable to load SQDC data.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
            {/* SAFETY */}
            <Panel
              title="Safety"
              icon={ShieldCheck}
              status={safetyStatus}
              statusLabel={safetyStatus === 'red' ? 'Incident' : safetyStatus === 'amber' ? 'Watch' : 'Clear'}
              headline={
                data.safety.incidents_on_date > 0
                  ? `${data.safety.incidents_on_date}`
                  : `${data.safety.days_since_last_incident ?? '∞'}`
              }
              headlineSub={
                data.safety.incidents_on_date > 0
                  ? `incident${data.safety.incidents_on_date === 1 ? '' : 's'} on this date`
                  : data.safety.days_since_last_incident == null
                    ? 'No safety incidents on record'
                    : `days incident-free`
              }
            >
              {data.safety.incidents.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">
                  <ShieldCheck size={15} />
                  <span>No safety incidents reported.</span>
                </div>
              ) : (
                data.safety.incidents.map(i => (
                  <div key={i.id} className="flex items-start gap-2 text-sm bg-red-50 rounded-lg px-3 py-2">
                    <AlertTriangle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-red-700 truncate">{i.ncr_number} · {i.severity}</div>
                      <div className="text-red-600/80 text-xs truncate">{i.title}</div>
                    </div>
                  </div>
                ))
              )}
            </Panel>

            {/* QUALITY */}
            <Panel
              title="Quality"
              icon={CheckCircle2}
              status={qualityStatus}
              statusLabel={qualityStatus === 'green' ? 'On Target' : qualityStatus === 'amber' ? 'At Risk' : qualityStatus === 'red' ? 'Below' : '—'}
              headline={data.quality.pass_rate == null ? '—' : `${data.quality.pass_rate}%`}
              headlineSub="pass rate (first-pass yield)"
            >
              <Row label="Units inspected" value={data.quality.units_inspected} />
              <Row label="Pass / Fail" value={<span><span className="text-emerald-600">{data.quality.pass_count}</span> / <span className="text-red-600">{data.quality.fail_count}</span></span>} />
              <Row label="NCRs opened" value={data.quality.ncrs_opened} tone={data.quality.ncrs_opened > 0 ? 'text-red-600' : undefined} />
              <Row label="NCRs closed" value={data.quality.ncrs_closed} tone={data.quality.ncrs_closed > 0 ? 'text-emerald-600' : undefined} />
            </Panel>

            {/* DELIVERY */}
            <Panel
              title="Delivery"
              icon={Truck}
              status={deliveryStatus}
              statusLabel={deliveryStatus === 'green' ? 'On Time' : deliveryStatus === 'amber' ? 'At Risk' : deliveryStatus === 'red' ? 'Behind' : '—'}
              headline={data.delivery.on_time_pct == null ? '—' : `${data.delivery.on_time_pct}%`}
              headlineSub="on-time delivery"
            >
              <Row label="Due this date" value={data.delivery.due_count} />
              <Row label="Completed of due" value={`${data.delivery.completed_of_due} / ${data.delivery.due_count}`} />
              <Row label="Completed (any)" value={data.delivery.completed_on_date} tone="text-emerald-600" />
              <Row label="Overdue now" value={data.delivery.overdue_count} tone={data.delivery.overdue_count > 0 ? 'text-red-600' : undefined} />
            </Panel>

            {/* COST */}
            <Panel
              title="Cost"
              icon={DollarSign}
              status={costStatus}
              statusLabel={costStatus === 'neutral' ? 'No Data' : 'Tracked'}
              headline={`$${data.cost.labor_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              headlineSub={`labor cost @ $${data.cost.labor_rate}/hr`}
            >
              <Row label="Labor hours" value={data.cost.labor_hours.toFixed(1)} />
              <Row label="Units produced" value={data.cost.units_produced} />
              <Row label="Cost / unit" value={data.cost.cost_per_unit == null ? '—' : `$${data.cost.cost_per_unit.toFixed(2)}`} />
            </Panel>
          </div>

          {/* Trend strip + delivery detail */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={15} className="text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-900">Quality — 7-day pass rate</h3>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data.trend} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="qGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, 'Pass rate']}
                    labelFormatter={(l) => new Date(l + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  />
                  <Area type="monotone" dataKey="pass_rate" stroke="#6366f1" strokeWidth={2} fill="url(#qGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Truck size={15} className="text-emerald-500" />
                <h3 className="text-sm font-semibold text-gray-900">Output — 7-day units</h3>
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={data.trend} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    formatter={(v: number) => [v, 'Units']}
                    labelFormatter={(l) => new Date(l + 'T00:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  />
                  <Bar dataKey="units" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <ClipboardList size={15} className="text-indigo-500" />
                <h3 className="text-sm font-semibold text-gray-900">Orders due {isToday ? 'today' : 'this date'}</h3>
              </div>
              {data.delivery.due_orders.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No work orders due.</p>
              ) : (
                <div className="space-y-2 max-h-[120px] overflow-y-auto">
                  {data.delivery.due_orders.map(o => (
                    <div key={o.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700 truncate mr-2">{o.work_order_number}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        o.status === 'completed'
                          ? (o.on_time ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {o.status === 'completed' ? (o.on_time ? 'On time' : 'Late') : 'Open'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
