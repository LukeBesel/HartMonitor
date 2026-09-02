// ─── One sentence, three screens ──────────────────────────────────────────────
//
// The Command Center, a department's own page and its wall board all report the
// same schedule health from the same payload (api/floor.ts). They used to word
// it three ways — "75%", "6 of 8 on track", "2 of 4 open work orders on track" —
// and a supervisor comparing the office screen with the board on the wall could
// not tell whether the plant had changed or the wording had.
//
// So the sentence is written ONCE, here, and every screen prints the string this
// returns verbatim. When there is nothing to be on track with it returns null
// and the caller prints '—' beside `on_track_reason`, never "0%".

/** The two fields the sentence is made of. Any floor payload carries them. */
export interface OnTrackCounts {
  on_track: number;
  open_work_orders: number;
}

/**
 * "6 of 8 open work orders on track", or null when no work order is open.
 *
 * Null is not an error state: a plant with nothing scheduled has no share to
 * report, and 0% would read as "everything is late".
 */
export function onTrackSentence(counts: OnTrackCounts | null | undefined): string | null {
  if (!counts || !counts.open_work_orders || counts.open_work_orders <= 0) return null;
  return `${counts.on_track} of ${counts.open_work_orders} open work orders on track`;
}
