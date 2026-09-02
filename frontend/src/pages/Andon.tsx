// ─── Andon Board ──────────────────────────────────────────────────────────────
// The responder's side of the ONE call-for-help mechanism. Every call — raised
// from the operator player, from the app shell or from this page — lands here
// tagged with WHO IS NEEDED (a function team or one of the company's
// departments), the place it came from and the run context behind it.
// Responders acknowledge ("On my way", which records who and when) and then
// resolve. The board updates live over the shared WebSocket.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Siren, HelpCircle, ShieldAlert, Package, Wrench, AlertTriangle,
  CheckCircle, X, ChevronDown, ChevronUp, Plus, Loader2, Timer, MapPin, Hash, Building2,
  ArrowUpCircle, SlidersHorizontal, Clock, Ban,
} from 'lucide-react';
import { api } from '../api/client';
import { fmtDuration } from '../components/apps/appModel';
import {
  getAndonTargets, updateAndonTarget, secondsToTarget, secondsSinceEscalation, parseUtc,
} from '../api/andon';
import type { AndonCallLive, AndonSummaryLive, AndonTarget, AndonTargetUpdate } from '../api/andon';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useDepartmentFilter } from '../hooks/useDepartmentFilter';
import type { DepartmentOption } from '../hooks/useDepartmentFilter';
import LastRefreshed from '../components/shared/LastRefreshed';
import DepartmentFilter from '../components/shared/DepartmentFilter';
import { ANDON_TEAMS, ANDON_TEAM_ORDER, teamConfig, formatAge, targetLabel, targetPayload } from '../config/andonTeams';
import { displayId, hasCompanyTag } from '../utils/ids';
import type { AlertTarget } from '../config/andonTeams';
import { subscribeRealtime, isAndonEvent } from '../utils/realtime';
import type { AndonCallType, AndonPriority, AndonStatus, AndonTeam, Station } from '../types';

// ── Config maps ───────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<
  AndonCallType,
  { label: string; icon: React.ElementType; borderColor: string; bgColor: string; iconColor: string }
> = {
  help:        { label: 'Help',        icon: HelpCircle,    borderColor: 'border-l-blue-500',   bgColor: 'bg-blue-600 hover:bg-blue-700',     iconColor: 'text-blue-400' },
  quality:     { label: 'Quality',     icon: ShieldAlert,   borderColor: 'border-l-purple-500', bgColor: 'bg-purple-600 hover:bg-purple-700', iconColor: 'text-purple-400' },
  material:    { label: 'Material',    icon: Package,       borderColor: 'border-l-amber-500',  bgColor: 'bg-amber-600 hover:bg-amber-700',   iconColor: 'text-amber-400' },
  maintenance: { label: 'Maintenance', icon: Wrench,        borderColor: 'border-l-orange-500', bgColor: 'bg-orange-600 hover:bg-orange-700', iconColor: 'text-orange-400' },
  safety:      { label: 'Safety',      icon: AlertTriangle, borderColor: 'border-l-red-500',    bgColor: 'bg-red-600 hover:bg-red-700',       iconColor: 'text-red-400' },
};

const TYPE_FALLBACK = TYPE_CONFIG.help;
const typeConfig = (t: string) => TYPE_CONFIG[t as AndonCallType] ?? TYPE_FALLBACK;

const PRIORITY_BADGE: Record<AndonPriority, string> = {
  low:      'bg-gray-700 text-gray-300',
  normal:   'bg-gray-700 text-gray-300',
  high:     'bg-amber-900/50 text-amber-300 border border-amber-700',
  critical: 'bg-red-900/50 text-red-300 border border-red-700 animate-pulse',
};

const STATUS_BADGE: Record<AndonStatus, string> = {
  open:         'bg-red-900/50 text-red-300',
  acknowledged: 'bg-amber-900/50 text-amber-300',
  resolved:     'bg-green-900/50 text-green-300',
};

// Dark-board team chip (this page runs on gray-950, not the workbench canvas).
const TEAM_CHIP: Record<AndonTeam, string> = {
  quality:     'bg-purple-500/15 text-purple-300 border-purple-500/40',
  supervisor:  'bg-blue-500/15 text-blue-300 border-blue-500/40',
  maintenance: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  materials:   'bg-amber-500/15 text-amber-300 border-amber-500/40',
};
const TEAM_CHIP_FALLBACK = 'bg-gray-700/40 text-gray-300 border-gray-600';

