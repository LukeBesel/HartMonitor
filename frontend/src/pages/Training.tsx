import { useEffect, useState, useMemo } from 'react';
import {
  GraduationCap, Award, ClipboardList, BarChart3, Plus, X, Pencil, Trash2,
  CheckCircle2, Clock, AlertTriangle, XCircle, RefreshCw, Search, ChevronDown,
  ChevronRight, User, Building2, Calendar, Download, Shield,
} from 'lucide-react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import {
  ENFORCEMENT_COPY, getBlockedStarts, getEnforcement, getOverrides, putEnforcement,
} from '../api/training';
import type {
  BlockedStarts, QualificationOverride, TrainingEnforcement,
} from '../api/training';
import TabBar from '../components/shared/TabBar';
import { useAuth } from '../context/AuthContext';

// ─── Status helpers ───────────────────────────────────────────────────────────

type TrainingStatus = 'not_started' | 'in_training' | 'certified' | 'expired' | 'needs_refresh';

const STATUS_CFG: Record<TrainingStatus, { label: string; color: string; bg: string; icon: any }> = {
  not_started:   { label: 'Not Started',    color: 'text-gray-500',    bg: 'bg-gray-100',    icon: XCircle },
  in_training:   { label: 'In Training',    color: 'text-blue-700',    bg: 'bg-blue-100',    icon: Clock },
  certified:     { label: 'Certified',      color: 'text-emerald-700', bg: 'bg-emerald-100', icon: CheckCircle2 },
  expired:       { label: 'Expired',        color: 'text-red-700',     bg: 'bg-red-100',     icon: AlertTriangle },
  needs_refresh: { label: 'Needs Refresh',  color: 'text-amber-700',   bg: 'bg-amber-100',   icon: RefreshCw },
};

