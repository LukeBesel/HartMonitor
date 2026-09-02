// Small pieces shared by more than one Materials panel. Everything else a
// panel needs stays inside that panel's own file.

/** "1,240". Null-safe so an absent count reads as 0 rather than "NaN". */
export function fmtNum(v: number | null | undefined): string {
  if (v == null) return '0';
  return v.toLocaleString('en-US');
}

/** The grey block a table row shows while its data is in flight. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className ?? ''}`} />;
}
