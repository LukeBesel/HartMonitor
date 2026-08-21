// ─── Request help (app shell) ─────────────────────────────────────────────────
// The same Andon mechanism the operator player uses, available from anywhere in
// the management app — a supervisor at a desk, a materials clerk in the aisle,
// anyone who needs a team to know they're needed. Raised outside a run there is
// no work order / app / step to attach, so the request carries only who is
// needed, where, and the note; every one of those context columns is nullable.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Check, LifeBuoy, Loader2, X } from 'lucide-react';
import { api } from '../../api/client';
import { ANDON_TEAMS, ANDON_TEAM_ORDER, targetLabel, targetPayload } from '../../config/andonTeams';
import type { AlertTarget } from '../../config/andonTeams';
import type { Department, Station } from '../../types';

function sameTarget(a: AlertTarget | null, b: AlertTarget): boolean {
  if (!a) return false;
  if (a.kind === 'team' && b.kind === 'team') return a.team === b.team;
  if (a.kind === 'department' && b.kind === 'department') return a.id === b.id;
  return false;
}

function RequestHelpModal({ onClose }: { onClose: () => void }) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [target, setTarget] = useState<AlertTarget | null>(null);
  const [stationId, setStationId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  useEffect(() => {
    api.getDepartments().then(setDepartments).catch(() => setDepartments([]));
    api.getStations().then(rows => setStations(rows.filter(s => s.status === 'active'))).catch(() => setStations([]));
  }, []);

  const submit = useCallback(async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const station = stations.find(s => s.id === stationId);
      await api.createAndonCall({
        ...targetPayload(target),
        note: note.trim(),
        station_id: stationId || null,
        ...(target.kind === 'team' ? { department_id: station?.department_id || null } : {}),
      });
      setSentTo(targetLabel(target));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request. Try again.');
    } finally {
      setSubmitting(false);
    }
  }, [target, submitting, stations, stationId, note]);

  // Confirmation state — the request is out; the modal says so and gets out of the way.
  if (sentTo) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="card w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
          <div className="w-12 h-12 rounded-full bg-green-50 text-green-600 flex items-center justify-center mx-auto mb-3">
            <Check size={24} />
          </div>
          <h2 className="font-semibold text-gray-900">{sentTo} has been notified</h2>
          <p className="text-sm text-gray-500 mt-1">
            It's on the Andon Board now. You'll see it move when someone says they're on the way.
          </p>
          <button onClick={onClose} className="btn-primary w-full mt-5 justify-center">Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { if (!submitting) onClose(); }}>
      <div
        className="card w-full max-w-lg max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Request help"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <LifeBuoy size={17} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900 leading-tight">Request help</h2>
              <p className="text-xs text-gray-500">Let a team know they're needed</p>
            </div>
          </div>
          <button onClick={onClose} disabled={submitting} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-50">
            <X size={17} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div>
            <label className="section-label mb-2 block">Who do you need? *</label>
            <div className="grid grid-cols-2 gap-2">
              {ANDON_TEAM_ORDER.map(team => {
                const cfg = ANDON_TEAMS[team];
                const Icon = cfg.icon;
                const t: AlertTarget = { kind: 'team', team };
                const active = sameTarget(target, t);
                return (
                  <button
                    key={team}
                    type="button"
                    onClick={() => setTarget(t)}
                    aria-pressed={active}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      active ? `${cfg.chip} ring-2 ring-offset-1 ring-gray-900/10` : 'bg-white border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <Icon size={17} className="flex-shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-gray-900">{cfg.tileLabel}</span>
                      <span className="block text-[11px] text-gray-500 leading-snug">{cfg.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {departments.length > 0 && (
            <div>
              <label className="section-label mb-2 flex items-center gap-1.5">
                <Building2 size={12} /> Or a department
              </label>
              <div className="flex flex-wrap gap-1.5">
                {departments.map(dept => {
                  const t: AlertTarget = { kind: 'department', id: dept.id, name: dept.name };
                  const active = sameTarget(target, t);
                  return (
                    <button
                      key={dept.id}
                      type="button"
                      onClick={() => setTarget(t)}
                      aria-pressed={active}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                        active ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {dept.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {stations.length > 0 && (
            <div>
              <label className="section-label mb-1 block" htmlFor="help-station">Where (optional)</label>
              <select
                id="help-station"
                className="input-field w-full"
                value={stationId}
                onChange={e => setStationId(e.target.value)}
              >
                <option value="">— No specific station —</option>
                {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="section-label mb-1 block" htmlFor="help-note">What do you need? (optional)</label>
            <textarea
              id="help-note"
              className="input-field w-full resize-none"
              rows={3}
              placeholder="Anything that helps them arrive ready…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary flex-1 justify-center">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!target || submitting}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <LifeBuoy size={15} />}
              {submitting ? 'Notifying…' : target ? `Notify ${targetLabel(target)}` : 'Pick who you need'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sidebar entry point — sits beside Alerts so raising and reading help
 *  requests live in the same corner of the shell. */
export default function RequestHelpButton({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={collapsed ? 'Request help' : undefined}
        className={`flex items-center rounded-xl text-sm font-medium text-red-300/90 hover:text-white hover:bg-red-500/20 transition-all w-full ${
          collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2.5'
        }`}
      >
        <LifeBuoy size={15} className="flex-shrink-0" />
        {!collapsed && <span className="flex-1 text-left">Request help</span>}
      </button>
      {/* Portalled to <body>: the sidebar is a transformed element, which makes
          it the containing block for any `position: fixed` descendant — without
          this the dialog would be squeezed into the 224px sidebar column. */}
      {open && createPortal(<RequestHelpModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