function StatusBadge({ status }: { status: TrainingStatus | string }) {
  const cfg = STATUS_CFG[status as TrainingStatus] ?? STATUS_CFG.not_started;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isExpiringSoon(date?: string | null): boolean {
  if (!date) return false;
  const diff = new Date(date).getTime() - Date.now();
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
}

function isExpired(date?: string | null): boolean {
  if (!date) return false;
  return new Date(date).getTime() < Date.now();
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ icon, iconBg, label, value, sub, warn }: any) {
  return (
    <div className={`stat-card ${warn ? 'border border-amber-200' : ''}`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`text-2xl font-bold ${warn ? 'text-amber-700' : 'text-gray-900'}`}>{value}</div>
          <div className="text-xs font-medium text-gray-500">{label}</div>
          {sub && <div className="text-xs text-gray-400">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Matrix cell ──────────────────────────────────────────────────────────────

function MatrixCell({
  record, onEdit,
}: {
  record?: { status: TrainingStatus; certified_date?: string; expiry_date?: string };
  onEdit: () => void;
}) {
  if (!record || record.status === 'not_started') {
    return (
      <button
        onClick={onEdit}
        className="w-full h-8 flex items-center justify-center hover:bg-gray-100 rounded transition-colors group"
        title="Not started — click to update"
      >
        <span className="text-gray-200 group-hover:text-gray-400 text-lg">—</span>
      </button>
    );
  }

  const cfg = STATUS_CFG[record.status] ?? STATUS_CFG.not_started;
  const Icon = cfg.icon;
  const expWarn = isExpiringSoon(record.expiry_date);
  const expBg = expWarn ? 'bg-amber-50' : cfg.bg;

  return (
    <button
      onClick={onEdit}
      className={`w-full h-8 flex items-center justify-center rounded transition-all hover:opacity-80 ${expBg}`}
      title={`${cfg.label}${record.certified_date ? ` · Certified ${fmtDate(record.certified_date)}` : ''}${record.expiry_date ? ` · Expires ${fmtDate(record.expiry_date)}` : ''}`}
    >
      <Icon size={14} className={expWarn ? 'text-amber-600' : cfg.color} />
    </button>
  );
}

// ─── Training Record Modal ────────────────────────────────────────────────────

function RecordModal({
  userId, appId, existing, operatorName, appName, onClose, onSaved,
}: {
  userId: string; appId: string; existing?: any;
  operatorName: string; appName: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    status: existing?.status ?? 'in_training',
    certified_date: existing?.certified_date?.slice(0, 10) ?? '',
    expiry_date: existing?.expiry_date?.slice(0, 10) ?? '',
    score: existing?.score ?? '',
    notes: existing?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await api.upsertTrainingRecord({
        user_id: userId, app_id: appId,
        status: form.status,
        certified_date: form.certified_date || undefined,
        expiry_date: form.expiry_date || undefined,
        score: form.score !== '' ? parseFloat(form.score) : undefined,
        notes: form.notes,
      });
      onSaved(); onClose();
    } catch (err: any) { setError(err.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Update Training Status</h2>
            <p className="text-xs text-gray-400 mt-0.5">{operatorName} · {appName}</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select className="input-field" value={form.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(STATUS_CFG).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Certified Date</label>
              <input className="input-field" type="date" value={form.certified_date} onChange={e => set('certified_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date</label>
              <input className="input-field" type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Score / Grade</label>
            <input className="input-field" type="number" min="0" max="100" step="0.1" value={form.score} onChange={e => set('score', e.target.value)} placeholder="Optional percentage score" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input-field resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving && <RefreshCw size={14} className="animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Certification Modal ──────────────────────────────────────────────────────

function CertModal({
  cert, operators, onClose, onSaved,
}: {
  cert: any | null; operators: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    user_id: cert?.user_id ?? '',
    name: cert?.name ?? '',
    issuer: cert?.issuer ?? '',
    cert_number: cert?.cert_number ?? '',
    issued_date: cert?.issued_date?.slice(0, 10) ?? '',
    expiry_date: cert?.expiry_date?.slice(0, 10) ?? '',
    notes: cert?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.user_id || !form.name) { setError('Operator and Certification Name are required.'); return; }
    setSaving(true); setError('');
    try {
      if (cert?.id) {
        await api.updateCertification(cert.id, form);
      } else {
        await api.createCertification(form);
      }
      onSaved(); onClose();
    } catch (err: any) { setError(err.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{cert ? 'Edit Certification' : 'Add Certification'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Operator *</label>
            <select className="input-field" value={form.user_id} onChange={e => set('user_id', e.target.value)}>
              <option value="">Select operator...</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>{op.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Certification Name *</label>
            <input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. OSHA 10, Forklift Operator, ISO 9001" />
          </div>
          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Issuing Body</label>
              <input className="input-field" value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="OSHA, company, etc." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Cert Number</label>
              <input className="input-field" value={form.cert_number} onChange={e => set('cert_number', e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="field-row gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Issue Date</label>
              <input className="input-field" type="date" value={form.issued_date} onChange={e => set('issued_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Expiry Date</label>
              <input className="input-field" type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input-field resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving && <RefreshCw size={14} className="animate-spin" />}
              {cert ? 'Save Changes' : 'Add Certification'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Plan Modal ───────────────────────────────────────────────────────────────

function PlanModal({
  plan, operators, apps, onClose, onSaved,
}: {
  plan: any | null; operators: any[]; apps: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    user_id: plan?.user_id ?? '',
    app_id: plan?.app_id ?? '',
    target_date: plan?.target_date?.slice(0, 10) ?? '',
    notes: plan?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.user_id || !form.app_id) { setError('Operator and App are required.'); return; }
    setSaving(true); setError('');
    try {
      if (plan?.id) {
        await api.updateTrainingPlan(plan.id, form);
      } else {
        await api.createTrainingPlan(form);
      }
      onSaved(); onClose();
    } catch (err: any) { setError(err.message || 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">{plan ? 'Edit Training Plan' : 'Assign Training'}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Operator *</label>
            <select className="input-field" value={form.user_id} onChange={e => set('user_id', e.target.value)}>
              <option value="">Select operator...</option>
              {operators.map(op => (
                <option key={op.id} value={op.id}>{op.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Work Instruction (App) *</label>
            <select className="input-field" value={form.app_id} onChange={e => set('app_id', e.target.value)}>
              <option value="">Select app...</option>
              {apps.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Target Completion Date</label>
            <input className="input-field" type="date" value={form.target_date} onChange={e => set('target_date', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input-field resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving && <RefreshCw size={14} className="animate-spin" />}
              {plan ? 'Save Changes' : 'Assign Training'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Matrix Tab ───────────────────────────────────────────────────────────────

function MatrixTab({ matrix, loading, error, onRefresh }: { matrix: any; loading: boolean; error?: string | null; onRefresh: () => void }) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [editCell, setEditCell] = useState<{ userId: string; appId: string } | null>(null);

  const operators = useMemo(() => {
    let ops = matrix?.operators ?? [];
    if (search) ops = ops.filter((o: any) => o.display_name.toLowerCase().includes(search.toLowerCase()));
    if (deptFilter) ops = ops.filter((o: any) => o.department_id === deptFilter);
    return ops;
  }, [matrix, search, deptFilter]);

  const apps = matrix?.apps ?? [];
  const recordMap = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of matrix?.records ?? []) m[`${r.user_id}::${r.app_id}`] = r;
    return m;
  }, [matrix]);

  const departments = useMemo(() => {
    const seen = new Set<string>();
    const result: { id: string; name: string }[] = [];
    for (const op of matrix?.operators ?? []) {
      if (op.department_id && op.department_name && !seen.has(op.department_id)) {
        seen.add(op.department_id);
        result.push({ id: op.department_id, name: op.department_name });
      }
    }
    return result;
  }, [matrix]);

  const editingCell = editCell ? {
    operator: matrix?.operators?.find((o: any) => o.id === editCell.userId),
    app: matrix?.apps?.find((a: any) => a.id === editCell.appId),
    record: recordMap[`${editCell.userId}::${editCell.appId}`],
  } : null;

  if (loading) {
    return (
      <div className="card p-6 space-y-3">
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-12 text-center">
        <AlertTriangle size={36} className="mx-auto text-red-400 mb-3" />
        <p className="text-gray-500 font-medium">Couldn't load the skills matrix</p>
        <p className="text-sm text-gray-400 mt-1">{error}</p>
        <button onClick={onRefresh} className="btn-secondary mt-4 mx-auto">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!matrix || apps.length === 0) {
    return (
      <div className="card p-12 text-center">
        <GraduationCap size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-gray-500 font-medium">No published apps to train against</p>
        <p className="text-sm text-gray-400">Publish a work instruction app and it will appear as a skill column here.</p>
      </div>
    );
  }

  return (
    <>
      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input-field pl-9"
            placeholder="Search operators..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {departments.length > 0 && (
          <select className="input-field w-auto" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-3 text-xs text-gray-400 ml-auto">
          {Object.entries(STATUS_CFG).map(([k, v]) => {
            const Icon = v.icon;
            return (
              <span key={k} className="flex items-center gap-1">
                <Icon size={12} className={v.color} /> {v.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Matrix table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left font-medium text-gray-600 py-3 px-4 sticky left-0 bg-gray-50 z-10 min-w-[160px]">
                  Operator
                </th>
                {apps.map((app: any) => (
                  <th
                    key={app.id}
                    className="font-medium text-gray-600 py-3 px-2 min-w-[80px] max-w-[120px]"
                    title={app.name}
                  >
                    <div className="text-xs truncate max-w-[100px] mx-auto text-center">{app.name}</div>
                  </th>
                ))}
                <th className="font-medium text-gray-600 py-3 px-4 text-center min-w-[80px]">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {operators.length === 0 ? (
                <tr>
                  <td colSpan={apps.length + 2} className="text-center text-gray-400 py-8">
                    No operators found
                  </td>
                </tr>
              ) : operators.map((op: any) => {
                const certified = apps.filter((a: any) => recordMap[`${op.id}::${a.id}`]?.status === 'certified').length;
                const pct = apps.length > 0 ? Math.round((certified / apps.length) * 100) : 0;
                return (
                  <tr key={op.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                    <td className="py-2 px-4 sticky left-0 bg-white group-hover:bg-gray-50/50 z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {op.display_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 text-xs truncate">{op.display_name}</div>
                          {op.department_name && (
                            <div className="text-[10px] text-gray-400 truncate">{op.department_name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {apps.map((app: any) => (
                      <td key={app.id} className="py-1 px-1">
                        <MatrixCell
                          record={recordMap[`${op.id}::${app.id}`]}
                          onEdit={() => setEditCell({ userId: op.id, appId: app.id })}
                        />
                      </td>
                    ))}
                    <td className="py-2 px-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editCell && editingCell?.operator && editingCell?.app && (
        <RecordModal
          userId={editCell.userId}
          appId={editCell.appId}
          existing={editingCell.record}
          operatorName={editingCell.operator.display_name}
          appName={editingCell.app.name}
          onClose={() => setEditCell(null)}
          onSaved={() => { onRefresh(); setEditCell(null); }}
        />
      )}
    </>
  );
}

// ─── Certifications Tab ───────────────────────────────────────────────────────

function CertificationsTab({
  certs, operators, loading, canEdit, onRefresh,
}: { certs: any[]; operators: any[]; loading: boolean; canEdit: boolean; onRefresh: () => void }) {
  const [editCert, setEditCert] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return certs;
    const q = search.toLowerCase();
    return certs.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.operator_name?.toLowerCase().includes(q) ||
      c.issuer?.toLowerCase().includes(q)
    );
  }, [certs, search]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this certification?')) return;
    setDeleting(id);
    try {
      await api.deleteCertification(id);
      onRefresh();
    } finally { setDeleting(null); }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input-field pl-9" placeholder="Search certifications..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {canEdit && (
          <button onClick={() => { setEditCert(null); setShowModal(true); }} className="btn-primary flex items-center gap-1.5">
            <Plus size={15} /> Add Certification
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Award size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No certifications yet</p>
          <p className="text-sm text-gray-400">Add OSHA, forklift, ISO, or any other external certifications.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* The table scrolls inside itself: several of these columns do not fit
              a phone, and the rounded card around it clipped them off entirely. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Operator</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Certification</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Issuer</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Issued</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Expires</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Status</th>
                  {canEdit && <th className="py-3 px-4" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map(cert => {
                  const expired = isExpired(cert.expiry_date);
                  const expiring = !expired && isExpiringSoon(cert.expiry_date);
                  return (
                    <tr key={cert.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">
                            {cert.operator_name?.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-900">{cert.operator_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-gray-900">{cert.name}</div>
                        {cert.cert_number && <div className="text-xs text-gray-400">#{cert.cert_number}</div>}
                      </td>
                      <td className="py-3 px-4 text-gray-600">{cert.issuer || '—'}</td>
                      <td className="py-3 px-4 text-gray-500 text-sm">{fmtDate(cert.issued_date)}</td>
                      <td className="py-3 px-4">
                        {cert.expiry_date ? (
                          <span className={`text-sm font-medium ${expired ? 'text-red-600' : expiring ? 'text-amber-600' : 'text-gray-600'}`}>
                            {fmtDate(cert.expiry_date)}
                          </span>
                        ) : <span className="text-gray-400 text-sm">No expiry</span>}
                      </td>
                      <td className="py-3 px-4">
                        {!cert.expiry_date ? (
                          <span className="badge badge-green">Active</span>
                        ) : expired ? (
                          <span className="badge badge-red">Expired</span>
                        ) : expiring ? (
                          <span className="badge badge-amber">Expiring Soon</span>
                        ) : (
                          <span className="badge badge-green">Valid</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => { setEditCert(cert); setShowModal(true); }} className="btn-ghost p-1.5 rounded-lg" title="Edit">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => handleDelete(cert.id)} disabled={deleting === cert.id} className="btn-ghost p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Delete">
                              {deleting === cert.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <CertModal
          cert={editCert}
          operators={operators}
          onClose={() => { setShowModal(false); setEditCert(null); }}
          onSaved={() => { onRefresh(); setShowModal(false); setEditCert(null); }}
        />
      )}
    </>
  );
}

// ─── Training Plans Tab ───────────────────────────────────────────────────────

function PlansTab({
  plans, operators, apps, loading, canEdit, onRefresh,
}: { plans: any[]; operators: any[]; apps: any[]; loading: boolean; canEdit: boolean; onRefresh: () => void }) {
  const [editPlan, setEditPlan] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let p = plans;
    if (statusFilter) p = p.filter(pl => pl.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      p = p.filter(pl => pl.operator_name?.toLowerCase().includes(q) || pl.app_name?.toLowerCase().includes(q));
    }
    return p;
  }, [plans, search, statusFilter]);

  const planStatusCfg: Record<string, { label: string; badge: string }> = {
    pending:     { label: 'Pending',     badge: 'badge-gray' },
    in_progress: { label: 'In Progress', badge: 'badge-blue' },
    completed:   { label: 'Completed',   badge: 'badge-green' },
    overdue:     { label: 'Overdue',     badge: 'badge-red' },
  };

  async function handleDelete(id: string) {
    if (!confirm('Delete this training plan?')) return;
    setDeleting(id);
    try {
      await api.deleteTrainingPlan(id);
      onRefresh();
    } finally { setDeleting(null); }
  }

  async function markComplete(plan: any) {
    try {
      await api.updateTrainingPlan(plan.id, { status: 'completed' });
      onRefresh();
    } catch {}
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of plans) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [plans]);

  return (
    <>
      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { key: '', label: 'All', count: plans.length },
          { key: 'overdue', label: 'Overdue', count: counts.overdue ?? 0 },
          { key: 'pending', label: 'Pending', count: counts.pending ?? 0 },
          { key: 'in_progress', label: 'In Progress', count: counts.in_progress ?? 0 },
          { key: 'completed', label: 'Completed', count: counts.completed ?? 0 },
        ].map(chip => (
          <button
            key={chip.key}
            onClick={() => setStatusFilter(chip.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              statusFilter === chip.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {chip.label}
            {chip.count > 0 && (
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                statusFilter === chip.key ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'
              }`}>{chip.count}</span>
            )}
          </button>
        ))}
        <div className="flex-1 flex gap-3 justify-end">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-9 w-48" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {canEdit && (
            <button onClick={() => { setEditPlan(null); setShowModal(true); }} className="btn-primary flex items-center gap-1.5">
              <Plus size={15} /> Assign Training
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardList size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">No training plans</p>
          <p className="text-sm text-gray-400">Assign training to operators to track progress.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {/* The table scrolls inside itself: several of these columns do not fit
              a phone, and the rounded card around it clipped them off entirely. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Operator</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Work Instruction</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Assigned By</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Target Date</th>
                  <th className="text-left font-medium text-gray-600 py-3 px-4">Status</th>
                  {canEdit && <th className="py-3 px-4" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map(plan => {
                  const cfg = planStatusCfg[plan.status] ?? planStatusCfg.pending;
                  return (
                    <tr key={plan.id} className={`border-b border-gray-50 hover:bg-gray-50 ${plan.status === 'overdue' ? 'bg-red-50/30' : ''}`}>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">
                            {plan.operator_name?.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-900">{plan.operator_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-gray-700 font-medium">{plan.app_name}</td>
                      <td className="py-3 px-4 text-gray-500">{plan.assigned_by_name || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={`text-sm ${plan.status === 'overdue' ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                          {fmtDate(plan.target_date)}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                      </td>
                      {canEdit && (
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1 justify-end">
                            {plan.status !== 'completed' && (
                              <button onClick={() => markComplete(plan)} className="btn-ghost p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50" title="Mark Complete">
                                <CheckCircle2 size={13} />
                              </button>
                            )}
                            <button onClick={() => { setEditPlan(plan); setShowModal(true); }} className="btn-ghost p-1.5 rounded-lg" title="Edit">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => handleDelete(plan.id)} disabled={deleting === plan.id} className="btn-ghost p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Delete">
                              {deleting === plan.id ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <PlanModal
          plan={editPlan}
          operators={operators}
          apps={apps}
          onClose={() => { setShowModal(false); setEditPlan(null); }}
          onSaved={() => { onRefresh(); setShowModal(false); setEditPlan(null); }}
        />
      )}
    </>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

// coverage_pct is null (with empty_reason) rather than 0 when the plant has
// nothing to certify against yet for this department — a locally widened
// type, since backend/src/routes/training.js's summary response is typed
// `any` end to end in this file (see api/client.ts's getTrainingSummary).
type DeptCoverage = { id: string; name: string; operator_count: number; coverage_pct: number | null; empty_reason?: string | null };

// Defensive dedupe: the backend now merges same-named departments, but old
// cached responses (or other clients) may still contain duplicates — keep the
// first entry per department name so 'Assembly' never lists twice.
function dedupeDeptCoverage(rows: DeptCoverage[] | undefined | null): DeptCoverage[] {
  const seen = new Map<string, DeptCoverage>();
  for (const dept of rows ?? []) {
    const key = String(dept.name ?? '').trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, dept);
  }
  return [...seen.values()];
}

function OverviewTab({ summary, loading }: { summary: any; loading: boolean }) {
  const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());
  const departmentCoverage = useMemo(
    () => dedupeDeptCoverage(summary?.department_coverage),
    [summary],
  );

  function toggleOp(id: string) {
    setExpandedOps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (loading || !summary) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<GraduationCap size={18} className="text-indigo-600" />}
          iconBg="bg-indigo-50"
          label="Overall Coverage"
          // Nothing required yet (no operators, or no published apps) reads as
          // "—" and says why — never "0%" or "0 of 0 certified", both of which
          // read as a plant that is failing its training instead of one that
          // has not been asked to certify anything.
          value={summary.coverage_pct == null ? '—' : `${Math.round(summary.coverage_pct)}%`}
          sub={summary.coverage_pct == null
            ? (summary.empty_reason || 'no certifications required yet')
            : `${summary.certified_count} / ${summary.total_possible} certified`}
        />
        <KpiCard
          icon={<User size={18} className="text-blue-600" />}
          iconBg="bg-blue-50"
          label="Operators Tracked"
          value={summary.total_operators ?? 0}
          sub="in the system"
        />
        <KpiCard
          icon={<AlertTriangle size={18} className="text-amber-600" />}
          iconBg="bg-amber-50"
          label="Expiring in 30 Days"
          value={summary.expiring_soon ?? 0}
          sub="certs + training records"
          warn={(summary.expiring_soon ?? 0) > 0}
        />
        <KpiCard
          icon={<ClipboardList size={18} className="text-red-600" />}
          iconBg="bg-red-50"
          label="Overdue Training Plans"
          value={summary.overdue_plans ?? 0}
          sub="past target date"
          warn={(summary.overdue_plans ?? 0) > 0}
        />
      </div>

      {/* Department coverage */}
      {departmentCoverage.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Department Training Coverage</h3>
          </div>
          <div className="space-y-3">
            {departmentCoverage.map((dept) => (
              <div key={dept.id}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-gray-800">{dept.name}</span>
                  {/* A department with nobody in it has no coverage to report —
                      showing a red 0% reads as "untrained", which isn't true.
                      Same for one with operators but nothing yet required of
                      them (no published apps): coverage_pct is null there too. */}
                  {dept.operator_count === 0 ? (
                    <span className="text-xs text-gray-400 font-normal">No operators assigned</span>
                  ) : dept.coverage_pct == null ? (
                    <span className="text-xs text-gray-400 font-normal">
                      {dept.empty_reason || 'no certifications required yet'}
                    </span>
                  ) : (
                    <span className={`font-semibold text-xs ${dept.coverage_pct >= 80 ? 'text-emerald-600' : dept.coverage_pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                      {Math.round(dept.coverage_pct)}%
                      <span className="text-gray-400 font-normal ml-1">({dept.operator_count} operator{dept.operator_count === 1 ? '' : 's'})</span>
                    </span>
                  )}
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${dept.coverage_pct == null ? '' : dept.coverage_pct >= 80 ? 'bg-emerald-400' : dept.coverage_pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${dept.coverage_pct ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uncertified operators */}
      {summary.uncertified_operators?.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={15} className="text-red-500" />
            <h3 className="text-sm font-semibold text-gray-700">Operators Needing Training</h3>
          </div>
          <div className="space-y-2">
            {summary.uncertified_operators.slice(0, 15).map((op: any) => {
              const pct = op.total_apps > 0 ? Math.round((op.certified_apps / op.total_apps) * 100) : 0;
              const isOpen = expandedOps.has(op.id);
              return (
                <div key={op.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleOp(op.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {op.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 text-sm">{op.display_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs">
                        <span className={`font-semibold ${pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                        <span className="text-gray-400 ml-1">{op.certified_apps}/{op.total_apps} apps</span>
                      </div>
                      {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Enforcement Tab ──────────────────────────────────────────────────────────
// The one screen where a company decides whether the skills matrix is a record
// or a rule. Every option states its consequence in the words a plant manager
// would use, because the difference between Warn and Block is the difference
// between a report and a stopped line.

function EnforcementTab({
  setting, blocked, loading, canSet, saving, error, onSelect,
}: {
  setting: TrainingEnforcement | null;
  blocked: BlockedStarts | null;
  loading: boolean;
  canSet: boolean;
  saving: boolean;
  error: string | null;
  onSelect: (value: TrainingEnforcement) => void;
}) {
  if (loading) {
    return <div className="card p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>;
  }

  const options: TrainingEnforcement[] = ['off', 'warn', 'block'];

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <Shield size={18} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">When someone unqualified starts a job</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Applies to every published app. New companies start on Off — nothing changes
              until you choose otherwise.
            </p>
          </div>
        </div>

        <div role="radiogroup" aria-label="Training enforcement" className="space-y-2">
          {options.map(opt => {
            const active = setting === opt;
            return (
              <button
                key={opt}
                role="radio"
                aria-checked={active}
                disabled={!canSet || saving}
                onClick={() => onSelect(opt)}
                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                  active
                    ? 'border-indigo-400 bg-indigo-50/60'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                } ${!canSet || saving ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                    active ? 'border-indigo-600' : 'border-gray-300'
                  }`}>
                    {active && <span className="w-2 h-2 rounded-full bg-indigo-600" />}
                  </span>
                  <span className="font-semibold text-gray-900">{ENFORCEMENT_COPY[opt].label}</span>
                  {active && <span className="text-xs font-medium text-indigo-600">Current</span>}
                </div>
                <p className="text-sm text-gray-600 mt-1.5 ml-6">{ENFORCEMENT_COPY[opt].consequence}</p>
              </button>
            );
          })}
        </div>

        {!canSet && (
          <p className="text-sm text-gray-400 mt-3">
            Only a manager or above can change this.
          </p>
        )}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>

      {/* What the setting is costing, per app. An app that has refused nobody
          reads '—', never 0: "no starts were blocked" and "nothing has been
          measured" are different facts. */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Blocked starts this week</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {blocked?.empty_reason
              ? `Nothing to show — ${blocked.empty_reason}.`
              : `Runs refused in the last ${blocked?.days ?? 7} days because the operator was not signed off.`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left font-medium text-gray-600 py-2.5 px-5">App</th>
                <th className="text-right font-medium text-gray-600 py-2.5 px-5 min-w-[140px]">Blocked starts</th>
              </tr>
            </thead>
            <tbody>
              {(blocked?.apps ?? []).length === 0 ? (
                <tr><td colSpan={2} className="py-8 text-center text-gray-400">No published apps yet.</td></tr>
              ) : (blocked?.apps ?? []).map(row => (
                <tr key={row.app_id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2.5 px-5 text-gray-900">{row.app_name}</td>
                  <td className="py-2.5 px-5 text-right tabular-nums">
                    {row.blocked === null
                      ? <span className="text-gray-300" title="Nothing measured yet">—</span>
                      : <span className={row.blocked > 0 ? 'text-amber-700 font-semibold' : 'text-gray-500'}>
                          {row.blocked} blocked {row.blocked === 1 ? 'start' : 'starts'} this week
                        </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Overrides Tab ────────────────────────────────────────────────────────────
// Every time the gate was opened by hand: who ran what without a sign-off, who
// let them, and which run it was. This is the page an auditor is shown.

function OverridesTab({ overrides, loading }: { overrides: QualificationOverride[]; loading: boolean }) {
  if (loading) {
    return <div className="card p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}</div>;
  }

  if (overrides.length === 0) {
    return (
      <div className="card p-12 text-center">
        <Shield size={40} className="mx-auto text-gray-200 mb-3" />
        <p className="text-gray-500 font-medium">No overrides recorded</p>
        <p className="text-sm text-gray-400">
          A supervisor approving an uncertified start appears here, permanently, naming both people.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left font-medium text-gray-600 py-3 px-4">When</th>
              <th className="text-left font-medium text-gray-600 py-3 px-4">Operator</th>
              <th className="text-left font-medium text-gray-600 py-3 px-4">App</th>
              <th className="text-left font-medium text-gray-600 py-3 px-4">Approved by</th>
              <th className="text-left font-medium text-gray-600 py-3 px-4">Run</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map(o => (
              <tr key={o.id} className="border-b border-gray-50 last:border-0">
                <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{fmtDate(o.created_at)}</td>
                <td className="py-3 px-4 text-gray-900">
                  {o.operator_display_name || o.operator_name || <span className="text-gray-300">—</span>}
                </td>
                <td className="py-3 px-4 text-gray-700">{o.app_name || <span className="text-gray-300">—</span>}</td>
                <td className="py-3 px-4 text-gray-900">{o.approved_by_name || <span className="text-gray-300">—</span>}</td>
                <td className="py-3 px-4">
                  {o.completion_id
                    ? <a className="text-indigo-600 hover:underline" href={`/completions/${o.completion_id}`}>Open run</a>
                    : <span className="text-gray-300" title="The approval was never used to start a run">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Training Page ───────────────────────────────────────────────────────

type Tab = 'overview' | 'matrix' | 'certifications' | 'plans' | 'enforcement' | 'overrides';

// The old /training/certs and /training/plans nav entries were collapsed into
// the single /training item — its internal tabs are the sub-navigation. Legacy
// deep links (/training/:tab) still land on the matching internal tab.
function tabFromParam(param: string | undefined): Tab {
  switch (param) {
    case 'matrix':
    case 'skills': return 'matrix';
    case 'certs':
    case 'certifications': return 'certifications';
    case 'plans': return 'plans';
    case 'enforcement': return 'enforcement';
    case 'overrides': return 'overrides';
    default: return 'overview';
  }
}

export default function Training() {
  const { user } = useAuth();
  const canEdit = ['developer', 'manager', 'supervisor'].includes(user?.role ?? '');
  // Deciding that a missing certificate can STOP the line is a plant policy,
  // not a shift decision — the server requires manager or above and the screen
  // says so rather than offering a control that will be refused.
  const canSetEnforcement = ['developer', 'manager'].includes(user?.role ?? '');
  const { tab: tabParam } = useParams<{ tab: string }>();

  const [tab, setTab] = useState<Tab>(() => tabFromParam(tabParam));
  const [summary, setSummary] = useState<any>(null);
  const [matrix, setMatrix] = useState<any>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [certs, setCerts] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);
  const [apps, setApps] = useState<any[]>([]);
  const [enforcement, setEnforcement] = useState<TrainingEnforcement | null>(null);
  const [blocked, setBlocked] = useState<BlockedStarts | null>(null);
  const [overrides, setOverrides] = useState<QualificationOverride[]>([]);
  const [savingEnforcement, setSavingEnforcement] = useState(false);
  const [enforcementError, setEnforcementError] = useState<string | null>(null);
  const [loading, setLoading] = useState({
    overview: true, matrix: true, certs: true, plans: true, gate: true, overrides: true,
  });

  function setLoad(key: keyof typeof loading, val: boolean) {
    setLoading(l => ({ ...l, [key]: val }));
  }

  async function loadSummary() {
    setLoad('overview', true);
    try { setSummary(await api.getTrainingSummary()); }
    catch {} finally { setLoad('overview', false); }
  }

  async function loadMatrix() {
    setLoad('matrix', true);
    setMatrixError(null);
    // A failed load must surface — swallowing it made a broken endpoint look
    // like "you have no apps yet".
    try { setMatrix(await api.getTrainingMatrix()); }
    catch (err: any) { setMatrixError(err?.message || 'Failed to load the skills matrix'); }
    finally { setLoad('matrix', false); }
  }

  async function loadCerts() {
    setLoad('certs', true);
    try { setCerts(await api.getCertifications()); }
    catch {} finally { setLoad('certs', false); }
  }

  async function loadPlans() {
    setLoad('plans', true);
    try { setPlans(await api.getTrainingPlans()); }
    catch {} finally { setLoad('plans', false); }
  }

  async function loadGate() {
    setLoad('gate', true);
    try {
      const [setting, counts] = await Promise.all([getEnforcement(), getBlockedStarts(7)]);
      setEnforcement(setting.enforcement);
      setBlocked(counts);
    } catch (err: any) {
      setEnforcementError(err?.message || 'Failed to load the enforcement setting');
    } finally { setLoad('gate', false); }
  }

  async function loadOverrides() {
    setLoad('overrides', true);
    try { setOverrides(await getOverrides()); }
    catch {} finally { setLoad('overrides', false); }
  }

  async function chooseEnforcement(value: TrainingEnforcement) {
    if (value === enforcement) return;
    setSavingEnforcement(true);
    setEnforcementError(null);
    try {
      const saved = await putEnforcement(value);
      setEnforcement(saved.enforcement);
      await loadGate();
    } catch (err: any) {
      setEnforcementError(err?.message || 'Could not save that setting');
    } finally { setSavingEnforcement(false); }
  }

  async function loadOperatorsAndApps() {
    try {
      const [opsData, appsData] = await Promise.all([
        api.getUsers(),
        api.getApps(),
      ]);
      setOperators(opsData ?? []);
      setApps(appsData ?? []);
    } catch {}
  }

  useEffect(() => {
    loadSummary();
    loadMatrix();
    loadCerts();
    loadPlans();
    loadGate();
    loadOverrides();
    loadOperatorsAndApps();
  }, []);

  const TABS: { id: Tab; label: string; icon: any }[] = [
    { id: 'overview',       label: 'Overview',         icon: BarChart3 },
    { id: 'matrix',         label: 'Skills Matrix',    icon: GraduationCap },
    { id: 'certifications', label: 'Certifications',   icon: Award },
    { id: 'plans',          label: 'Training Plans',   icon: ClipboardList },
    { id: 'enforcement',    label: 'Enforcement',      icon: Shield },
    { id: 'overrides',      label: 'Overrides',        icon: User },
  ];

  function exportCSV() {
    const rows: string[][] = [['Operator', 'App', 'Status', 'Certified Date', 'Expiry Date', 'Score']];
    const recordMap: Record<string, any> = {};
    for (const r of matrix?.records ?? []) recordMap[`${r.user_id}::${r.app_id}`] = r;
    for (const op of matrix?.operators ?? []) {
      for (const app of matrix?.apps ?? []) {
        const r = recordMap[`${op.id}::${app.id}`];
        rows.push([
          op.display_name, app.name,
          r?.status ?? 'not_started',
          r?.certified_date ?? '',
          r?.expiry_date ?? '',
          r?.score?.toString() ?? '',
        ]);
      }
    }
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'skills-matrix.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {/* min-w-full below sm forces the actions onto their own line rather
            than squeezing the title into a two-line column beside them. */}
        <div className="flex-1 min-w-full sm:min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Training & Skills Matrix</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track operator certifications, app training, and coverage by department</p>
        </div>
        {tab === 'matrix' && (
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5">
            <Download size={15} /> Export CSV
          </button>
        )}
        <Calendar size={16} className="text-gray-300" />
        <span className="text-sm text-gray-400">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </div>

      <TabBar
        items={TABS.map(t => ({ key: t.id, label: t.label, icon: <t.icon size={15} /> }))}
        active={tab}
        onSelect={setTab}
        ariaLabel="Training screens"
      />

      {/* Tab content */}
      {tab === 'overview' && (
        <OverviewTab summary={summary} loading={loading.overview} />
      )}
      {tab === 'matrix' && (
        <MatrixTab
          matrix={matrix}
          loading={loading.matrix}
          error={matrixError}
          onRefresh={() => { loadMatrix(); loadSummary(); }}
        />
      )}
      {tab === 'certifications' && (
        <CertificationsTab
          certs={certs}
          operators={operators}
          loading={loading.certs}
          canEdit={canEdit}
          onRefresh={loadCerts}
        />
      )}
      {tab === 'enforcement' && (
        <EnforcementTab
          setting={enforcement}
          blocked={blocked}
          loading={loading.gate}
          canSet={canSetEnforcement}
          saving={savingEnforcement}
          error={enforcementError}
          onSelect={chooseEnforcement}
        />
      )}
      {tab === 'overrides' && (
        <OverridesTab overrides={overrides} loading={loading.overrides} />
      )}
      {tab === 'plans' && (
        <PlansTab
          plans={plans}
          operators={operators}
          apps={apps}
          loading={loading.plans}
          canEdit={canEdit}
          onRefresh={loadPlans}
        />
      )}
    </div>
  );
}
