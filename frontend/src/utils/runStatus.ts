// ─── What a run's status is called out loud ──────────────────────────────────
//
// `completions.status` holds 'in_progress' | 'completed' | 'abandoned'. Those
// are column values, and no column value may reach a person's eyes — yet the
// Recent Runs table on a dashboard printed `in_progress`, underscore and all,
// into its status pill, and the station drill-down on Facilities derived its
// label from the same token with `.replace('_', ' ')`, which is the same enum
// wearing a space.
//
// So the word lives here once. "Running" is the product's word for a run in
// progress — the vocabulary test already bans the alternatives — and a status
// this file does not recognise reads "—", never the raw token and never a
// guessed "Unknown" that a manager would take for a real state.

/** How a completion's status reads on screen. */
const RUN_STATUS_LABEL: Record<string, string> = {
  in_progress: 'Running',
  completed: 'Completed',
  abandoned: 'Abandoned',
};

/**
 * The on-screen word for a run status.
 *
 * Anything absent, empty or unrecognised is "—": a status the frontend has not
 * been taught is a fact we do not have, and inventing a label for it is how a
 * new column value gets shown to a plant manager as if it were English.
 */
export function runStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return RUN_STATUS_LABEL[status] ?? '—';
}
