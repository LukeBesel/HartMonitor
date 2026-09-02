// ─── "You're not signed off for this" ────────────────────────────────────────
//
// Shown when a start comes back 403 NOT_QUALIFIED, which only ever happens in a
// company that has deliberately set training enforcement to Block.
//
// The sheet has one job: say exactly what is wrong, to the person standing at
// the tablet, in words that tell them what to do next. Not "403", not "not
// authorized" — the app they tried to run, their own name, and the date their
// certificate ran out, if it ever existed. Then one field: a supervisor's PIN.
//
// Cancel goes back to the floor through the player's own exit helper, so the
// operator stays signed in and does not have to enter their PIN again to try
// something else.

import { useState } from 'react';
import { AlertTriangle, ShieldCheck, X, Loader2 } from 'lucide-react';
import type { QualificationState } from '../../api/training';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "4 Jul" — a date an operator reads, not an ISO stamp. Built from the parts
 *  rather than toLocaleDateString, because a certificate expiry is a calendar
 *  date and must not slide a day on a tablet in another zone. */
function expiryLabel(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return '';
  return `${Number(m[3])} ${month}`;
}

export interface QualificationSheetProps {
  appName: string;
  operatorName: string;
  state: QualificationState;
  expiryDate: string | null;
  submitting: boolean;
  /** Inline message from the last failed attempt (bad PIN, wrong role). */
  error: string;
  onCancel: () => void;
  onApprove: (pin: string) => void;
  /** The supervisor PIN this SANDBOX hands out, when the server said this is a
   *  sandbox (GET /api/auth/me → demo_hints). Absent everywhere else, and an
   *  absent value renders nothing — a real plant must never be shown a PIN. */
  demoSupervisorPin?: string | null;
}

export default function QualificationSheet({
  appName, operatorName, state, expiryDate, submitting, error, onCancel, onApprove,
  demoSupervisorPin,
}: QualificationSheetProps) {
  const [pin, setPin] = useState('');

  const when = expiryLabel(expiryDate);
  // Never invent a reason. An expiry with no readable date says so, and an
  // operator with no record at all is told that, not given a blank bracket.
  const reason = state === 'expired'
    ? (when ? `expired ${when}` : 'certification expired')
    : 'no record';

  const who = operatorName.trim();
  const headline = who
    ? `${who} isn't signed off for ${appName} (${reason}).`
    : `You're not signed off for ${appName} (${reason}).`;

  const submit = () => {
    if (submitting || !pin.trim()) return;
    onApprove(pin.trim());
  };

  return (
    <div className="p-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Not signed off">
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }}>
            <AlertTriangle size={19} style={{ color: 'var(--p-warn)' }} /> Not signed off
          </div>
          <button
            onClick={onCancel} aria-label="Close"
            style={{ color: 'var(--p-muted)', width: 44, height: 44 }}
            className="flex items-center justify-center"
          ><X size={20} /></button>
        </div>

        <div className="space-y-4">
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--p-ink)' }}>{headline}</p>
          <p style={{ fontSize: 14.5, color: 'var(--p-ink-2)' }}>
            Ask a supervisor to approve this run. Their approval is recorded against
            this job and names both of you.
          </p>

          <div>
            <label className="p-label" htmlFor="qual-override-pin">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={15} style={{ color: 'var(--p-good)' }} /> Supervisor PIN
              </span>
            </label>
            <input
              id="qual-override-pin"
              className="p-input p-mono"
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Supervisor enters their PIN…"
              value={pin}
              onChange={e => setPin(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            />
          </div>

          {/* A visitor exploring a demo has no supervisor to fetch and no way to
              guess the PIN, so the sandbox says it. The server decides whether
              this is a sandbox; this screen never guesses. */}
          {demoSupervisorPin && (
            <p data-testid="demo-pin-hint" style={{ fontSize: 13, color: 'var(--p-muted)' }}>
              Demo: supervisor PIN <span className="p-mono" style={{ color: 'var(--p-ink-2)' }}>{demoSupervisorPin}</span>
            </p>
          )}

          {error && <div className="p-field-error">{error}</div>}

          <div className="flex gap-3">
            <button className="p-btn p-btn-ghost flex-1" onClick={onCancel} disabled={submitting}>
              Back to jobs
            </button>
            <button
              className="p-btn p-btn-primary flex-1"
              style={{ minWidth: 0 }}
              disabled={submitting || !pin.trim()}
              onClick={submit}
            >
              {submitting ? <Loader2 size={20} className="animate-spin" /> : null}
              {submitting ? 'Approving…' : 'Approve & start'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
