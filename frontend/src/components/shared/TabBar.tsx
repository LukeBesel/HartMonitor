import type { ReactNode } from 'react';

export interface TabBarItem<K extends string = string> {
  key: K;
  label: string;
  /** Rendered before the label — pass the icon element so each caller keeps its own size. */
  icon?: ReactNode;
  /** Rendered after the label, e.g. a count pill. */
  badge?: ReactNode;
}

export interface TabBarProps<K extends string> {
  items: TabBarItem<K>[];
  active: K;
  onSelect: (key: K) => void;
  /** `underline` sits on a hairline rule; `pill` is a segmented control on a card. */
  variant?: 'underline' | 'pill';
  /** Names the row for screen readers, e.g. "Maintenance screens". */
  ariaLabel: string;
  className?: string;
}

/**
 * A row of tabs that scrolls inside itself instead of widening the page.
 *
 * Every tabbed screen used to lay its tabs out in a plain flex row. Four or
 * more labelled tabs are wider than a 390px phone, so the row pushed the whole
 * page out past the viewport: reaching the last tab meant dragging the entire
 * layout sideways, heading and all, which is what "zoomed in" feels like. The
 * row now owns its own horizontal scroller.
 *
 * `w-max min-w-full` lets the nav grow past the viewport while still filling it
 * when the tabs fit, so the underline rule reaches both edges either way.
 * `shrink-0` stops flex squeezing the tabs down to fit rather than scrolling,
 * and `whitespace-nowrap` keeps a two-word label like "Work Orders" on one line.
 * The horizontal padding is cancelled by the negative margin so a focus ring is
 * not clipped by the scroller.
 *
 * The active tab is drawn in `--accent-ink`, the same theme-aware colour the
 * workspace tabs in the app shell use, rather than the three different
 * hardcoded blues and indigos the pages had grown apart into.
 */
export default function TabBar<K extends string>({
  items, active, onSelect, variant = 'underline', ariaLabel, className = '',
}: TabBarProps<K>) {
  const isPill = variant === 'pill';

  return (
    <div className={`overflow-x-auto -mx-1 px-1 ${isPill ? '' : 'border-b border-gray-200'} ${className}`}>
      <nav
        aria-label={ariaLabel}
        className={isPill
          ? 'flex w-max gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm'
          : '-mb-px flex w-max min-w-full gap-1'}
      >
        {items.map(item => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={isActive ? 'page' : undefined}
              className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium transition-colors ${
                isPill
                  ? `px-4 py-2 rounded-lg ${isActive ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`
                  : `px-4 py-2.5 border-b-2 ${isActive ? '' : 'border-transparent text-gray-500 hover:text-gray-700'}`
              }`}
              style={isActive
                ? (isPill
                    ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { borderColor: 'var(--accent-ink)', color: 'var(--accent-ink)' })
                : undefined}
            >
              {item.icon}
              {item.label}
              {item.badge}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
