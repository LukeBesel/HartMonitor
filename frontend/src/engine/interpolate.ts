// ─── {{variable}} interpolation (spec §3.2 rule 6) ────────────────────────────
// Pure string templating: `{{name}}` resolves variables first, then app_info;
// unknown refs render an em dash. No eval, no expressions — plain lookups only.
// Used by the trigger engine for message/NCR text and by text/instruction
// widgets at render time (cheap Tulip-style data binding).

/** Matches `{{ name }}` tokens (identifier-style names, optional whitespace). */
const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Rendered in place of a token whose name resolves to nothing. */
export const MISSING_PLACEHOLDER = '—'; // —

export type InterpolationScope = Record<string, string | number | boolean>;

function renderValue(v: string | number | boolean): string {
  return typeof v === 'string' ? v : String(v);
}

/**
 * Replace every `{{name}}` token in `text`.
 * Resolution order: `variables[name]`, then `appInfo[name]`, else `—`.
 * `null`/`undefined` values count as unresolved (fallback applies).
 */
export function interpolate(
  text: string,
  variables: InterpolationScope = {},
  appInfo: Record<string, string | number> = {},
): string {
  return text.replace(TOKEN, (_match, name: string) => {
    const fromVar = variables[name];
    if (fromVar !== undefined && fromVar !== null) return renderValue(fromVar);
    const fromInfo = appInfo[name];
    if (fromInfo !== undefined && fromInfo !== null) return renderValue(fromInfo);
    return MISSING_PLACEHOLDER;
  });
}
