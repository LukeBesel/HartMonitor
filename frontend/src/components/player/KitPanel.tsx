import { useState } from 'react';
import {
  Check, CheckCircle, Flag, Package, ScanLine, Undo2, X, Minus, Plus,
} from 'lucide-react';
import type { KitLine, BOMLine, PartItem, KitStatus } from '../../types';
import { kitProgress, scopedKitLines } from './runtime';

// ─── Status chip ──────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<KitLine['status'], { label: string; style: React.CSSProperties }> = {
  pending:  { label: 'Pending',  style: { background: 'var(--p-surface-2)', color: 'var(--p-muted)', border: '1px solid var(--p-border)' } },
  picked:   { label: 'Picked',   style: { background: 'var(--p-accent-tint)', color: 'var(--p-accent)', border: '1px solid transparent' } },
  verified: { label: 'Verified', style: { background: 'var(--p-good-wash)', color: 'var(--p-good)', border: '1px solid transparent' } },
  short:    { label: 'Short',    style: { background: 'var(--p-warn-wash)', color: 'var(--p-warn)', border: '1px solid transparent' } },
};

function StatusChip({ status, pop }: { status: KitLine['status']; pop: boolean }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
      style={{ fontSize: 13, fontWeight: 650, ...s.style }}
    >
      {status === 'verified' && <Check size={14} className={pop ? 'p-check-pop' : ''} />}
      {status === 'short' && <Flag size={13} />}
      {s.label}
    </span>
  );
}

// ─── Summary bar (pinned above the footer, spec §5.4) ─────────────────────────

export function KitSummaryBar({ lines, requireScan, kitStatus }: {
  lines: KitLine[];
  requireScan: boolean;
  kitStatus: KitStatus;
}) {
  const p = kitProgress(lines, requireScan);
  const chip = p.complete
    ? { text: 'Kit complete', cls: 'p-chip-good' }
    : p.short > 0
      ? { text: 'Kit short', cls: 'p-chip-warn' }
      : { text: kitStatus === 'picking' ? 'Picking' : 'In progress', cls: '' };
  return (
    <div
      className="flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5"
      style={{ background: 'var(--p-surface-2)', borderTop: '1px solid var(--p-border)' }}
    >
      <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}>
        <Package size={16} style={{ color: 'var(--p-accent)' }} />
        <span className="tnum">{p.done}/{p.total} verified{p.short > 0 ? ` · ${p.short} short` : ''}</span>
      </div>
      <span className={`p-chip ${chip.cls}`}>{chip.text}</span>
    </div>
  );
}

// ─── Bottom sheet: tap-to-verify / mark short / undo ─────────────────────────

