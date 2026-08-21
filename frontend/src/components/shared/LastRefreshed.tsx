import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// ─── LastRefreshed ────────────────────────────────────────────────────────────
// The freshness stamp that sits in an operational screen's header: a live
// "Updated 12s ago" counter, a dot that pulses while a fetch is in flight, and
// a manual refresh button. Pair it with `useAutoRefresh`.
//
// Colours come from design tokens only (--muted, --ink, --good, --baseline,
// --surface-2), so it reads correctly in the light workbench. On a surface that
// is dark regardless of the app theme (Andon board, TV boards, player), pass
// `onDark` — that scopes the shipped dark token palette to this element instead
// of hardcoding a second set of colours.

export interface LastRefreshedProps {
  /** Timestamp of the last successful load; null while the first one is in flight. */
  at: Date | null;
  /** True while a fetch is running — drives the pulse dot and the spinner. */
  refreshing?: boolean;
  /** Manual refresh handler. Omit to render the stamp without a button. */
  onRefresh?: () => void;
  /** Render against a permanently dark surface (Andon board, TV, player). */
  onDark?: boolean;
  /** Leading word. Default "Updated". */
  label?: string;
  className?: string;
}

/** "just now" / "12s ago" / "3m ago" / "2h ago" / "4d ago". */
export function formatFreshness(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function LastRefreshed({
  at,
  refreshing = false,
  onRefresh,
  onDark = false,
  label = 'Updated',
  className = '',
}: LastRefreshedProps) {
  // Re-render once a second so the age counts up on screen rather than only
  // when the page happens to fetch.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!at) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVisibilityChange = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [at]);

  const text = at ? `${label} ${formatFreshness(now - at.getTime())}` : 'Updating…';
  const exact = at ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : undefined;

  return (
    <div
      className={`${onDark ? 'dark ' : ''}hm-freshness inline-flex items-center gap-2 ${className}`}
      data-testid="last-refreshed"
    >
      <span className="relative flex items-center justify-center w-2 h-2 flex-shrink-0" aria-hidden="true">
        {refreshing && (
          <span
            className="absolute inline-flex w-2 h-2 rounded-full animate-ping"
            style={{ backgroundColor: 'var(--good)', opacity: 0.75 }}
          />
        )}
        <span
          className="relative inline-flex w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: refreshing ? 'var(--good)' : 'var(--baseline)' }}
        />
      </span>

      <span className="text-xs tnum whitespace-nowrap" title={exact ? `Last loaded at ${exact}` : undefined}>
        {text}
      </span>

      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh now"
          title="Refresh now"
          className="hm-freshness-btn p-1 rounded-md disabled:opacity-60 disabled:cursor-default"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
        </button>
      )}
    </div>
  );
}
