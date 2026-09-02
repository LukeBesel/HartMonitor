import { ChevronLeft, ChevronRight, CheckCircle, Loader2, Lock } from 'lucide-react';

export interface PlayerFooterProps {
  stepIndex: number;      // 0-based
  stepCount: number;
  canBack: boolean;
  isLast: boolean;
  blocked: boolean;
  blockReason: string;    // '' when navigation is free
  completing: boolean;
  /** The step advances through its own button widget — hide footer Next/Complete
   *  so there is exactly one way to advance, never two. */
  hideForward?: boolean;
  onBack: () => void;
  onNext: () => void;
  onComplete: () => void;
  /** Take the operator to whatever is blocking them: scroll it into view,
   *  highlight it, name it. Makes the reason line a button. */
  onShowBlocker?: () => void;
}

/** 72px trigger-driven footer nav (spec §5.1). Back is a ghost button hidden on
 *  the first step; Next is the ≥64px primary; on the last step it becomes the
 *  green Complete. The center shows step dots (condensed count on many steps)
 *  plus the current block reason when navigation is gated. */
export default function PlayerFooter(props: PlayerFooterProps) {
  const {
    stepIndex, stepCount, canBack, isLast, blocked, blockReason, completing,
    hideForward = false, onBack, onNext, onComplete, onShowBlocker,
  } = props;

  const showDots = stepCount <= 12;
  // A blocked forward button stays TAPPABLE, and is not marked disabled to
  // assistive tech either: `disabled` looked the same as "nothing happened" —
  // the operator tapped, nothing moved, and the reason was a 14px line they had
  // already scrolled past. Tapping now takes them to the field that is holding
  // the run up, so the button DOES something and must be reachable. It carries
  // the reason instead. Only the in-flight save actually disables it.
  const blockedProps = blocked
    ? { 'data-blocked': 'true', title: blockReason || undefined, style: { opacity: 0.6 } }
    : {};

  return (
    <footer
      className="flex-shrink-0 flex items-center gap-2 sm:gap-3 px-3 sm:px-6"
      style={{
        minHeight: 72,
        background: 'var(--p-surface-1)',
        borderTop: '1px solid var(--p-border)',
        paddingTop: 8,
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
      }}
    >
      {/* Back — ghost, hidden on the first step. The 120px slot only exists on
          ≥sm screens; phones give that width to the block-reason line. */}
      <div className="sm:min-w-[120px] flex-shrink-0">
        {canBack && (
          <button className="p-btn p-btn-ghost" onClick={onBack} aria-label="Back">
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
          <button
            type="button"
            onClick={onShowBlocker}
            disabled={!onShowBlocker}
            className="flex items-center gap-1.5 truncate max-w-full"
            style={{
              fontSize: 14, fontWeight: 550, color: 'var(--p-warn)',
              textDecoration: onShowBlocker ? 'underline' : 'none',
              textUnderlineOffset: 3, minHeight: 32, padding: '0 4px',
            }}
            title={onShowBlocker ? 'Show me what is missing' : undefined}
          >
            <Lock size={13} className="flex-shrink-0" />
            <span className="truncate">{blockReason}</span>
          </button>
        )}
      </div>

      {/* Next / Complete — hidden when the step's own button widget advances */}
      {hideForward ? (
        <div className="sm:min-w-[120px]" aria-hidden="true" />
      ) : isLast ? (
        <button
          className="p-btn p-btn-good"
          onClick={onComplete}
          {...blockedProps}
          disabled={completing}
        >
          {completing ? <Loader2 size={22} className="animate-spin" /> : <CheckCircle size={22} />}
          {completing ? 'Saving…' : 'Complete'}
        </button>
      ) : (
        <button
          className="p-btn p-btn-primary"
          onClick={onNext}
          {...blockedProps}
        >
          Next <ChevronRight size={22} />
        </button>
      )}
    </footer>
  );
}
