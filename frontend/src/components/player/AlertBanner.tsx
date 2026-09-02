// ─── Open help-request banner (player) ───────────────────────────────────────
// Sits under the header for as long as a call is open: "Quality notified ·
// 2m ago", switching to "Quality is on the way" the moment a responder taps "On
// my way" on the board. The run underneath is untouched — the only action here
// is cancelling the call.

import { BellRing, UserCheck, X } from 'lucide-react';
import { teamConfig, formatAge } from '../../config/andonTeams';
import type { AndonCall } from '../../types';

export default function AlertBanner({ call, ageSeconds, cancelling, onCancel }: {
  call: AndonCall;
  /** Ticked client-side so the age moves every second without re-fetching. */
  ageSeconds: number;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const cfg = teamConfig(call.team);
  const onTheWay = call.status === 'acknowledged';
  const Icon = onTheWay ? UserCheck : BellRing;
  const who = call.target_label || cfg.label;
  // A department alert borrows the accent rather than a function team's color.
  const color = call.target_type === 'department' ? 'var(--p-accent)' : cfg.playerColor;
  const tint = call.target_type === 'department' ? 'var(--p-accent-tint)' : cfg.playerTint;

  return (
    <div
      className="flex items-center gap-3 px-4 sm:px-6 py-2.5 flex-shrink-0"
      role="status"
      style={{
        background: onTheWay ? 'var(--p-good-wash)' : tint,
        borderBottom: `1px solid ${onTheWay ? 'rgba(74, 222, 128, 0.4)' : color}`,
        color: 'var(--p-ink)',
      }}
    >
      <Icon size={18} className="flex-shrink-0" style={{ color: onTheWay ? 'var(--p-good)' : color }} />
      <span style={{ fontSize: 15, fontWeight: 650 }} className="flex-1 min-w-0 truncate">
        {onTheWay
          ? <>{who} is on the way{call.assigned_to ? ` — ${call.assigned_to}` : ''}</>
          : <>{who} notified</>}
        <span className="tnum" style={{ color: 'var(--p-ink-2)', fontWeight: 550 }}> · {formatAge(ageSeconds)} ago</span>
      </span>
      {!onTheWay && <span className="p-live-dot flex-shrink-0" aria-hidden="true" />}
      <button
        onClick={onCancel}
        disabled={cancelling}
        className="flex items-center justify-center gap-1.5 flex-shrink-0"
        style={{
          minHeight: 40, padding: '0 14px', borderRadius: 'var(--p-r-ctrl)',
          border: '1px solid var(--p-border)', background: 'var(--p-surface-1)',
          color: 'var(--p-ink-2)', fontSize: 14, fontWeight: 650,
          opacity: cancelling ? 0.5 : 1,
        }}
      >
        <X size={15} /> {cancelling ? 'Cancelling…' : 'Cancel call'}
      </button>
    </div>
  );
}
