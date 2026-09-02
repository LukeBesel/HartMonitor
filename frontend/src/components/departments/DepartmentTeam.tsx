// ─── Department team — who gets this department's alerts ─────────────────────
// The routing layer made visible: put a person on a department with a role, and
// calls aimed at that role reach them by email, in the app, or both.
// A person can sit on several departments with a different role in each.

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Trash2, Loader2, Mail, Bell, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { teamConfig } from '../../config/andonTeams';
import type { AndonTeam, DepartmentMember, DepartmentTeamRole } from '../../types';

interface TeamUser { id: string; display_name: string; email?: string; role?: string; is_active?: boolean }

// The order they appear in the picker: on-call function roles first, then the
// two that describe how someone belongs rather than what they answer for.
const TEAM_ROLE_ORDER: DepartmentTeamRole[] = ['quality', 'supervisor', 'maintenance', 'materials', 'lead', 'operator'];

const ROLE_LABELS: Record<DepartmentTeamRole, string> = {
  quality: 'Quality',
  supervisor: 'Supervisor',
  maintenance: 'Maintenance',
  materials: 'Materials',
  lead: 'Department lead',
  operator: 'Operator',
};

const NEUTRAL_CHIP = 'bg-gray-100 text-gray-700 border-gray-200';

function roleChip(role: DepartmentTeamRole): string {
  // The four function roles borrow the alert-team colors so the board and this
  // list read as the same vocabulary; lead/operator stay neutral.
  return role === 'lead' || role === 'operator' ? NEUTRAL_CHIP : teamConfig(role as AndonTeam).chip;
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role as DepartmentTeamRole] ?? role;
}

export default function DepartmentTeam({ departmentId, departmentName }: {
  departmentId: string;
  departmentName: string;
}) {
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<DepartmentTeamRole>('operator');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, people] = await Promise.all([
        api.getDepartmentMembers(departmentId),
        api.getUsers(),
      ]);
      setMembers(rows);
      setUsers(people as TeamUser[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the team.');
    } finally {
      setLoading(false);
    }
  }, [departmentId]);

  useEffect(() => { void load(); }, [load]);

  const addMember = async () => {
    if (!newUserId || adding) return;
    setAdding(true);
    setError('');
    try {
      await api.addDepartmentMember(departmentId, { user_id: newUserId, team_role: newRole });
      setNewUserId('');
      setNewRole('operator');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add them to this department.');
    } finally {
      setAdding(false);
    }
  };

  const updateMember = async (member: DepartmentMember, patch: Partial<DepartmentMember>) => {
    setBusyId(member.id);
    setError('');
    try {
      const updated = await api.updateDepartmentMember(member.id, {
        team_role: patch.team_role ?? member.team_role,
        notify_email: patch.notify_email ?? member.notify_email,
        notify_in_app: patch.notify_in_app ?? member.notify_in_app,
      });
      setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that change.');
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (member: DepartmentMember) => {
    if (!window.confirm(`Remove ${member.display_name} from ${departmentName}? They will stop receiving its alerts.`)) return;
    setBusyId(member.id);
    setError('');
    try {
      await api.removeDepartmentMember(member.id);
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove them.');
    } finally {
      setBusyId(null);
    }
  };

  const available = users.filter(u => u.is_active !== false && !members.some(m => m.user_id === u.id));

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Users size={16} className="text-indigo-500" />
        <h2 className="font-semibold text-gray-900">Team</h2>
        {members.length > 0 && (
          <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            {members.length}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        People here receive {departmentName}'s calls. A call for a role — Quality, Maintenance,
        Materials, Supervisor — goes to whoever holds that role here first.
      </p>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0" /> {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />)}
        </div>
      ) : members.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl mb-4">
          <Users size={26} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-600">Nobody is on this department yet</p>
          <p className="text-xs text-gray-400 mt-0.5 max-w-sm mx-auto">
            Until someone is, requests for {departmentName} fall back to anyone with that role
            company-wide, then to the company alert email.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-gray-50 mb-4">
          {members.map(member => {
            const busy = busyId === member.id;
            return (
              <div key={member.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 truncate">{member.display_name}</span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${roleChip(member.team_role)}`}>
                      {roleLabel(member.team_role)}
                    </span>
                    {!member.is_active && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 truncate">{member.email}</div>
                </div>

                <select
                  value={member.team_role}
                  disabled={busy}
                  onChange={e => void updateMember(member, { team_role: e.target.value as DepartmentTeamRole })}
                  className="input-field text-xs py-1.5 w-auto"
                  aria-label={`Role for ${member.display_name}`}
                >
                  {TEAM_ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>

                {/* Delivery preferences, honoured independently at send time. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void updateMember(member, { notify_email: !member.notify_email })}
                  aria-pressed={member.notify_email}
                  title={member.notify_email ? 'Email alerts on' : 'Email alerts off'}
                  className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                    member.notify_email ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-400'
                  }`}
                >
                  <Mail size={12} /> Email
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void updateMember(member, { notify_in_app: !member.notify_in_app })}
                  aria-pressed={member.notify_in_app}
                  title={member.notify_in_app ? 'In-app alerts on' : 'In-app alerts off'}
                  className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                    member.notify_in_app ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-400'
                  }`}
                >
                  <Bell size={12} /> In-app
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeMember(member)}
                  title={`Remove ${member.display_name}`}
                  className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add a teammate */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
        <select
          value={newUserId}
          onChange={e => setNewUserId(e.target.value)}
          className="input-field text-sm flex-1 min-w-[180px]"
          aria-label="Teammate to add"
        >
          <option value="">— Add a teammate —</option>
          {available.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as DepartmentTeamRole)}
          className="input-field text-sm w-auto"
          aria-label="Their role on this department"
        >
          {TEAM_ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void addMember()}
          disabled={!newUserId || adding}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
      </div>
      {available.length === 0 && !loading && (
        <p className="text-xs text-gray-400 mt-2">
          Everyone on your team is already on this department.
        </p>
      )}
    </div>
  );
}
