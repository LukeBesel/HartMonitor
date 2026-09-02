// ─── Shared building blocks for the four settings groups ─────────────────────
// Settings used to be one 4,300-line file with thirteen tabs. It is now four
// groups, each assembled from the section components beside this file. The
// pieces every section needs live here so a section can be moved between
// groups without dragging a copy of them along.

import type { ReactNode } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { browserTimeZone } from '../../api/client';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Stockholm',
];

// The shortlist above is a convenience, not the set of zones a company may be
// in: signup now stores whatever zone the browser reported, which is any of the
// ~400 IANA names. A stored zone missing from the <select> renders as the first
// option, so opening Settings and pressing Save would silently move the plant's
// day to UTC. Fold the current value (and this browser's) into the list instead.
export function timeZoneOptions(current: string): string[] {
  const seen = new Set(TIMEZONES);
  const extra = [current, browserTimeZone()].filter(tz => tz && !seen.has(tz));
  return [...TIMEZONES, ...new Set(extra)];
}

/** The current wall-clock time in `tz`, or '' for a zone this browser rejects. */
export function clockIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).format(new Date());
  } catch {
    return '';
  }
}

export const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-purple-100 text-purple-700',
  manager:   'bg-blue-100 text-blue-700',
  supervisor:'bg-cyan-100 text-cyan-700',
  operator:  'bg-green-100 text-green-700',
  viewer:    'bg-gray-100 text-gray-600',
};

export function ProgressBar({ value, max, accent }: { value: number; max: number; accent: string }) {
  const pct = max < 0 ? 100 : Math.min(100, Math.round((value / max) * 100));
  const isUnlimited = max < 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
      <div
        className="h-2 rounded-full transition-all"
        style={{ width: `${isUnlimited ? 40 : pct}%`, backgroundColor: accent }}
      />
    </div>
  );
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 pb-3 border-b border-gray-100">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

export function Toast({ message, type = 'success', onDismiss }: {
  message: string;
  type?: 'success' | 'error';
  onDismiss: () => void;
}) {
  return (
    <div
      className={`fixed bottom-40 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
        type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
      }`}
    >
      {type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-70 hover:opacity-100 text-xs">✕</button>
    </div>
  );
}

/**
 * One titled section of a settings group.
 *
 * Every old `?tab=` id is now a section inside a group, so each one needs a
 * stable anchor the shell can scroll to. Wide content (tables, editors) scrolls
 * inside the section instead of widening the page — on a 390px phone the page
 * itself must never move sideways.
 *
 * `scroll-mt-40` is scroll-margin, not a scroll position: it is the height of
 * everything above the first section, so arriving at a group's FIRST section
 * leaves the page where it is — heading and four tabs still on screen — and
 * arriving at a later one does not tuck it underneath them.
 */
export function SettingsSection(
  { id, title, description, children }:
  { id: string; title: string; description?: string; children: ReactNode },
) {
  return (
    <section
      id={`settings-section-${id}`}
      data-section={id}
      aria-labelledby={`settings-section-${id}-heading`}
      className="scroll-mt-40 mb-10 last:mb-0"
    >
      <div className="mb-4">
        <h2 id={`settings-section-${id}-heading`} className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}
