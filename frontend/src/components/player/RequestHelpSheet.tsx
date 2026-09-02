// ─── Call for help (player) ───────────────────────────────────────────────────
// A bottom sheet of big touch tiles — one per team the operator can alert, plus
// the company's own departments where they exist. Picking one raises an Andon
// alert carrying the whole run context; the run itself is never paused or reset.
// Nothing dials anyone: this notifies the people who can help.
// Tiles are ≥120px tall (well past the 56px floor) so a gloved hand at a tablet
// hits the right one first time.

import { useState } from 'react';
import { Building2, Loader2, LifeBuoy, X } from 'lucide-react';
import { ANDON_TEAMS, ANDON_TEAM_ORDER } from '../../config/andonTeams';
import type { AlertTarget } from '../../config/andonTeams';
import type { AndonTeam } from '../../types';

export interface HelpDepartment { id: string; name: string }

function sameTarget(a: AlertTarget | null, b: AlertTarget): boolean {
  if (!a) return false;
  if (a.kind === 'team' && b.kind === 'team') return a.team === b.team;
  if (a.kind === 'department' && b.kind === 'department') return a.id === b.id;
  return false;
}

export default function RequestHelpSheet({
  context, departments, submitting, error, alertedTeams, alertedDepartments, onClose, onRequest,
}: {
  /** One line of "where this alert is coming from", shown so the operator can
   *  see exactly what the responder will be told. */
  context: string;
  /** The company's own departments, offered alongside the four function teams. */
  departments: HelpDepartment[];
  submitting: boolean;
  error: string;
  /** Teams already alerted from this run — shown as alerted rather than offered
   *  again, so nobody double-notifies the same people. */
  alertedTeams: AndonTeam[];
  alertedDepartments: string[];
  onClose: () => void;
  onRequest: (target: AlertTarget, note: string) => void;
}) {
  const [selected, setSelected] = useState<AlertTarget | null>(null);
  const [note, setNote] = useState('');

  const selectedLabel = selected
    ? (selected.kind === 'team' ? ANDON_TEAMS[selected.team].label : selected.name)
    : '';

  const tileStyle = (active: boolean, disabled: boolean, color: string, tint: string) => ({
    minHeight: 120,
    padding: '16px 18px',
    borderRadius: 'var(--p-r-card)',
    background: active ? tint : 'var(--p-surface-2)',
    border: `2px solid ${active ? color : 'var(--p-border)'}`,
    color: 'var(--p-ink)',
    touchAction: 'manipulation' as const,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? ('not-allowed' as const) : ('pointer' as const),
  });

  return (
    <div className="p-sheet-backdrop" onClick={() => { if (!submitting) onClose(); }}>
      <div
        className="p-sheet"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Call for help"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2" style={{ fontSize: 20, fontWeight: 750, color: 'var(--p-ink)' }}>
            <LifeBuoy size={20} style={{ color: 'var(--p-live)' }} /> Call for help
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            style={{ color: 'var(--p-muted)', width: 56, height: 56 }}
            className="flex items-center justify-center"
          >
            <X size={22} />
          </button>
        </div>
        <p style={{ fontSize: 14.5, color: 'var(--p-muted)', marginBottom: 16 }}>
          Who should we notify? Your job keeps running — nothing is lost.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {ANDON_TEAM_ORDER.map(team => {
            const cfg = ANDON_TEAMS[team];
            const Icon = cfg.icon;
            const target: AlertTarget = { kind: 'team', team };
            const isSelected = sameTarget(selected, target);
            const alreadyAlerted = alertedTeams.includes(team);
            return (
              <button
                key={team}
                onClick={() => setSelected(target)}
                disabled={submitting || alreadyAlerted}
                aria-pressed={isSelected}
                className="flex flex-col items-start justify-center gap-1.5 text-left"
                style={tileStyle(isSelected, submitting || alreadyAlerted, cfg.playerColor, cfg.playerTint)}
              >
                <Icon size={26} style={{ color: cfg.playerColor }} />
                <span style={{ fontSize: 19, fontWeight: 750, lineHeight: 1.15 }}>{cfg.tileLabel}</span>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--p-muted)', lineHeight: 1.3 }}>
                  {alreadyAlerted ? 'Already notified — they are on their way' : cfg.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* The company's own departments — "different departments for different
            things" without inventing a vocabulary they don't use. */}
        {departments.length > 0 && (
          <div className="mt-4">
            <div
              className="flex items-center gap-1.5 mb-2"
              style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--p-muted)', textTransform: 'uppercase' }}
            >
              <Building2 size={13} /> Or a department
            </div>
            <div className="grid grid-cols-2 gap-3">
              {departments.map(dept => {
                const target: AlertTarget = { kind: 'department', id: dept.id, name: dept.name };
                const isSelected = sameTarget(selected, target);
                const alreadyAlerted = alertedDepartments.includes(dept.id);
                return (
                  <button
                    key={dept.id}
                    onClick={() => setSelected(target)}
                    disabled={submitting || alreadyAlerted}
                    aria-pressed={isSelected}
                    className="flex items-center gap-2.5 text-left"
                    style={{
                      ...tileStyle(isSelected, submitting || alreadyAlerted, 'var(--p-accent)', 'var(--p-accent-tint)'),
                      minHeight: 72,
                    }}
                  >
                    <Building2 size={20} style={{ color: 'var(--p-accent)', flexShrink: 0 }} />
                    <span className="min-w-0">
                      <span style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }} className="block truncate">
                        {dept.name}
                      </span>
                      {alreadyAlerted && (
                        <span style={{ fontSize: 12, color: 'var(--p-muted)' }}>Already notified</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="p-label" htmlFor="andon-note">Note (optional)</label>
          <textarea
            id="andon-note"
            className="p-input"
            rows={2}
            style={{ minHeight: 72, resize: 'vertical', fontSize: 16 }}
            placeholder="What do you need? e.g. torque reading out of spec"
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={submitting}
          />
        </div>

        {context && (
          <p style={{ fontSize: 12.5, color: 'var(--p-muted)', marginTop: 10 }}>
            They will be told: <span style={{ color: 'var(--p-ink-2)' }}>{context}</span>
          </p>
        )}

        {error && <div className="p-field-error" role="alert">{error}</div>}

        <button
          className="p-btn w-full mt-4"
          style={{
            minHeight: 64,
            background: selected ? 'var(--p-live)' : 'var(--p-surface-2)',
            color: selected ? '#fff' : 'var(--p-muted)',
            border: `1px solid ${selected ? 'var(--p-live)' : 'var(--p-border)'}`,
          }}
          disabled={!selected || submitting}
          onClick={() => selected && onRequest(selected, note.trim())}
        >
          {submitting ? <Loader2 size={20} className="animate-spin" /> : <LifeBuoy size={20} />}
          {submitting
            ? 'Notifying…'
            : selected ? `Notify ${selectedLabel}` : 'Pick who you need'}
        </button>
      </div>
    </div>
  );
}
