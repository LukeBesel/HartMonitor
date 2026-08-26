/**
 * WCAG contrast maths, shared by everything that has to stay legible on a
 * bright shop floor: the brand accent tokens, the guided tour, and the button
 * widget whose background an app author picks by hand.
 *
 * Everything here is pure and synchronous so the same numbers can be asserted
 * in unit tests and reproduced by a browser audit.
 */

export interface Rgb { r: number; g: number; b: number }

/** Ink used when a fill is too light to carry white text. Near-black with a
 *  navy cast so it sits in the product's palette instead of reading as pure
 *  #000. How dark it is matters: white-vs-fill and ink-vs-fill cross over at
 *  1.05 / sqrt(1.05 * (L(ink) + 0.05)), and that crossover is the worst ratio
 *  `readableInk` can ever return. At this luminance it is 4.54:1 — above the
 *  4.5 floor — where a lighter navy such as #0b1020 would drop it to 4.35. */
export const DARK_INK = '#01030a';
export const LIGHT_INK = '#ffffff';

/** AA body-text floor. The operator player draws its step-advance label at
 *  18px/650, which falls just under the 18.66px large-text threshold, so the
 *  small-text ratio is the one that applies. */
export const AA_TEXT = 4.5;

/** Parse `#rgb`, `#rrggbb`, `rgb()` and `rgba()`. Returns null for anything
 *  else (CSS variables, named colors, gradients) so callers can fall back
 *  rather than guess. */
export function parseColor(color: string | undefined | null): Rgb | null {
  if (!color) return null;
  const c = color.trim();
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (hex3) {
    return {
      r: parseInt(hex3[1] + hex3[1], 16),
      g: parseInt(hex3[2] + hex3[2], 16),
      b: parseInt(hex3[3] + hex3[3], 16),
    };
  }
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (hex6) {
    return { r: parseInt(hex6[1], 16), g: parseInt(hex6[2], 16), b: parseInt(hex6[3], 16) };
  }
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(c);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b };
  }
  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + part(r) + part(g) + part(b);
}

