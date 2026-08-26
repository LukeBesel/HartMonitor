import { useEffect, useRef, useState } from 'react';
import {
  MoreVertical, Package, X, Pause, Play, AlertTriangle, WifiOff, Tag, ShieldCheck, LogOut,
  LifeBuoy,
} from 'lucide-react';
import { formatDur } from './runtime';

export interface PlayerHeaderProps {
  appName: string;
  workOrderNumber?: string;
  partName?: string;
  productTypeName?: string;
  operatorName: string;
  operatorVerified: boolean;
  stepIndex: number;          // 0-based
  stepCount: number;
  taktSeconds: number;        // 0 = untimed step
  stepElapsed: number;
  isOverTakt: boolean;
  paused: boolean;
  offlinePending: number;     // outbox depth; 0 = online / clean
  isOffline: boolean;
  preview: boolean;
  hasPartsList: boolean;
  onTogglePause: () => void;
  onAbandon: () => void;
  onShowParts: () => void;
  onReportProblem: () => void;
  /** Open the Request-help sheet (Quality / Supervisor / Maintenance /
   *  Materials, plus the company's departments). Present in every mode —
   *  preview just suppresses the write. */
  onRequestHelp: () => void;
  /** True while a request raised from this run is still open — the button
   *  becomes a live indicator rather than a way to notify the same team twice. */
  helpRequested: boolean;
  /** Pause-and-leave: save progress, close the operator's session (with an
   *  optional handoff comment) and return to setup so another operator can
   *  resume. Absent in preview mode (nothing to hand off). */
  onLeaveJob?: () => void;
}

