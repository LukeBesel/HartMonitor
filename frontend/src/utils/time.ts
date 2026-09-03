// ─── One answer to "how long ago was that?" ──────────────────────────────────
//
// This function existed four times over: here, and privately on Quality, CAPA
// and Kaizen. They disagreed twice. They worded the same age two ways ("5
// minutes ago" on two screens, "5m ago" on the other two), and all four read
// the stamp with `new Date()`, which takes SQLite's zone-less
// 'YYYY-MM-DD HH:MM:SS' for the BROWSER's local time — so the same activity
// entry read "8m ago" on a tablet set to UTC and "9h ago" on the one somebody
// had left on Tokyo. That is the same class of mistake as counting "today" in
// the browser, which the plant-day work already closed on the server.
//
// So: one definition, and it borrows both halves rather than inventing a rule
// of its own. The stamp goes through `parseServerTime` — this app's single rule
// for reading what the server wrote, the one `stampIn` and the run screens
// resolve a plant stamp with — and the wording follows `formatFreshness` in
// components/shared/LastRefreshed.tsx, which words an age already measured in
// milliseconds. Follows, not matches: the shared buckets are spelled the same
// ("just now", "5m ago", "3h ago", "12d ago"), but the two ends differ on
// purpose. formatFreshness counts SECONDS at the near end because it ticks
// under a live refresh indicator; this one runs out to MONTHS at the far end
// because an activity log and an idea board hold last quarter's rows.

import { parseServerTime } from '../components/apps/appModel';

/**
 * "just now" / "5m ago" / "3h ago" / "12d ago" / "4mo ago".
 *
 * An unreadable or missing stamp is stated as unknown — "—" — never as "just
 * now" and never as "0m ago". A row that quietly claims a broken timestamp is
 * seconds old is worse than one that admits it does not know; `concurrentRun`
 * in components/player/runtime.ts reports a null age for the same reason.
 */
export function timeAgo(dateStr: string | null | undefined): string {
  const at = parseServerTime(dateStr);
  if (!at) return '—';
  const mins = Math.floor((Date.now() - at.getTime()) / 60000);
  // A stamp in the future is two clocks disagreeing, not an event that has not
  // happened yet, so it reads as the present rather than as a negative age.
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  // Months, because an activity log and an idea board routinely hold something
  // from last quarter, and "412d ago" is a number nobody converts in their head.
  return `${Math.floor(days / 30)}mo ago`;
}
