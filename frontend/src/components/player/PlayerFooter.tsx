import { ChevronLeft, ChevronRight, CheckCircle, Loader2, Lock } from 'lucide-react';

export interface PlayerFooterProps {
  stepIndex: number;      // 0-based
  stepCount: number;
  canBack: boolean;
  isLast: boolean;
  blocked: boolean;
  blockReason: string;    // '' when navigation is free
  completing: boolean;
  onBack: () => void;
  onNext: () => void;
  onComplete: () => void;
}

/** 72px trigger-driven footer nav (spec §5.1). Back is a ghost button hidden on
 *  the first step; Next is the ≥64px primary; on the last step it becomes the
 *  green Complete. The center shows step dots (condensed count on many steps)
 *  plus the current block reason when navigation is gated. */
export default function PlayerFooter(props: PlayerFooterProps) {
  const {
    stepIndex, stepCount, canBack, isLast, blocked, blockReason, completing,
    onBack, onNext, onComplete,
  } = props;

  const showDots = stepCount <= 12;

  return (
    <footer
      className="flex-shrink-0 flex items-center gap-3 px-4 sm:px-6"
      style={{
        minHeight: 72,
        background: 'var(--p-surface-1)',
        borderTop: '1px solid var(--p-border)',
        paddingTop: 8,
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Back — ghost, hidden on the first step */}
      <div style={{ minWidth: 120 }}>
        {canBack && (
          <button className="p-btn p-btn-ghost" onClick={onBack}>
            <ChevronLeft size={20} /> <span className="hidden sm:inline">Back</span>
          </button>
        )}
      </div>

      {/* Center: dots / condensed position + block reason */}
      <div className="flex-1 flex flex-col items-center justify-center gap-1.5 min-w-0">
        {showDots ? (
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: stepCount }, (_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: i === stepIndex ? 20 : 8,
                  height: 8,
                  transition: 'all 0.25s',
                  background: i === stepIndex
                    ? 'var(--p-accent)'
                    : i < stepIndex ? 'var(--p-good)' : 'var(--p-baseline)',
                }}
              />
            ))}
          </div>
        ) : (
          <div className="tnum" style={{ fontSize: 15, fontWeight: 650, color: 'var(--p-ink-2)' }}>
            {stepIndex + 1} / {stepCount}
          </div>
        )}
        {blocked && blockReason && (
          <div
            className="flex items-center gap-1.5 truncate max-w-full"
            style={{ fontSize: 14, fontWeight: 550, color: 'var(--p-warn)' }}
          >
            <Lock size={13} className="flex-shrink-0" />
            <span className="truncate">{blockReason}</span>
          </div>
        )}
      </div>

      {/* Next / Complete */}
      {isLast ? (
        <button
          className="p-btn p-btn-good"
          onClick={onComplete}
          disabled={blocked || completing}
        >
          {completing ? <Loader2 size={22} className="animate-spin" /> : <CheckCircle size={22} />}
          {completing ? 'Saving…' : 'Complete'}
        </button>
      ) : (
        <button
          className="p-btn p-btn-primary"
          onClick={onNext}
          disabled={blocked}
        >
          Next <ChevronRight size={22} />
        </button>
      )}
    </footer>
  );
}
