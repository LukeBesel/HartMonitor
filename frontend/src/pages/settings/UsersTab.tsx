// ─── Users, roles, floor PINs and per-role permissions ──────────────────────
import Toggle from '../../components/shared/Toggle';
import { useState, useEffect, useRef } from 'react';
import { AlertCircle, Users, Plus, Trash2, Edit2, X, Key, RotateCcw } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ALL_SECTION_ITEMS } from '../../config/navigation';
import { api } from '../../api/client';
import type { RolePermissionMap, AppRole } from '../../types';
import { Toast, ROLE_COLORS } from './shared';

// ─── Tab 5: Users & Permissions ───────────────────────────────────────────────

// The value is the STORED role; the label is the only name a screen prints
// for it. 'developer' is the level the account creator is given — they are the
// Owner of the company, and nobody has to know the word the database uses.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'developer',  label: 'Owner' },
  { value: 'manager',    label: 'Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'operator',   label: 'Operator' },
  { value: 'viewer',     label: 'Viewer' },
];

/** The name for a role when a row has no `display_role` from the API. */
function roleLabel(role: string): string {
  return ROLE_OPTIONS.find(r => r.value === role)?.label
    ?? (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');
}
function UserModal({ user, onClose, onSaved }: {
  user: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email ?? '',
    display_name: user?.display_name ?? '',
    role: user?.role ?? 'viewer',
    password: '',
    is_active: user?.is_active ?? 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload: any = { email: form.email, display_name: form.display_name, role: form.role };
      if (!isEdit) payload.password = form.password;
      else if (form.password) payload.password = form.password;
      if (isEdit) payload.is_active = form.is_active;
      if (isEdit) await api.updateUser(user.id, payload);
      else await api.createUser(payload);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">{isEdit ? 'Edit User' : 'New User'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Display Name</label>
            <input className="input-field w-full" value={form.display_name} onChange={set('display_name')} required placeholder="Jane Smith" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input type="email" className="input-field w-full" value={form.email} onChange={set('email')} required placeholder="jane@company.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
            <select className="input-field w-full" value={form.role} onChange={set('role')}>
              {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isEdit ? 'New Password (leave blank to keep)' : 'Password'}
            </label>
            <input
              type="password"
              className="input-field w-full"
              value={form.password}
              onChange={set('password')}
              required={!isEdit}
              placeholder={isEdit ? 'Leave blank to keep current' : 'Min 6 characters'}
              minLength={form.password ? 6 : undefined}
            />
          </div>
          {isEdit && (
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-700">Active</label>
              <button type="button"
                onClick={() => setForm(f => ({ ...f, is_active: f.is_active ? 0 : 1 }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UsersTab() {
  const { user: currentUser, isAtLeast } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalUser, setModalUser] = useState<any | null | false>(false); // false=closed, null=new, obj=edit
  const [pinUser, setPinUser] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await api.deleteUser(id);
      showToast(`User "${name}" deleted`);
      load();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete user', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const canManage = isAtLeast('developer');
  // Managers can set operator floor PINs even though edit/delete stay developer-only.
  const canManagePins = isAtLeast('manager');
  const showActions = canManage || canManagePins;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">Manage who has access and what they can do.</p>
        </div>
        {canManage && (
          <button onClick={() => setModalUser(null)} className="btn-primary flex items-center gap-2">
            <Plus size={15} /> Add User
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading users…</div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
          {/* The table scrolls inside itself: several of these columns do not fit
              a phone, and the rounded card around it clipped them off entirely. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Last Login</th>
                  {showActions && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => (
                  <tr key={u.id} className={`${!u.is_active ? 'opacity-50' : ''} hover:bg-gray-50/50`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg, var(--accent), var(--secondary))' }}>
                          {u.display_name?.[0]?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-gray-800">{u.display_name}</div>
                          {u.id === currentUser?.id && <div className="text-[10px] text-blue-500">You</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                        {u.display_role ?? roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${u.is_active ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                    {showActions && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {canManagePins && u.role === 'operator' && (
                            <button onClick={() => setPinUser(u)}
                              title={u.has_pin ? 'PIN set — manage floor credentials' : 'Set floor PIN / badge'}
                              className={`p-1.5 rounded-lg transition-colors ${u.has_pin ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}>
                              <Key size={13} />
                            </button>
                          )}
                          {canManage && (
                            <button onClick={() => setModalUser(u)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                              <Edit2 size={13} />
                            </button>
                          )}
                          {canManage && u.id !== currentUser?.id && (
                            <button
                              onClick={() => handleDelete(u.id, u.display_name)}
                              disabled={deletingId === u.id}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Role permissions matrix */}
      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Role Permissions</h3>
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white text-xs">
          {/* The table scrolls inside itself: several of these columns do not fit
              a phone, and the rounded card around it clipped them off entirely. */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-500">Permission</th>
                  {ROLE_OPTIONS.map(r => (
                    <th key={r.value} className="px-3 py-2.5 text-center font-semibold text-gray-500">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[
                  { label: 'View dashboards & apps', levels: [1,1,1,1,1] },
                  { label: 'Run production apps', levels: [1,1,1,1,0] },
                  { label: 'Manager view & analytics', levels: [1,1,1,0,0] },
                  { label: 'OEE & step metrics', levels: [1,1,1,0,0] },
                  { label: 'Inventory & quality', levels: [1,1,1,0,0] },
                  { label: 'Purchasing & vendors', levels: [1,1,1,0,0] },
                  { label: 'Create / edit apps', levels: [1,1,0,0,0] },
                  { label: 'Company settings', levels: [1,1,0,0,0] },
                  { label: 'Manage users', levels: [1,0,0,0,0] },
                  { label: 'Delete & admin actions', levels: [1,0,0,0,0] },
                ].map(row => (
                  <tr key={row.label} className="hover:bg-gray-50/50">
                    <td className="px-4 py-2.5 text-gray-700">{row.label}</td>
                    {row.levels.map((allowed, i) => (
                      <td key={i} className="px-3 py-2.5 text-center">
                        {allowed
                          ? <span className="text-emerald-500 font-bold">✓</span>
                          : <span className="text-gray-200">--</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalUser !== false && (
        <UserModal user={modalUser} onClose={() => setModalUser(false)} onSaved={load} />
      )}
      {pinUser && (
        <PinModal
          user={pinUser}
          onClose={() => setPinUser(null)}
          onSaved={(msg) => { showToast(msg); load(); }}
          onError={(msg) => showToast(msg, 'error')}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ─── Operator floor PIN / badge modal ─────────────────────────────────────────

function PinModal({ user, onClose, onSaved, onError }: {
  user: any;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [badge, setBadge] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async (payload: { pin?: string | null; badge_code?: string | null }, successMsg: string) => {
    setError('');
    setSaving(true);
    try {
      await api.setUserPin(user.id, payload);
      onSaved(successMsg);
      onClose();
    } catch (err: any) {
      const msg = err.message || 'Failed to update credentials';
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (pin && !/^\d{4,8}$/.test(pin)) { setError('PIN must be 4–8 digits'); return; }
    const payload: { pin?: string; badge_code?: string } = {};
    if (pin) payload.pin = pin;
    if (badge.trim()) payload.badge_code = badge.trim();
    if (!payload.pin && !payload.badge_code) { setError('Enter a PIN or a badge code'); return; }
    save(payload, `Floor credentials updated for ${user.display_name}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2"><Key size={16} /> Floor PIN &amp; Badge</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-blue-50/60 border border-blue-100 px-3.5 py-2.5 text-xs text-gray-600">
            Set a PIN so <span className="font-semibold text-gray-800">{user.display_name}</span> can clock into the Operator
            Portal on a shared tablet. Work is then attributed to their account.
            {user.has_pin && <span className="block mt-1 text-emerald-700 font-medium">A PIN is currently set.</span>}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">New PIN (4–8 digits)</label>
            <div className="relative">
              <input
                className="input-field w-full pr-10 tracking-[0.3em] font-mono"
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="••••"
              />
              <button type="button" onClick={() => setShowPin(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">
                {showPin ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Badge code (optional)</label>
            <input
              className="input-field w-full"
              value={badge}
              onChange={e => setBadge(e.target.value)}
              placeholder="Scannable badge / card value"
            />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2 pt-1">
            {(user.has_pin || user.has_badge) && (
              <button
                type="button"
                onClick={() => save({ pin: null, badge_code: null }, `Floor credentials cleared for ${user.display_name}`)}
                disabled={saving}
                className="btn-secondary text-sm flex-shrink-0"
              >
                Clear
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 9: Permissions ───────────────────────────────────────────────────────

const ROLE_LEVELS: Record<string, number> = { manager: 4, supervisor: 3, operator: 2, viewer: 1 };
const PERM_ROLES: AppRole[] = ['manager', 'supervisor', 'operator', 'viewer'];

export function PermissionsTab() {
  const [permissions, setPermissions] = useState<RolePermissionMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoading(true);
    api.getPermissions()
      .then(setPermissions)
      .catch(() => setPermissions(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleToggle = async (role: AppRole, item: typeof ALL_SECTION_ITEMS[number]) => {
    if (!permissions) return;
    const defaultVisible = !item.minRole || (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[item.minRole] ?? 99);
    const effective = permissions[role]?.[item.to] !== undefined ? !!permissions[role][item.to] : defaultVisible;
    const next = !effective;
    const visible = next === defaultVisible ? null : next;
    const key = `${role}:${item.to}`;
    setBusyKey(key);
    try {
      const updated = await api.updatePermissions([{ role, nav_key: item.to, visible }]);
      setPermissions(updated);
    } catch (err: any) {
      showToast(err.message || 'Failed to update permission', 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all role permission overrides to their defaults?')) return;
    try {
      const updated = await api.resetPermissions();
      setPermissions(updated);
      showToast('Permissions reset to defaults');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset permissions', 'error');
    }
  };

  if (loading || !permissions) {
    return <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading permissions…</div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start gap-2.5 text-xs bg-blue-50 text-blue-800 rounded-xl px-3.5 py-2.5 border border-blue-100">
        <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
        <span>
          Toggle which navigation items each role can see, beyond the built-in defaults.
          A grey/default cell means the item follows its normal role requirement.
        </span>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
        {/* The table scrolls inside itself: several of these columns do not fit
            a phone, and the rounded card around it clipped them off entirely. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Navigation Item</th>
                {PERM_ROLES.map(role => (
                  <th key={role} className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 capitalize">{role}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {ALL_SECTION_ITEMS.map(item => (
                <tr key={item.to} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-gray-700 flex items-center gap-2">
                    <item.icon size={14} className="text-gray-400" />
                    {item.label}
                  </td>
                  {PERM_ROLES.map(role => {
                    const defaultVisible = !item.minRole || (ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[item.minRole] ?? 99);
                    const override = permissions[role]?.[item.to];
                    const effective = override !== undefined ? !!override : defaultVisible;
                    const isOverridden = override !== undefined;
                    const key = `${role}:${item.to}`;
                    return (
                      <td key={role} className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={isOverridden ? '' : 'opacity-50'}>
                            <Toggle
                              checked={effective}
                              onChange={() => busyKey ? undefined : handleToggle(role, item)}
                            />
                          </span>
                          {busyKey === key && (
                            <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin inline-block" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
        <p className="text-xs text-gray-500">
          Changes apply immediately to the relevant role's sidebar.
        </p>
        <button onClick={handleReset} className="btn-secondary text-sm whitespace-nowrap flex items-center gap-1.5">
          <RotateCcw size={13} /> Reset All to Defaults
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