function LineSheet({ line, allowShort, requireScan, onClose, onVerify, onMarkShort, onUndoShort }: {
  line: KitLine;
  allowShort: boolean;
  requireScan: boolean;
  onClose: () => void;
  onVerify: (line: KitLine) => void;
  onMarkShort: (line: KitLine, qty: number, reason: string) => void;
  onUndoShort: (line: KitLine) => void;
}) {
  const [shortMode, setShortMode] = useState(false);
  const [qty, setQty] = useState(line.qty_picked);
  const [reason, setReason] = useState('');

  const canVerify = !requireScan && (line.status === 'pending' || line.status === 'picked');
  const canShort = allowShort && (line.status === 'pending' || line.status === 'picked');
  const canUndo = line.status === 'short';

  return (
    <div className="p-sheet-backdrop" onClick={onClose}>
      <div className="p-sheet" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div style={{ fontSize: 18, fontWeight: 650, color: 'var(--p-ink)' }} className="truncate">{line.item_name || line.sku}</div>
            <div className="p-mono" style={{ fontSize: 14, color: 'var(--p-muted)' }}>
              {line.sku}{line.reference ? ` · ${line.reference}` : ''}
            </div>
            <div className="tnum" style={{ fontSize: 14, color: 'var(--p-ink-2)', marginTop: 2 }}>
              {line.qty_picked}/{line.qty_required} {line.unit}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex items-center justify-center rounded-xl"
            style={{ width: 44, height: 44, color: 'var(--p-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {shortMode ? (
          <div className="space-y-4">
            <div>
              <label className="p-label">Quantity actually available</label>
              <div className="flex items-center gap-3">
                <button className="p-btn p-btn-ghost" style={{ minWidth: 64 }} onClick={() => setQty(q => Math.max(0, q - 1))} aria-label="Decrease">
                  <Minus size={20} />
                </button>
                <div className="tnum flex-1 text-center" style={{ fontSize: 30, fontWeight: 750, color: 'var(--p-ink)' }}>
                  {qty} <span style={{ fontSize: 15, fontWeight: 550, color: 'var(--p-muted)' }}>/ {line.qty_required} {line.unit}</span>
                </div>
                <button className="p-btn p-btn-ghost" style={{ minWidth: 64 }} onClick={() => setQty(q => Math.min(line.qty_required, q + 1))} aria-label="Increase">
                  <Plus size={20} />
                </button>
              </div>
            </div>
            <div>
              <label className="p-label">Reason</label>
              <input className="p-input" placeholder="e.g. bin empty, damaged part…" value={reason}
                onChange={e => setReason(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button className="p-btn p-btn-ghost flex-1" onClick={() => setShortMode(false)}>Cancel</button>
              <button
                className="p-btn flex-1"
                style={{ background: 'var(--p-warn)', color: '#3a2703' }}
                onClick={() => onMarkShort(line, qty, reason)}
              >
                <Flag size={18} /> Mark short
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {canVerify && (
              <button className="p-btn p-btn-good w-full" onClick={() => onVerify(line)}>
                <CheckCircle size={22} /> Verify
              </button>
            )}
            {requireScan && (line.status === 'pending' || line.status === 'picked') && (
              <div className="p-well px-4 py-3 flex items-center gap-2" style={{ fontSize: 14, color: 'var(--p-ink-2)' }}>
                <ScanLine size={16} style={{ color: 'var(--p-accent)' }} />
                Scan required — tap-to-verify is disabled for this checklist
              </div>
            )}
            {line.status === 'verified' && (
              <div className="p-well px-4 py-3 flex items-center gap-2" style={{ fontSize: 14, color: 'var(--p-good)' }}>
                <CheckCircle size={16} /> Verified{line.verified_by ? ` by ${line.verified_by}` : ''}
              </div>
            )}
            {canShort && (
              <button className="p-btn p-btn-ghost w-full" onClick={() => { setQty(line.qty_picked); setShortMode(true); }}>
                <Flag size={18} style={{ color: 'var(--p-warn)' }} /> Mark short
              </button>
            )}
            {canUndo && (
              <button className="p-btn p-btn-ghost w-full" onClick={() => onUndoShort(line)}>
                <Undo2 size={18} /> Undo short — back to picked
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export interface KitPanelProps {
  /** Kit lines when a kit exists for the run. */
  lines: KitLine[] | null;
  kitStatus: KitStatus | null;
  /** Read-only active BOM fallback when no kit was generated (spec §5.4). */
  bomLines: BOMLine[] | null;
  /** Last-resort legacy parts_list fallback. */
  partsList: PartItem[] | null;
  scope: 'step' | 'all';
  currentStepId: string;
  allowShort: boolean;
  requireScan: boolean;
  /** Line id that just got verified — drives the check-pop flash. */
  poppedLineId: string | null;
  onRequestScan: () => void;
  onVerify: (line: KitLine) => void;
  onMarkShort: (line: KitLine, qty: number, reason: string) => void;
  onUndoShort: (line: KitLine) => void;
}

export default function KitPanel(props: KitPanelProps) {
  const {
    lines, kitStatus, bomLines, partsList, scope, currentStepId,
    allowShort, requireScan, poppedLineId,
    onRequestScan, onVerify, onMarkShort, onUndoShort,
  } = props;
  const [sheetLine, setSheetLine] = useState<KitLine | null>(null);

  // ── No kit: read-only BOM, else legacy parts_list, never blocks v1 apps ──
  if (!lines) {
    const fallback = bomLines && bomLines.length > 0
      ? bomLines.map(l => ({ name: l.item_name || l.item_id, sku: l.sku || '', qty: l.qty_per, unit: l.unit, ref: l.reference }))
      : (partsList || []).map(p => ({ name: p.name, sku: p.sku || '', qty: p.quantity, unit: p.unit || '', ref: '' }));
    return (
      <div className="p-card p-4">
        <div className="flex items-center gap-2 mb-3" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}>
          <Package size={16} style={{ color: 'var(--p-accent)' }} />
          {bomLines && bomLines.length > 0 ? 'Bill of materials' : 'Parts & materials'}
          <span className="p-chip" style={{ fontSize: 11 }}>read-only</span>
        </div>
        {fallback.length === 0 ? (
          <div style={{ fontSize: 14, color: 'var(--p-muted)' }}>No kit or BOM for this run.</div>
        ) : (
          <div>
            {fallback.map((f, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i < fallback.length - 1 ? '1px solid var(--p-grid)' : 'none' }}>
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 15, fontWeight: 550, color: 'var(--p-ink)' }}>{f.name}</span>
                  {f.sku && <span className="p-mono ml-2" style={{ fontSize: 13, color: 'var(--p-muted)' }}>{f.sku}</span>}
                </div>
                <span className="tnum" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink-2)' }}>
                  {f.qty}{f.unit ? ` ${f.unit}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const visible = scopedKitLines(lines, scope, currentStepId);

  return (
    <div className="p-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--p-border)' }}>
        <div className="flex items-center gap-2" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink)' }}>
          <Package size={16} style={{ color: 'var(--p-accent)' }} />
          Kit verification
          {kitStatus === 'cancelled' && <span className="p-chip p-chip-warn">cancelled</span>}
        </div>
        <button className="p-btn p-btn-ghost" style={{ minHeight: 48 }} onClick={onRequestScan}>
          <ScanLine size={18} /> Scan
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="px-4 py-6 text-center" style={{ fontSize: 14, color: 'var(--p-muted)' }}>
          No kit lines for this step.
        </div>
      ) : (
        <div>
          {visible.map((line, i) => (
            <button
              key={line.id}
              onClick={() => setSheetLine(line)}
              className={`w-full flex items-center gap-3 px-4 text-left transition-colors ${line.id === poppedLineId ? 'p-row-flash-good' : ''}`}
              style={{
                minHeight: 64,
                borderBottom: i < visible.length - 1 ? '1px solid var(--p-grid)' : 'none',
                background: 'transparent',
              }}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ fontSize: 16, fontWeight: 550, color: 'var(--p-ink)' }}>
                  {line.item_name || line.sku}
                </div>
                <div className="p-mono truncate" style={{ fontSize: 13, color: 'var(--p-muted)' }}>
                  {line.sku}{line.reference ? ` · ${line.reference}` : ''}
                  {line.status === 'short' && line.short_reason ? ` · ${line.short_reason}` : ''}
                </div>
              </div>
              <span className="tnum flex-shrink-0" style={{ fontSize: 16, fontWeight: 650, color: 'var(--p-ink-2)' }}>
                {line.qty_picked}/{line.qty_required} {line.unit}
              </span>
              <StatusChip status={line.status} pop={line.id === poppedLineId} />
            </button>
          ))}
        </div>
      )}

      {sheetLine && (
        <LineSheet
          // Re-read the freshest copy of the line so optimistic updates show in the sheet
          line={lines.find(l => l.id === sheetLine.id) ?? sheetLine}
          allowShort={allowShort}
          requireScan={requireScan}
          onClose={() => setSheetLine(null)}
          onVerify={l => { setSheetLine(null); onVerify(l); }}
          onMarkShort={(l, qty, reason) => { setSheetLine(null); onMarkShort(l, qty, reason); }}
          onUndoShort={l => { setSheetLine(null); onUndoShort(l); }}
        />
      )}
    </div>
  );
}