// Selected-tile fill in the call-for-help modal.
const TEAM_BUTTON: Record<AndonTeam, string> = {
  quality:     'bg-purple-600 hover:bg-purple-700',
  supervisor:  'bg-blue-600 hover:bg-blue-700',
  maintenance: 'bg-orange-600 hover:bg-orange-700',
  materials:   'bg-amber-600 hover:bg-amber-700',
};

// Who was alerted. A department alert wears a neutral chip with a building
// icon; a function team wears its own color.
function TeamChip({ team, label, isDepartment }: { team: string; label?: string; isDepartment?: boolean }) {
  const cfg = teamConfig(team);
  const Icon = isDepartment ? Building2 : cfg.icon;
  const style = isDepartment ? 'bg-slate-500/15 text-slate-200 border-slate-400/40' : (TEAM_CHIP[team as AndonTeam] ?? TEAM_CHIP_FALLBACK);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
      <Icon size={12} />
      {label ?? cfg.label}
    </span>
  );
}

// ── The response clock ────────────────────────────────────────────────────────
// A call's age on its own says nothing: 46 minutes is a disaster for a safety
// call and unremarkable for a materials one. Every card therefore prints the
// TARGET it is being measured against and counts down to it, and says plainly
// when it has been missed rather than letting a growing number imply it.

/** The wall-clock time a target runs out, in the viewer's own zone. */
function clockAt(iso: string | null | undefined): string {
  const ms = parseUtc(iso);
  return ms === null ? '' : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ResponseClock({ call, now }: { call: AndonCallLive; now: number }) {
  const left = secondsToTarget(call, now);
  if (left === null) {
    // No target rather than a fabricated countdown — a call raised before this
    // company had targets, or a team nobody has set one for.
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Clock size={11} className="shrink-0" />
        {call.target_reason || 'No response target set'}
      </span>
    );
  }
  const late = left < 0;
  return (
    <span
      data-testid="respond-by"
      className={`inline-flex items-center gap-1.5 text-xs font-medium tnum ${late ? 'text-red-300' : 'text-gray-300'}`}
    >
      <Clock size={11} className="shrink-0" />
      Respond by {clockAt(call.respond_by)} · {late ? `${fmtDuration(-left)} over` : `${fmtDuration(left)} left`}
    </span>
  );
}

/**
 * A note somebody wrote about a call, with any id in it read the way the floor
 * reads it.
 *
 * The escalation and resolution notes are sentences with an id in the middle —
 * "Escalated to maintenance — 6BDD57-MWO-100 opened; station stays down". The
 * shared helper trims a company tag off an id that IS the whole string, so the
 * sentence is split into words and each word handed to that ONE helper. No
 * second rule about what a tag looks like lives here; a word that is not a
 * tagged id of a family this product issues comes back exactly as it was
 * written, which is what has to happen to the rest of the sentence.
 */
function noteText(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).split(/(\s+)/).map(part => displayId(part)).join('');
}

/** "1 call" / "3 calls" — this board counts calls in a dozen places and a
 *  bare "1 calls" is the kind of thing a plant manager stops trusting. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Red, because an escalated call is one nobody answered — not a status change
 *  to be read past. Names WHO it went to and HOW LONG AGO, so the board answers
 *  "has anyone been told?" without anyone opening the call. */
function EscalationBadge({ call, now }: { call: AndonCallLive; now: number }) {
  const level = call.escalation_level ?? 0;
  if (!level) return null;
  const ago = secondsSinceEscalation(call, now);
  return (
    <span
      data-testid="escalation-badge"
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border bg-red-500/20 text-red-300 border-red-500/50"
    >
      <ArrowUpCircle size={12} className="shrink-0" />
      Escalated to {call.escalated_to_label || 'the next tier'}
      {ago === null ? '' : ` ${formatAge(ago)} ago`}
      {level > 1 ? ' · twice' : ''}
    </span>
  );
}

// ── Response targets panel ────────────────────────────────────────────────────
// The clock every card counts down, in one editable place: how long a team has
// to answer, and how long the next tier gets before the call climbs again.
// Collapsed by default and loaded only when opened — a responder watching the
// board does not need the plant's policy on screen, and a manager setting it
// does not want to hunt through Settings for it.

const PRIORITY_ORDER: Array<'critical' | 'high' | 'normal'> = ['critical', 'high', 'normal'];

/** The rungs a target may be pointed at: the four routing teams, then
 *  management at the top. Mirrors ESCALATE_TO_OPTIONS on the server, which is
 *  what actually validates the choice — the picker must never offer something
 *  the API would refuse. */
const ESCALATE_TO_CHOICES: { id: string; label: string }[] = [
  ...ANDON_TEAM_ORDER.map(team => ({ id: team as string, label: ANDON_TEAMS[team].label })),
  { id: 'manager', label: 'Management' },
];

