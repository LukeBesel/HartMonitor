import { useMemo } from 'react';
import { CheckCircle, AlertTriangle, Package, Tag, CloudOff, RotateCw } from 'lucide-react';
import type { Step } from '../../types';
import { formatDur } from './runtime';

const CONFETTI_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#ec4899'];

function ConfettiBurst() {
  const pieces = useMemo(() =>
    Array.from({ length: 26 }, (_, i) => ({
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      cx: `${(Math.random() * 2 - 1) * 220}px`,
      cy: `${120 + Math.random() * 180}px`,
      cr: `${Math.round((Math.random() * 2 - 1) * 720)}deg`,
      delay: `${Math.random() * 0.25}s`,
    })), []);
  return (
    <div aria-hidden="true" className="absolute inset-x-0 top-0 pointer-events-none overflow-visible">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="p-confetti"
          style={{
            background: p.color,
            animationDelay: p.delay,
            ['--cx' as string]: p.cx,
            ['--cy' as string]: p.cy,
            ['--cr' as string]: p.cr,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export interface RunSummaryProps {
  appName: string;
  operatorName: string;
  productTypeName?: string;
  steps: Step[];
  stepTimes: Record<number, number>;
  getStepTakt: (idx: number) => number;
  taktExceededSteps: number[];
  capturedCount: number;
  kitSummary: string | null;    // e.g. "9/9 verified" — null when no kit
  savedLocally: boolean;        // completed while offline
  /** Run context carried into the next unit (WO number / part number), or null. */
  contextLabel?: string | null;
  /** Non-empty = "Next unit" is disabled with this short reason (no context yet). */
  nextUnitDisabledReason?: string;
  /** One-tap change affordance: back to setup with the fields retained. */
  onChangeContext?: () => void;
  onNextUnit: () => void;
  onDone: () => void;
}

/** Completion screen (spec §5.6): confetti micro-burst, duration vs takt,
 *  captured values count, kit status, "Next unit" (same setup — multi-unit
 *  work orders) and "Done". */
export default function RunSummary(props: RunSummaryProps) {
  const {
    appName, operatorName, productTypeName, steps, stepTimes, getStepTakt,
    taktExceededSteps, capturedCount, kitSummary, savedLocally,
    contextLabel, nextUnitDisabledReason, onChangeContext, onNextUnit, onDone,
  } = props;

  const totalSeconds = Object.values(stepTimes).reduce((a, b) => a + b, 0);
  const totalTakt = steps.reduce((a, _s, i) => a + getStepTakt(i), 0);

  return (
    <div className="p-root items-center justify-center p-4 sm:p-6 relative">
      <ConfettiBurst />
      <div className="p-card w-full max-w-md p-6 sm:p-8 relative">
        <div className="text-center mb-5">
          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-full p-check-pop"
            style={{ width: 64, height: 64, background: 'var(--p-good-wash)' }}
          >
            <CheckCircle size={32} style={{ color: 'var(--p-good)' }} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: 'var(--p-ink)' }}>Complete!</h1>
          <p style={{ fontSize: 14, color: 'var(--p-muted)', marginTop: 4 }}>
            {appName} · {operatorName || 'Operator'}
          </p>
          {productTypeName && (
            <p className="flex items-center justify-center gap-1 mt-1" style={{ fontSize: 13, color: 'var(--p-accent)' }}>
              <Tag size={12} /> {productTypeName}
            </p>
          )}
        </div>

        {savedLocally && (
          <div className="p-well flex items-center gap-2.5 px-4 py-3 mb-4" style={{ color: 'var(--p-warn)' }}>
            <CloudOff size={17} className="flex-shrink-0" />
            <span style={{ fontSize: 14, fontWeight: 550 }}>Saved locally — will sync when back online</span>
          </div>
        )}

        {/* Stat tiles: duration vs takt, values, kit */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="p-well px-3 py-3 text-center">
            <div style={{ fontSize: 11, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)' }}>Duration</div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 750, color: taktExceededSteps.length > 0 ? 'var(--p-warn)' : 'var(--p-good)' }}>
              {formatDur(totalSeconds)}
            </div>
            {totalTakt > 0 && (
              <div className="tnum" style={{ fontSize: 11, color: 'var(--p-muted)' }}>takt {formatDur(totalTakt)}</div>
            )}
          </div>
          <div className="p-well px-3 py-3 text-center">
            <div style={{ fontSize: 11, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)' }}>Values</div>
            <div className="tnum" style={{ fontSize: 22, fontWeight: 750, color: 'var(--p-ink)' }}>{capturedCount}</div>
            <div style={{ fontSize: 11, color: 'var(--p-muted)' }}>captured</div>
          </div>
          <div className="p-well px-3 py-3 text-center">
            <div style={{ fontSize: 11, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)' }}>Kit</div>
            {kitSummary ? (
              <div className="tnum flex items-center justify-center gap-1" style={{ fontSize: 16, fontWeight: 750, color: 'var(--p-ink)', minHeight: 30 }}>
                <Package size={14} style={{ color: 'var(--p-accent)' }} /> {kitSummary}
              </div>
            ) : (
              <div style={{ fontSize: 16, color: 'var(--p-muted)', minHeight: 30 }} className="flex items-center justify-center">—</div>
            )}
          </div>
        </div>

        {taktExceededSteps.length > 0 && (
          <div className="p-well flex items-start gap-2.5 px-4 py-3 mb-4">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--p-warn)' }} />
            <div style={{ fontSize: 12.5, color: 'var(--p-warn-ink)' }}>
              <span style={{ fontWeight: 650 }}>Takt exceeded</span> on {taktExceededSteps.length} step{taktExceededSteps.length > 1 ? 's' : ''}: {taktExceededSteps.map(i => steps[i]?.name).filter(Boolean).join(', ')}
            </div>
          </div>
        )}

        {/* Per-step breakdown */}
        <div className="p-well p-4 mb-5">
          <div className="flex justify-between pb-2 mb-2" style={{ fontSize: 11.5, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)', borderBottom: '1.5px solid var(--p-baseline)' }}>
            <span>Step</span><span>Time</span>
          </div>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {steps.map((step, i) => {
              const t = stepTimes[i] ?? 0;
              const taktS = getStepTakt(i);
              const exceeded = taktS > 0 && t > taktS;
              return (
                <div key={step.id} className="flex justify-between" style={{ fontSize: 14 }}>
                  <span style={{ color: 'var(--p-ink-2)' }} className="truncate mr-3">{step.name}</span>
                  <span className="tnum flex-shrink-0" style={{ fontWeight: 550, color: exceeded ? 'var(--p-bad)' : 'var(--p-ink)' }}>
                    {t ? formatDur(t) : '—'}{exceeded ? ' ⚠' : ''}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between pt-2 mt-2" style={{ fontSize: 14, fontWeight: 750, color: 'var(--p-ink)', borderTop: '1px solid var(--p-baseline)' }}>
            <span>Total</span><span className="tnum">{formatDur(totalSeconds)}</span>
          </div>
        </div>

        {/* Next-unit run context: carried forward, one tap to change */}
        {(contextLabel || onChangeContext) && (
          <div className="p-well flex items-center gap-2.5 px-4 py-2.5 mb-3">
            <span style={{ fontSize: 12, fontWeight: 550, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--p-muted)' }} className="flex-shrink-0">
              Next unit
            </span>
            <span className="flex-1 truncate" style={{ fontSize: 14.5, fontWeight: 650, color: contextLabel ? 'var(--p-ink)' : 'var(--p-muted)' }}>
              {contextLabel || 'No work order or part number'}
            </span>
            {onChangeContext && (
              <button
                onClick={onChangeContext}
                style={{ fontSize: 14, fontWeight: 650, color: 'var(--p-accent)', minHeight: 36, padding: '0 8px' }}
              >
                Change
              </button>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <button
            className="p-btn p-btn-primary flex-1"
            style={{ minWidth: 0 }}
            onClick={onNextUnit}
            disabled={!!nextUnitDisabledReason}
            title={nextUnitDisabledReason || undefined}
          >
            <RotateCw size={19} /> Next unit
          </button>
          <button className="p-btn p-btn-ghost flex-1" onClick={onDone}>Done</button>
        </div>
        {nextUnitDisabledReason && (
          <p className="text-center mt-2" style={{ fontSize: 13, color: 'var(--p-warn)' }}>{nextUnitDisabledReason}</p>
        )}
      </div>
    </div>
  );
}
