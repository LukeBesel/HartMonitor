// ─── Compatibility shim — normalizeApp() (spec §2.4) ──────────────────────────
// Pure function run on every app load in BOTH builder and player. v1 blobs are
// never mutated in the DB until the user saves from the new builder (which
// writes schema_version: 2). The player and builder only ever see v2 shapes.
//
// Guarantees:
//   - legacy `buttonType` buttons behave identically (synthesized triggers,
//     NOT persisted until next save);
//   - `parts_list` and every other v1 field pass through untouched;
//   - idempotent: normalizeApp(normalizeApp(x)) is deeply equal to
//     normalizeApp(x).

import type { App, Widget } from '../types';

export function normalizeApp(raw: App): App {
  return {
    ...raw,
    schema_version: 2,
    step_groups: raw.step_groups ?? [],
    variables: raw.variables ?? [],
    steps: (raw.steps ?? []).map((s, i) => ({
      layoutMode: 'flow',                      // v1 default (existing behavior)
      ...s,
      order: s.order ?? i,
      triggers: s.triggers ?? [],
      widgets: (s.widgets ?? []).map(normalizeWidget),
    })),
  };
}

function normalizeWidget(w: Widget): Widget {
  if (w.triggers?.length) return w;
  // Legacy button semantics → synthesized trigger (NOT persisted until next save)
  if (w.type === 'button') {
    const map = { next: { type: 'next_step' }, prev: { type: 'prev_step' },
                  complete: { type: 'complete_app' } } as const;
    const bt = w.config.buttonType ?? 'next';
    const action = map[bt as keyof typeof map];
    return { ...w, triggers: action
      ? [{ id: `legacy_${w.id}`, event: 'button_press', conditions: [], match: 'all', actions: [action] }]
      : [] };
  }
  return { ...w, triggers: [] };
}