/** Takt countdown ring: accent → amber at 80% → red flashing past takt. */
function TaktRing({ taktSeconds, elapsed, isOver }: { taktSeconds: number; elapsed: number; isOver: boolean }) {
  const pct = Math.min(1, taktSeconds > 0 ? elapsed / taktSeconds : 0);
  const warn = !isOver && pct >= 0.8;
  const r = 24;
  const c = 2 * Math.PI * r;
  const stroke = isOver ? 'var(--p-live)' : warn ? 'var(--p-warn)' : 'var(--p-accent)';
  const cls = isOver ? 'p-takt-over' : warn ? 'p-takt-warn' : 'p-takt-normal';
  return (
    <div className="flex items-center gap-3">
      <div className="relative p-takt-ringviz" style={{ width: 56, height: 56 }}>
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r={r} fill="none" stroke="var(--p-surface-2)" strokeWidth="5" />
          <circle
            cx="28" cy="28" r={r} fill="none"
            stroke={stroke} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            transform="rotate(-90 28 28)"
            style={{ transition: 'stroke-dashoffset 0.5s linear' }}
          />
        </svg>
        {isOver && (
          <AlertTriangle size={16} className="absolute inset-0 m-auto" style={{ color: 'var(--p-live)' }} />
        )}
      </div>
      <div>
        <div className={`tnum p-takt-num ${cls}`}>
          {isOver ? `+${formatDur(elapsed - taktSeconds)}` : formatDur(taktSeconds - elapsed)}
        </div>
        <div style={{ fontSize: 11, fontWeight: 550, color: 'var(--p-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {isOver ? 'Over takt' : 'Remaining'}
        </div>
      </div>
    </div>
  );
}

export default function PlayerHeader(props: PlayerHeaderProps) {
  const {
    appName, workOrderNumber, partName, productTypeName, operatorName, operatorVerified,
    stepIndex, stepCount, taktSeconds, stepElapsed, isOverTakt, paused,
    offlinePending, isOffline, preview, hasPartsList,
    onTogglePause, onAbandon, onShowParts, onReportProblem, onRequestHelp, onLeaveJob,
    helpRequested,
  } = props;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const progress = stepCount > 0 ? ((stepIndex + 1) / stepCount) * 100 : 0;
  const initial = (operatorName || 'O').trim().charAt(0).toUpperCase();

  const menuItem = 'w-full flex items-center gap-3 px-4 py-3.5 text-left text-[15px] font-[550] transition-colors hover:brightness-110';

  return (
    <header
      className="flex-shrink-0"
      style={{ background: 'var(--p-surface-1)', borderBottom: '1px solid var(--p-border)' }}
    >
      <div className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-6 py-2 sm:py-2.5 flex-wrap">
        {/* App name + chips. On phones this strip takes its own thin row and
            side-scrolls instead of wrapping the header four rows deep. */}
        <div className="p-hdr-ctx flex items-center gap-2.5 min-w-0 flex-wrap">
          <span style={{ fontSize: 16, fontWeight: 650, color: 'var(--p-ink)' }} className="p-hdr-appname truncate whitespace-nowrap">
            {appName}
          </span>
          {preview && (
            <span className="p-chip p-chip-gold" style={{ fontWeight: 750, letterSpacing: '0.5px' }}>PREVIEW</span>
          )}
          {workOrderNumber && (
            <span className="p-chip p-chip-gold">
              <span className="p-mono">{workOrderNumber}</span>
              {partName && <span style={{ color: 'var(--p-ink-2)' }}>· {partName}</span>}
            </span>
          )}
          {productTypeName && (
            <span className="p-chip"><Tag size={12} /> {productTypeName}</span>
          )}
          {(isOffline || offlinePending > 0) && (
            <span className="p-chip p-chip-warn">
              <WifiOff size={13} />
              offline{offlinePending > 0 ? ` — ${offlinePending} pending` : ''}
            </span>
          )}
          {paused && <span className="p-chip p-chip-warn"><Pause size={13} /> Paused</span>}
        </div>

        <div className="flex-1" />

        {/* Step position */}
        <div className="text-center">
          <div className="tnum" style={{ fontSize: 20, fontWeight: 750, color: 'var(--p-ink)', lineHeight: 1.1 }}>
            {stepIndex + 1} / {stepCount}
          </div>
          <div style={{ fontSize: 11, fontWeight: 550, color: 'var(--p-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Step
          </div>
        </div>

        {/* Takt ring */}
        {taktSeconds > 0 && (
          <TaktRing taktSeconds={taktSeconds} elapsed={stepElapsed} isOver={isOverTakt} />
        )}

        {/* Operator chip — phones show the avatar only; the name still reads
            out via the title/aria-label. */}
        <span className="p-chip" style={{ paddingLeft: 4, minHeight: 36 }} title={operatorName || 'Operator'} aria-label={`Operator ${operatorName || 'Operator'}`}>
          {/* --p-accent on its own tint is 3.59:1, which is fine for the 22px+
              numerals it was picked for but not for this 13px initial. The
              lighter step measures 5.38:1 on the same ground. */}
          <span
            className="flex items-center justify-center rounded-full"
            style={{ width: 28, height: 28, background: 'var(--p-accent-tint)', color: 'var(--p-accent-hover)', fontWeight: 750, fontSize: 13 }}
          >
            {initial}
          </span>
          <span className="max-w-[120px] truncate hidden sm:inline">{operatorName || 'Operator'}</span>
          {operatorVerified && <ShieldCheck size={14} style={{ color: 'var(--p-good)' }} />}
        </span>

        {/* Request help — the one action an operator must never have to hunt
            for. Always visible in the shell, 56px tall, and it turns into a
            live indicator while a request from this run is still open. */}
        <button
          onClick={onRequestHelp}
          className="flex items-center gap-2 rounded-xl transition-colors flex-shrink-0"
          aria-label={helpRequested ? 'Help is on the way — open the request' : 'Request help'}
          style={{
            minHeight: 56, padding: '0 16px', fontSize: 15, fontWeight: 700,
            background: helpRequested ? 'var(--p-live)' : 'rgba(224, 49, 49, 0.14)',
            color: helpRequested ? '#fff' : '#ffb3b3',
            border: `1px solid ${helpRequested ? 'var(--p-live)' : 'rgba(224, 49, 49, 0.55)'}`,
            touchAction: 'manipulation',
          }}
        >
          {helpRequested
            ? <span className="p-live-dot" style={{ background: '#fff' }} aria-hidden="true" />
            : <LifeBuoy size={19} />}
          <span className="hidden sm:inline">{helpRequested ? 'Help requested' : 'Request help'}</span>
        </button>

        {/* ⋯ menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Menu"
            className="flex items-center justify-center rounded-xl transition-colors"
            style={{ width: 48, height: 48, color: 'var(--p-ink-2)', background: menuOpen ? 'var(--p-surface-2)' : 'transparent' }}
          >
            <MoreVertical size={22} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 mt-1 z-50 overflow-hidden"
              style={{
                minWidth: 230, background: 'var(--p-surface-1)', border: '1px solid var(--p-border)',
                borderRadius: 'var(--p-r-card)', boxShadow: 'var(--p-shadow-pop)', color: 'var(--p-ink)',
              }}
            >
              <button className={menuItem} onClick={() => { setMenuOpen(false); onTogglePause(); }}>
                {paused ? <Play size={17} /> : <Pause size={17} />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              {hasPartsList && (
                <button className={menuItem} onClick={() => { setMenuOpen(false); onShowParts(); }}>
                  <Package size={17} /> Parts &amp; materials
                </button>
              )}
              <button
                className={menuItem}
                style={{ color: '#ffb3b3' }}
                onClick={() => { setMenuOpen(false); onRequestHelp(); }}
              >
                <LifeBuoy size={17} /> {helpRequested ? 'Help requested — view' : 'Request help'}
              </button>
              <button className={menuItem} onClick={() => { setMenuOpen(false); onReportProblem(); }}>
                <AlertTriangle size={17} /> Report quality issue
              </button>
              {onLeaveJob && (
                <button className={menuItem} onClick={() => { setMenuOpen(false); onLeaveJob(); }}>
                  <LogOut size={17} /> Leave job (save progress)
                </button>
              )}
              <button
                className={menuItem}
                style={{ color: 'var(--p-bad)', borderTop: '1px solid var(--p-border)' }}
                onClick={() => { setMenuOpen(false); onAbandon(); }}
              >
                <X size={17} /> Abandon run
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Thin accent progress bar */}
      <div style={{ height: 3, background: 'var(--p-surface-2)' }}>
        <div
          style={{ height: '100%', width: `${progress}%`, background: 'var(--p-accent)', transition: 'width 0.4s ease' }}
        />
      </div>
    </header>
  );
}
