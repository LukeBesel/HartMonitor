import { deriveAccentTokens } from './contrast';

/**
 * Keeps the brand accent legible whatever color a tenant picks.
 *
 * The theme layer publishes one `--accent` and the app then uses it three ways
 * that pull in opposite directions: as a filled surface under white text, as
 * text on the page ground, and as a decorative halo. A single value cannot
 * satisfy all three — the launch audit measured the default pink at 3.53:1 as
 * an active tab and 3.53:1 as a CTA, and darkening it enough for those would
 * have dulled the glow that makes the product recognisable.
 *
 * So the picked color is split here, once, into a family: `--accent-glow` keeps
 * it exactly as chosen for decoration, `--accent` becomes the shade deep enough
 * to carry white text (and to be read as text on light grounds), and
 * `--accent-ink` is the theme-aware text form, lightened in dark mode. Every
 * existing `var(--accent)` site inherits the fix without being touched.
 *
 * This runs outside React because the theme is applied as inline custom
 * properties on <html>, which beat any stylesheet rule; the observer simply
 * re-derives whenever those properties or the dark-mode class change.
 */

let lastRaw = '';
let lastSolid = '';
let lastDark: boolean | null = null;

function sync(): void {
  const root = document.documentElement;
  const declared = getComputedStyle(root).getPropertyValue('--accent').trim();
  const dark = root.classList.contains('dark');

  // A value we wrote ourselves means the theme has not changed since the last
  // pass; anything else is a freshly picked accent to derive from.
  const isOurs = !!lastSolid && declared === lastSolid;
  const raw = declared && !isOurs ? declared : lastRaw;
  if (!raw) return;

  // Short-circuit only when nothing changed AND what we derived is still the
  // value on the element. Comparing the raw input alone was not enough. The
  // boot script in index.html paints the stored accent before React exists, so
  // this runs once against it and derives — and then ThemeContext's own write
  // of that SAME raw value lands afterwards. Same input, so the old guard
  // returned here; but our derived value had just been overwritten, which left
  // the raw colour on <html> permanently. A tenant on yellow read 1.19:1.
  if (raw === lastRaw && dark === lastDark && isOurs) return;

  const t = deriveAccentTokens(raw, dark);
  lastRaw = raw;
  lastSolid = t.accent;
  lastDark = dark;

  root.style.setProperty('--accent', t.accent);
  root.style.setProperty('--accent-dark', t.accentHover);
  root.style.setProperty('--accent-fg', t.accentFg);
  root.style.setProperty('--accent-ink', t.accentInk);
  root.style.setProperty('--accent-glow', t.accentGlow);
  root.style.setProperty('--nav-active', t.accent);
}

export function installAccentTokens(): void {
  if (typeof document === 'undefined') return;
  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
}