/** WCAG 2.x relative luminance. */
export function luminance(color: string | Rgb | undefined | null): number | null {
  const c = typeof color === 'string' || color == null ? parseColor(color as string) : color;
  if (!c) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio between two colors, or null when either is unparseable. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text color for a solid fill: whichever of white / near-black contrasts more
 * with it.
 *
 * This is never a guess. The two curves cross at 4.54:1 for the ink above (see
 * DARK_INK), so the better of the two always clears AA — every background an
 * author can pick in the builder ends up carrying legible text, with no
 * per-color list to maintain. Unparseable fills keep white, which is what the
 * widget shipped before.
 */
export function readableInk(background: string | undefined | null): string {
  const onLight = contrastRatio(DARK_INK, background ?? '');
  const onDark = contrastRatio(LIGHT_INK, background ?? '');
  if (onLight === null || onDark === null) return LIGHT_INK;
  return onLight >= onDark ? DARK_INK : LIGHT_INK;
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  return {
    r: color.r + (target.r - color.r) * amount,
    g: color.g + (target.g - color.g) * amount,
    b: color.b + (target.b - color.b) * amount,
  };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Push `color` toward black or white — whichever direction the ground calls
 * for — until it clears `target` against that ground, keeping as much of the
 * original hue as the requirement allows. A brand pink asked to sit on white
 * comes back a deeper pink, not a generic dark gray.
 *
 * Returns the input unchanged when it already passes or cannot be parsed.
 */
export function shiftUntilReadable(
  color: string | undefined | null,
  ground: string,
  target: number = AA_TEXT,
): string {
  const start = parseColor(color);
  const groundRgb = parseColor(ground);
  if (!start || !groundRgb) return color ?? '';
  const already = contrastRatio(toHex(start), groundRgb);
  if (already !== null && already >= target) return toHex(start);

  // Toward whichever extreme the ground is furthest from — on a white card
  // that means darkening, on the player's near-black shell, lightening.
  const toward = (contrastRatio(BLACK, groundRgb) ?? 0) >= (contrastRatio(WHITE, groundRgb) ?? 0) ? BLACK : WHITE;
  for (let amount = 0.02; amount <= 1.0001; amount += 0.02) {
    // Measure the value that will actually be PAINTED. toHex rounds each
    // channel to an integer, and testing the unrounded mix let a colour come
    // back at 4.48:1 against a 4.5 target — the guarantee has to hold for the
    // string this returns, not for the float it was derived from.
    const candidate = toHex(mix(start, toward, Math.min(amount, 1)));
    const ratio = contrastRatio(candidate, groundRgb);
    if (ratio !== null && ratio >= target) return candidate;
  }
  return toHex(toward);
}

/**
 * The two grounds the accent has to survive on, taken as the *worst* surface
 * in each theme rather than the most flattering one: in light mode the darkest
 * routine ground (a tinted chip or a hover row, not a white card), in dark mode
 * the lightest one. An accent that clears AA against these clears it on every
 * card, page and well in between.
 */
export const LIGHT_GROUND = '#e2e8f0';
export const DARK_GROUND = '#334155';

export interface AccentTokens {
  /** Accent as a filled surface carrying `accentFg` text. Theme-independent:
   *  a filled button's legibility depends only on its own two colors. */
  accent: string;
  /** Text color for that surface. */
  accentFg: string;
  /** Hover shade of the filled surface. */
  accentHover: string;
  /** Accent used as text, icons and underlines on the page ground. */
  accentInk: string;
  /** The untouched picked color, for halos, gradients and other decoration
   *  that carries no text. */
  accentGlow: string;
}

/**
 * Derive the contrast-safe accent family from whatever color the tenant picked
 * — a preset or a hand-typed hex from the theme editor.
 *
 * The brand color itself survives untouched for decoration; the text-bearing
 * forms are darkened (light) or lightened (dark) only as far as AA requires, so
 * an accent that already passes comes back exactly as chosen. The same deep
 * shade serves as ink on light grounds and as a fill under white text, because
 * both are the same measurement: contrast against white.
 */
export function deriveAccentTokens(accent: string, dark: boolean): AccentTokens {
  const parsed = parseColor(accent);
  const glow = parsed ? toHex(parsed) : accent;
  const solid = shiftUntilReadable(glow, LIGHT_GROUND);
  return {
    accent: solid,
    accentFg: readableInk(solid),
    accentHover: shiftUntilReadable(solid, LIGHT_GROUND, 7),
    accentInk: dark ? shiftUntilReadable(glow, DARK_GROUND) : solid,
    accentGlow: glow,
  };
}

// ─── A chip tinted with a colour the customer picked ──────────────────────────
// Department chips paint themselves with their department's own colour at 13%
// alpha and then write the SAME colour on top of it. That is the operator
// button's bug in a different costume: it looks deliberate, and for a green or
// yellow department it lands at 2.24:1. Nobody chose that — it falls out of
// whatever colour someone picked from a colour well.
//
// The ground is not the card: it is the card seen through the tint, and the
// card differs by theme. So the ink has to be derived per theme, from the same
// blend the browser will actually paint.

/** The alpha the chips use, as a fraction. `'22'` is 34/255. */
const CHIP_TINT = 0x22 / 255;

/** The surface a chip sits on: a white card in light mode, a slate one in dark. */
const CHIP_SURFACE_LIGHT = '#ffffff';
const CHIP_SURFACE_DARK = '#1e293b';

/**
 * Inline style for a chip tinted with `color`, on a surface the caller names.
 *
 * The background is left exactly as it was — only the text moves, and only as
 * far as it must, so a blue department still reads blue.
 *
 * `surface` must be the colour actually PAINTED behind the chip. Where a chip
 * sits on a translucent card over a gradient, the honest surface to pass is the
 * LIGHTEST one the chip can land on: the ink is pushed away from that ground,
 * and ink chosen to clear a light ground clears every darker one by more.
 */
export function tintedChipOn(
  color: string | undefined | null,
  surface: string,
): { backgroundColor: string; color: string } {
  const base = parseColor(color) ?? parseColor('#6b7280')!;
  const surfaceRgb = parseColor(surface) ?? parseColor(CHIP_SURFACE_LIGHT)!;
  // What the browser composites: the surface, with the colour laid over it at
  // the chip's alpha.
  const ground = toHex(mix(surfaceRgb, base, CHIP_TINT));
  return {
    backgroundColor: `${toHex(base)}22`,
    color: shiftUntilReadable(toHex(base), ground),
  };
}

/**
 * The same chip on the theme's routine card surface — a white card in light
 * mode, a slate one in dark.
 */
export function tintedChipStyle(
  color: string | undefined | null,
  dark: boolean,
): { backgroundColor: string; color: string } {
  return tintedChipOn(color, dark ? CHIP_SURFACE_DARK : CHIP_SURFACE_LIGHT);
}
