export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * A takt or cycle figure in minutes, as a person should read it.
 *
 * These come off the database as a plain division and carry the full float
 * tail: an operator's job card was showing `6.083333333333333m takt`. One
 * decimal is the whole useful signal — enough to tell a 6.1 minute takt from a
 * 6.5 minute one, and nothing beyond that is real precision.
 */
export function fmtMinutes(min: number): string {
  return Number.isInteger(min) ? String(min) : min.toFixed(1);
}