const targetKey = (row: AndonTarget) => `${row.team}|${row.priority}`;

function TargetsPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AndonTarget[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  // What the server holds is the only thing these inputs ever show. A draft
  // exists only while somebody is typing in one; a refused edit drops its draft,
  // so the field snaps back to the stored value instead of leaving a number on
  // screen that was never saved.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || rows || loading) return;
    setLoading(true);
    getAndonTargets()
      .then(setRows)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load the response targets.'))
      .finally(() => setLoading(false));
  }, [open, rows, loading]);

  async function save(row: AndonTarget, patch: Partial<AndonTargetUpdate>, draftKeys: string[] = []) {
    const key = targetKey(row);
    setSavingKey(key);
    setError('');
    setRowErrors(prev => ({ ...prev, [key]: '' }));
    try {
      const saved = await updateAndonTarget({ team: row.team, priority: row.priority, ...patch });
      setRows(prev => (prev || []).map(r => (r.id === row.id ? { ...r, ...saved } : r)));
    } catch (err) {
      // The server refused it. Say which row and why, and let the input fall
      // back to the value that is actually stored.
      setRowErrors(prev => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'Only a manager can change response targets.',
      }));
    } finally {
      // Either way the draft goes: on success the server's value is newer, on
      // failure it is the only true one.
      setDrafts(prev => {
        const next = { ...prev };
        for (const k of draftKeys) delete next[k];
        return next;
      });
      setSavingKey(null);
    }
  }

  const ordered = (rows || []).slice().sort((a, b) =>
    a.team_label.localeCompare(b.team_label) ||
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));

  const numberCell = (row: AndonTarget, field: 'respond_minutes' | 'escalate_minutes') => {
    const key = targetKey(row);
    const draftKey = `${key}|${field}`;
    const stored = String(row[field]);
    const value = drafts[draftKey] ?? stored;
    return (
      <input
        type="number"
        min={1}
        value={value}
        disabled={savingKey === key}
        aria-label={`${field === 'respond_minutes' ? 'Respond' : 'Escalate'} minutes for ${row.team_label} ${row.priority}`}
        onChange={e => setDrafts(prev => ({ ...prev, [draftKey]: e.target.value }))}
        onBlur={() => {
          if (value === stored) {
            setDrafts(prev => { const next = { ...prev }; delete next[draftKey]; return next; });
            return;
          }
          void save(row, { [field]: Number(value) } as Partial<AndonTargetUpdate>, [draftKey]);
        }}
        className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white tnum disabled:opacity-50"
      />
    );
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <SlidersHorizontal size={15} className="text-gray-400" />
          Response targets
          <span className="text-xs font-normal text-gray-500">
            how long each team has before a call escalates
          </span>
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400 shrink-0" /> : <ChevronDown size={16} className="text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-gray-800 p-4 space-y-3">
          {error && (
            <p className="text-sm text-red-300 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}
          {loading && !rows ? (
            <p className="text-sm text-gray-500">Loading targets…</p>
          ) : ordered.length === 0 ? (
            <p className="text-sm text-gray-500">No response targets yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4 font-semibold">Team</th>
                    <th className="py-2 pr-4 font-semibold">Priority</th>
                    <th className="py-2 pr-4 font-semibold">Respond (min)</th>
                    <th className="py-2 pr-4 font-semibold">Escalate after (min)</th>
                    <th className="py-2 font-semibold">Escalates to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {ordered.map(row => {
                    const key = targetKey(row);
                    return (
                      <tr key={row.id}>
                        <td className="py-2 pr-4 text-gray-200">{row.team_label}</td>
                        <td className="py-2 pr-4 capitalize text-gray-400">{row.priority}</td>
                        <td className="py-2 pr-4">{numberCell(row, 'respond_minutes')}</td>
                        <td className="py-2 pr-4">
                          {numberCell(row, 'escalate_minutes')}
                          {rowErrors[key] && (
                            <span className="block max-w-[22rem] whitespace-normal text-xs text-red-300 mt-1">
                              {rowErrors[key]}
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          <select
                            value={row.escalate_to_team || 'supervisor'}
                            disabled={savingKey === key}
                            aria-label={`Escalates to, for ${row.team_label} ${row.priority}`}
                            onChange={e => void save(row, { escalate_to_team: e.target.value })}
                            className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white disabled:opacity-50"
                          >
                            {ESCALATE_TO_CHOICES.map(choice => (
                              <option key={choice.id} value={choice.id}>{choice.label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-500">
                A call nobody acknowledges within its respond time is escalated to the team named here, then once more to
                management — twice at most, and never to somebody who was already alerted. Respond has to be shorter than
                escalate. Managers can edit these; everyone else sees them.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Call-for-help modal ───────────────────────────────────────────────────────
// The same targets the player offers: four function teams plus the company's
// own departments. Raised from this page there is no run context to attach.

interface CallForHelpModalProps {
  departments: DepartmentOption[];
  onClose: () => void;
  onCreated: () => void;
}

function CallForHelpModal({ departments, onClose, onCreated }: CallForHelpModalProps) {
  const [target, setTarget] = useState<AlertTarget | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high' | 'critical'>('normal');
  const [stationId, setStationId] = useState('');
  const [stations, setStations] = useState<Station[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getStations().then(rows => setStations(rows.filter(s => s.status === 'active'))).catch(() => setStations([]));
  }, []);

  const isTarget = (t: AlertTarget) => {
    if (!target) return false;
    if (target.kind === 'team' && t.kind === 'team') return target.team === t.team;
    if (target.kind === 'department' && t.kind === 'department') return target.id === t.id;
    return false;
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) { setError('Pick who you need.'); return; }
    setError('');
    setSubmitting(true);
    try {
      const station = stations.find(s => s.id === stationId);
      await api.createAndonCall({
        ...targetPayload(target),
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        priority,
        station_id: stationId || undefined,
        ...(target.kind === 'team' ? { department_id: station?.department_id || undefined } : {}),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send the call.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-900/40 rounded-lg">
              <Siren size={20} className="text-red-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Call for help</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Target selector — the same four teams the player offers */}
          <div>
            <label className="section-label mb-3 block">Who do you need? *</label>
            <div className="grid grid-cols-2 gap-2">
              {ANDON_TEAM_ORDER.map(team => {
                const cfg = ANDON_TEAMS[team];
                const Icon = cfg.icon;
                const isSelected = isTarget({ kind: 'team', team });
                return (
                  <button
                    key={team}
                    type="button"
                    onClick={() => setTarget({ kind: 'team', team })}
                    className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${TEAM_BUTTON[team]} border-transparent text-white`
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{cfg.tileLabel}</span>
                      <span className="block text-[11px] opacity-80 truncate">{cfg.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Or one of the company's own departments */}
          {departments.length > 0 && (
            <div>
              <label className="section-label mb-2 flex items-center gap-1.5">
                <Building2 size={12} /> Or a department
              </label>
              <div className="flex flex-wrap gap-1.5">
                {departments.map(d => {
                  const isSelected = isTarget({ kind: 'department', id: d.id, name: d.name });
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setTarget({ kind: 'department', id: d.id, name: d.name })}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        isSelected
                          ? 'bg-white border-white text-gray-900'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {stations.length > 0 && (
            <div>
              <label className="section-label mb-1 block">Where (optional)</label>
              <div className="relative">
                <select
                  className="input-field w-full appearance-none pr-8"
                  value={stationId}
                  onChange={e => setStationId(e.target.value)}
                >
                  <option value="">— No specific station —</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          <div>
            <label className="section-label mb-1 block">Title (optional)</label>
            <input
              type="text"
              className="input-field w-full"
              placeholder={target ? `${targetLabel(target)} needed` : 'Brief description of the issue'}
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="section-label mb-1 block">Message (optional)</label>
            <textarea
              className="input-field w-full resize-none"
              rows={3}
              placeholder="Additional details..."
              value={message}
              onChange={e => setMessage(e.target.value)}
            />
          </div>

          <div>
            <label className="section-label mb-2 block">Priority</label>
            <div className="flex gap-2">
              {(['normal', 'high', 'critical'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium capitalize transition-colors border ${
                    priority === p
                      ? p === 'critical'
                        ? 'bg-red-700 border-red-600 text-white'
                        : p === 'high'
                        ? 'bg-amber-700 border-amber-600 text-white'
                        : 'bg-blue-700 border-blue-600 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Close
            </button>
            <button
              type="submit"
              disabled={submitting || !target}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Siren size={16} />}
              {submitting ? 'Notifying…' : target ? `Notify ${targetLabel(target)}` : 'Pick who you need'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4 animate-pulse">
          <div className="flex items-start justify-between mb-3">
            <div className="h-5 bg-gray-800 rounded w-2/3" />
            <div className="h-5 bg-gray-800 rounded w-16" />
          </div>
          <div className="h-4 bg-gray-800 rounded w-1/3 mb-4" />
          <div className="h-4 bg-gray-800 rounded w-full mb-2" />
          <div className="h-4 bg-gray-800 rounded w-3/4 mb-4" />
          <div className="flex gap-2">
            <div className="h-8 bg-gray-800 rounded-lg w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Andon() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [calls, setCalls] = useState<AndonCallLive[]>([]);
  const [summary, setSummary] = useState<AndonSummaryLive | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Deep-linkable so a Command Center attention row can hand off "?team=quality"
  // straight into the right queue.
  const teamFilter = (searchParams.get('team') ?? 'all') as AndonTeam | 'all';
  const setTeamFilter = useCallback((team: AndonTeam | 'all') => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (team === 'all') next.delete('team');
      else next.set('team', team);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Department scope lives in the shared picker (same control, same memory as
  // every other management screen) rather than in the URL. A "?department_id=…"
  // handoff still works: it is adopted into the picker once, then dropped from
  // the URL so the two can never disagree.
  const deptFilter = useDepartmentFilter('andon');
  const departmentFilter = deptFilter.departmentId;
  const { setDepartmentId, departments } = deptFilter;
  const urlDepartmentId = searchParams.get('department_id') ?? '';
  useEffect(() => {
    if (!urlDepartmentId) return;
    setDepartmentId(urlDepartmentId);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('department_id');
      return next;
    }, { replace: true });
  }, [urlDepartmentId, setDepartmentId, setSearchParams]);

  const [showCreate, setShowCreate] = useState(false);

  // Per-card action loading: key = call id, value = true while in-flight
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Inline resolve: which card is expanded + text
  const [resolveCardId, setResolveCardId] = useState<string | null>(null);
  const [resolutionText, setResolutionText] = useState('');

  // One instant for the whole board, ticked every second, so every countdown on
  // screen agrees with every other one and none of them drifts from the target
  // between the twenty-second reloads.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setError('');
    try {
      const params: { status?: string; team?: AndonTeam; department_id?: string } = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (teamFilter !== 'all') params.team = teamFilter;
      // GET /andon honours department_id (backend/src/routes/andon.js), so the
      // board narrows server-side and the 100-row cap is spent on this
      // department instead of the whole plant.
      if (departmentFilter) params.department_id = departmentFilter;

      // The summary takes the same department scope, so the four KPI cards and
      // the team badges describe the same slice of the plant as the cards below
      // them. They used to count the whole company whatever was selected.
      const [callsData, summaryData] = await Promise.all([
        api.getAndonCalls(params),
        api.getAndonSummary(departmentFilter ? { department_id: departmentFilter } : undefined),
      ]);
      setCalls(callsData as AndonCallLive[]);
      setSummary(summaryData as AndonSummaryLive);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Andon data.');
      // Rethrow so the freshness stamp does not claim data it never got.
      throw err;
    } finally {
      setLoading(false);
    }
  }, [statusFilter, teamFilter, departmentFilter]);

  // Live board: loads on mount, whenever a filter moves, and every 20s while
  // the tab is visible. The skeleton only shows for the very first load — after
  // that the freshness stamp carries the "we're reloading" signal.
  const auto = useAutoRefresh(load, 20_000);
  const refreshBoard = auto.refresh;

  // Live: a call raised on any tablet lands here immediately (the 20s poll is
  // the backstop for a dropped socket, not the primary path).
  useEffect(() => subscribeRealtime(evt => {
    if (isAndonEvent(evt)) void refreshBoard();
  }), [refreshBoard]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleAcknowledge(id: string) {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.acknowledgeAndonCall(id);
      await auto.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not acknowledge the call.');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  // The requester no longer needs help. Kept as a stand-down rather than a
  // delete, so the board keeps an honest record of who was called and why the
  // call went away.
  async function handleCancel(id: string) {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.cancelAndonCall(id);
      await auto.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the call.');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  async function handleResolve(id: string) {
    setActionLoading(prev => ({ ...prev, [id]: true }));
    try {
      await api.resolveAndonCall(id, resolutionText.trim() || undefined);
      setResolveCardId(null);
      setResolutionText('');
      await auto.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve the call.');
    } finally {
      setActionLoading(prev => ({ ...prev, [id]: false }));
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  const statusFilters = ['all', 'open', 'acknowledged', 'resolved'];

  const avgResponse = summary?.avg_response_seconds_today ?? null;
  // `?? null` and never `|| 0`: a real 0% (everything late today) has to survive
  // as 0, and a missing measurement has to survive as null.
  const withinTarget = summary?.within_target_pct ?? null;

  const teamCounts = useMemo(() => summary?.by_team ?? {}, [summary]);

  // What the board is currently narrowed to, for the empty state: "Nothing open
  // for Assembly · Quality" beats "No open calls" when the manager has
  // in fact only asked about one corner of the plant.
  const scopeLabel = useMemo(() => [
    deptFilter.selected?.name,
    teamFilter === 'all' ? null : (ANDON_TEAMS[teamFilter]?.label ?? teamFilter),
  ].filter(Boolean).join(' · '), [deptFilter.selected, teamFilter]);

  // Empty-state copy has to reflect the STATUS filter too, not just the scope.
  // The default "all statuses" board is the attention queue, so an empty one is
  // genuinely "All clear". But a status filter narrows the board to one slice —
  // an empty "Resolved" view is not "All clear", it simply has nothing resolved.
  const emptyState = useMemo(() => {
    if (statusFilter === 'all') {
      return {
        heading: 'All clear',
        subtext: scopeLabel ? `Nothing open for ${scopeLabel}` : 'No open calls',
      };
    }
    return {
      heading: `No ${statusFilter} calls`,
      subtext: scopeLabel ? `Nothing ${statusFilter} for ${scopeLabel}` : `Nothing ${statusFilter} right now`,
    };
  }, [statusFilter, scopeLabel]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-900/40 border border-red-800/60 rounded-xl">
              <Siren size={24} className="text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Andon Board</h1>
              <p className="text-sm text-gray-400">Every call from the floor — who is needed, where, and how long they have waited</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <DepartmentFilter
              filter={deptFilter}
              matchCount={calls.length}
              matchNoun={calls.length === 1 ? 'call' : 'calls'}
              onDark
            />
            <LastRefreshed
              at={auto.lastRefreshed}
              refreshing={auto.refreshing}
              onRefresh={() => { void auto.refresh(); }}
              onDark
            />
            <button
              onClick={() => setShowCreate(true)}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-xl flex items-center gap-2 transition-colors w-full sm:w-auto justify-center"
            >
              <Plus size={18} />
              Call for help
            </button>
          </div>
        </div>

        {/* ── Error State ── */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
            <button onClick={() => { void auto.refresh(); }} className="btn-secondary text-sm shrink-0">
              Retry
            </button>
          </div>
        )}

        {/* ── Stats Strip ── */}
        {/* These four come from GET /andon/summary, which now takes the same
            department_id as the board below, so they describe whatever scope is
            selected — one department, or the whole plant. */}
        {summary && (
          <div className="space-y-2">
            {deptFilter.active && (
              <p className="flex items-center gap-1.5 text-xs text-gray-500">
                <Building2 size={12} className="shrink-0" />
                Scoped to {deptFilter.selected?.name} — these four numbers and the team badges below count only this department's calls.
              </p>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${summary.open > 0 ? 'border-red-800/60' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="section-label">Open calls</span>
                  {summary.open > 0 && (
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  )}
                </div>
                <p data-testid="stat-open" className={`text-3xl font-bold ${summary.open > 0 ? 'text-red-400' : 'text-white'}`}>
                  {summary.open}
                </p>
                {/* How many of those have already missed their target — the
                    number a supervisor actually has to act on. */}
                {/* Escalating pushes the respond-by forward, so an escalated
                    call is briefly NOT past target — and the old condition hid
                    the escalation count exactly when it mattered most. Each
                    number stands on its own. */}
                {((summary.overdue ?? 0) > 0 || (summary.escalated_open ?? 0) > 0) && (
                  <p data-testid="stat-overdue" className="text-xs text-red-400 mt-1">
                    {[
                      (summary.overdue ?? 0) > 0 ? `${summary.overdue} past target` : '',
                      (summary.escalated_open ?? 0) > 0 ? `${summary.escalated_open} escalated` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="section-label mb-1">Acknowledged</p>
                <p data-testid="stat-acknowledged" className="text-3xl font-bold text-amber-400">{summary.acknowledged}</p>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="section-label mb-1">Resolved Today</p>
                <p data-testid="stat-resolved-today" className="text-3xl font-bold text-green-400">{summary.resolved_today}</p>
              </div>

              {/* Time-to-respond: measured, never estimated — blank until a call
                  has actually been acknowledged today. */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="section-label mb-1">Avg. response today</p>
                {avgResponse === null ? (
                  <p data-testid="stat-avg-response" className="text-lg font-semibold text-gray-500 mt-1.5">Nothing answered yet</p>
                ) : (
                  <p data-testid="stat-avg-response" className="text-3xl font-bold text-white flex items-baseline gap-2">
                    {formatAge(avgResponse)}
                    <span className="text-xs font-medium text-gray-500">
                      over {plural(summary.responded_today, 'call')}
                    </span>
                  </p>
                )}
              </div>

              {/* Against target — the number an average cannot give you. Null,
                  never 0%: "0% within target" says every call today was late,
                  which is a very different plant from one where nothing has been
                  answered yet. When there is nothing to measure this prints an
                  em dash and the reason. */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="section-label mb-1">Within target today</p>
                {withinTarget === null ? (
                  <p data-testid="stat-within-target" className="text-3xl font-bold text-gray-500">
                    —
                    <span className="block text-xs font-medium text-gray-500 mt-1">
                      {summary.within_target_reason || 'nothing has been acknowledged today'}
                    </span>
                  </p>
                ) : (
                  <p data-testid="stat-within-target" className="text-3xl font-bold text-white">
                    {withinTarget}%
                    <span className="block text-xs font-medium text-gray-500 mt-1">
                      {summary.within_target_sample} answered
                      {summary.target_seconds ? ` · target ${fmtDuration(summary.target_seconds)}` : ''}
                    </span>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Response targets ── */}
        <TargetsPanel />

        {/* ── Filter Chips ── */}
        <div className="space-y-3">
          {/* Team filter — the routing dimension: who was alerted. Composes
              with the department picker: both are sent to the server as AND. */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="section-label mr-1">Team:</span>
            <button
              onClick={() => setTeamFilter('all')}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                teamFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              All teams
            </button>
            {ANDON_TEAM_ORDER.map(team => {
              const cfg = ANDON_TEAMS[team];
              const Icon = cfg.icon;
              const openForTeam = teamCounts[team] ?? 0;
              return (
                <button
                  key={team}
                  onClick={() => setTeamFilter(team)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${
                    teamFilter === team ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <Icon size={13} />
                  {cfg.label}
                  {/* Unresolved count for this team, from the summary endpoint —
                      which carries the same department scope as the board, so
                      the badge never overstates the queue a manager is looking
                      at. The caption above the KPI cards names the scope. */}
                  {openForTeam > 0 && (
                    <span data-testid={`team-count-${team}`} className="ml-0.5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{openForTeam}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Status filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="section-label mr-1">Status:</span>
            {statusFilters.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {s === 'all' ? 'All' : s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Call Cards ── */}
        {loading ? (
          <SkeletonCards />
        ) : calls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="p-5 bg-green-900/30 border border-green-800/50 rounded-full">
              <CheckCircle size={40} className="text-green-400" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-white mb-1">{emptyState.heading}</h3>
              <p className="text-gray-400">
                {emptyState.subtext}
              </p>
              {deptFilter.active && (
                <button onClick={deptFilter.clear} className="btn-secondary mt-4 text-sm">
                  <X size={14} /> Show all departments
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {calls.map(call => {
              const cfg = typeConfig(call.type);
              const Icon = cfg.icon;
              const isActioning = !!actionLoading[call.id];
              const isResolvingThis = resolveCardId === call.id;

              return (
                <div
                  key={call.id}
                  className={`bg-gray-900 border border-gray-800 rounded-xl p-4 border-l-4 ${cfg.borderColor} flex flex-col gap-3`}
                >
                  {/* Card Header — team chip leads: who is needed */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon size={16} className={`${cfg.iconColor} shrink-0`} />
                      <span className="font-semibold text-white truncate">{call.title}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {call.priority === 'critical' && (
                        <span className="animate-pulse bg-red-500 rounded-full w-2 h-2 shrink-0" />
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_BADGE[call.priority] ?? PRIORITY_BADGE.normal}`}>
                        {call.priority}
                      </span>
                    </div>
                  </div>

                  {/* Team + status + age */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-gray-400">
                    <TeamChip team={call.team} label={call.target_label} isDepartment={call.target_type === 'department'} />
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium capitalize ${STATUS_BADGE[call.status] ?? STATUS_BADGE.open}`}>
                      {call.status}
                    </span>
                    <span className="tnum">
                      {call.status === 'resolved' ? `closed after ${formatAge(call.resolution_seconds)}` : `waiting ${formatAge(call.age_seconds)}`}
                    </span>
                  </div>

                  {/* The clock. An open call counts down to its target; an
                      escalated one wears the red badge whatever its status,
                      because "escalated" is a level, not a status word. */}
                  {(call.status === 'open' || (call.escalation_level ?? 0) > 0) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      {call.status === 'open' && <ResponseClock call={call} now={now} />}
                      <EscalationBadge call={call} now={now} />
                    </div>
                  )}

                  {/* Where it came from — location + run context */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    {call.location && (
                      <span className="inline-flex items-center gap-1 text-gray-300 font-medium">
                        <MapPin size={11} /> {call.location}
                      </span>
                    )}
                    {call.work_order_number && (
                      <span className="inline-flex items-center gap-1">
                        <Hash size={11} />
                        <span title={hasCompanyTag(call.work_order_number) ? call.work_order_number : undefined}>
                          {displayId(call.work_order_number)}
                        </span>
                        {call.part_name ? ` · ${call.part_name}` : ''}
                      </span>
                    )}
                    {call.app_name && (
                      <span className="truncate">{call.app_name}{call.step_name ? ` · ${call.step_name}` : ''}</span>
                    )}
                    {call.created_by && <span>by {call.created_by}</span>}
                  </div>

                  {call.message && (
                    <p className="text-sm text-gray-400 leading-relaxed line-clamp-2" title={call.message}>{noteText(call.message)}</p>
                  )}

                  {/* Responder + measured time-to-respond */}
                  {call.assigned_to && (
                    <p className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span>Responder: <span className="text-gray-300">{call.assigned_to}</span></span>
                      {call.response_seconds !== null && (
                        <span className={`inline-flex items-center gap-1 ${call.within_target === false ? 'text-amber-400' : 'text-green-400'}`}>
                          <Timer size={11} /> answered in {formatAge(call.response_seconds)}
                          {call.target_seconds
                            ? ` (target ${fmtDuration(call.target_seconds)})`
                            : ''}
                        </span>
                      )}
                    </p>
                  )}

                  {/* Actions */}
                  {call.status === 'open' && (
                    // Wraps: three actions do not fit one line on a phone (or in
                    // a three-up card on a laptop), and a button clipped by the
                    // card edge is a button nobody can press.
                    <div className="mt-auto flex flex-wrap gap-2">
                      <button
                        onClick={() => handleAcknowledge(call.id)}
                        disabled={isActioning}
                        className="btn-primary flex-1 min-w-[9rem] flex items-center justify-center gap-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isActioning ? <Loader2 size={14} className="animate-spin" /> : null}
                        On my way
                      </button>
                      <button
                        onClick={() => { setResolveCardId(call.id); setResolutionText(''); }}
                        disabled={isActioning}
                        className="btn-ghost text-sm px-3 disabled:opacity-50"
                        title="Resolve without acknowledging"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => handleCancel(call.id)}
                        disabled={isActioning}
                        className="btn-ghost text-sm px-3 disabled:opacity-50 inline-flex items-center gap-1.5"
                        title="Stand the call down — help is no longer needed"
                      >
                        <Ban size={13} /> Cancel call
                      </button>
                    </div>
                  )}

                  {call.status === 'acknowledged' && !isResolvingThis && (
                    <button
                      onClick={() => { setResolveCardId(call.id); setResolutionText(''); }}
                      disabled={isActioning}
                      className="mt-auto bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle size={14} />
                      Resolve
                    </button>
                  )}

                  {call.status !== 'resolved' && isResolvingThis && (
                    <div className="mt-auto space-y-2">
                      <textarea
                        className="input-field w-full resize-none text-sm"
                        rows={2}
                        placeholder="Resolution notes (optional)…"
                        value={resolutionText}
                        onChange={e => setResolutionText(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setResolveCardId(null); setResolutionText(''); }}
                          className="btn-ghost flex-1 text-sm py-1.5"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleResolve(call.id)}
                          disabled={isActioning}
                          className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm font-medium py-1.5 px-3 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isActioning ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}

                  {call.status === 'resolved' && (
                    <div className="mt-auto text-xs text-green-400 space-y-0.5">
                      <p>Resolved{call.resolved_by ? ` by ${call.resolved_by}` : ''}</p>
                      {/* Time to acknowledge, on a closed call — the number the
                          plant is actually judged on. A call nobody ever
                          acknowledged says so, rather than showing nothing. */}
                      <p data-testid="closed-time-to-acknowledge" className={call.response_seconds === null ? 'text-gray-500' : 'text-gray-400'}>
                        {call.response_seconds === null
                          ? 'Nobody acknowledged this call'
                          : `Acknowledged after ${formatAge(call.response_seconds)}${call.target_seconds ? ` of a ${fmtDuration(call.target_seconds)} target` : ''}`}
                      </p>
                      {call.resolution && <p className="text-gray-500 line-clamp-2" title={call.resolution}>{noteText(call.resolution)}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Raise Call Modal ── */}
      {showCreate && (
        <CallForHelpModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={() => { void auto.refresh(); }}
        />
      )}
    </div>
  );
}
