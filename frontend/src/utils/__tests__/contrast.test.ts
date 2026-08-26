import { describe, it, expect } from 'vitest';
import {
  AA_TEXT,
  DARK_GROUND,
  DARK_INK,
  LIGHT_GROUND,
  LIGHT_INK,
  contrastRatio,
  deriveAccentTokens,
  luminance,
  parseColor,
  readableInk,
  shiftUntilReadable,
  tintedChipStyle,
  toHex,
} from '../contrast';

/** The exact colors the launch audit measured in a browser. */
const BRAND_PINK = '#ec4899';
const SEEDED_GREEN = '#22c55e';
const TOUR_BLUE = '#3b82f6';

describe('parseColor', () => {
  it('reads the notations the app actually stores and getComputedStyle returns', () => {
    expect(parseColor('#ec4899')).toEqual({ r: 236, g: 72, b: 153 });
    expect(parseColor('#EC4899')).toEqual({ r: 236, g: 72, b: 153 });
    expect(parseColor('#f0a')).toEqual({ r: 255, g: 0, b: 170 });
    expect(parseColor('rgb(236, 72, 153)')).toEqual({ r: 236, g: 72, b: 153 });
    expect(parseColor('rgba(236, 72, 153, 0.5)')).toEqual({ r: 236, g: 72, b: 153 });
    expect(parseColor('rgb(236 72 153 / 50%)')).toEqual({ r: 236, g: 72, b: 153 });
  });

  it('returns null rather than guessing at values it cannot read', () => {
    expect(parseColor('var(--accent)')).toBeNull();
    expect(parseColor('hotpink')).toBeNull();
    expect(parseColor('linear-gradient(#fff, #000)')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('')).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe('luminance and contrastRatio', () => {
  it('matches the WCAG reference values at both ends of the scale', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBe(1);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric and reproduces the ratios the browser audit measured', () => {
    expect(contrastRatio(BRAND_PINK, '#ffffff')).toBeCloseTo(3.53, 2);
    expect(contrastRatio('#ffffff', BRAND_PINK)).toBeCloseTo(3.53, 2);
    expect(contrastRatio(BRAND_PINK, '#1e293b')).toBeCloseTo(4.15, 2);
    expect(contrastRatio('#ffffff', SEEDED_GREEN)).toBeCloseTo(2.28, 2);
    expect(contrastRatio('#ffffff', TOUR_BLUE)).toBeCloseTo(3.68, 2);
    expect(contrastRatio('#6b7280', '#0a0e27')).toBeCloseTo(3.93, 2);
    expect(contrastRatio('#d97706', '#fffbeb')).toBeCloseTo(3.07, 2);
  });

  it('returns null when either side is unreadable', () => {
    expect(contrastRatio('var(--accent)', '#ffffff')).toBeNull();
    expect(contrastRatio('#ffffff', 'transparent')).toBeNull();
  });
});

describe('readableInk', () => {
  it('flips the seeded green button from white text to dark, clearing AA', () => {
    expect(readableInk(SEEDED_GREEN)).toBe(DARK_INK);
    expect(contrastRatio(readableInk(SEEDED_GREEN), SEEDED_GREEN)!).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('keeps white on colors deep enough to carry it', () => {
    expect(readableInk('#b33774')).toBe(LIGHT_INK);
    expect(readableInk('#000000')).toBe(LIGHT_INK);
    expect(readableInk('#ffffff')).toBe(DARK_INK);
  });

  it('clears AA for every color a builder color well can produce', () => {
    // White and black contrast curves cross at 4.58:1, so the better of the two
    // is always above the 4.5 floor — walk the cube and prove it.
    let worst = Infinity;
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const bg = toHex({ r, g, b });
          worst = Math.min(worst, contrastRatio(readableInk(bg), bg)!);
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('falls back to white when the fill cannot be parsed, as the widget always did', () => {
    expect(readableInk('var(--p-accent)')).toBe(LIGHT_INK);
    expect(readableInk(undefined)).toBe(LIGHT_INK);
  });
});

describe('shiftUntilReadable', () => {
  it('leaves a color that already passes exactly as it was', () => {
    expect(shiftUntilReadable('#b91c1c', '#ffffff')).toBe('#b91c1c');
  });

  it('darkens against a light ground and lightens against a dark one', () => {
    const onLight = shiftUntilReadable(BRAND_PINK, '#ffffff');
    const onDark = shiftUntilReadable(BRAND_PINK, '#1e293b');
    expect(luminance(onLight)!).toBeLessThan(luminance(BRAND_PINK)!);
    expect(luminance(onDark)!).toBeGreaterThan(luminance(BRAND_PINK)!);
    expect(contrastRatio(onLight, '#ffffff')!).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(onDark, '#1e293b')!).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('stays in the same hue family — a pink comes back pink, not gray', () => {
    const shifted = parseColor(shiftUntilReadable(BRAND_PINK, '#ffffff'))!;
    expect(shifted.r).toBeGreaterThan(shifted.g);
    expect(shifted.b).toBeGreaterThan(shifted.g);
  });

  it('honors a custom target', () => {
    expect(contrastRatio(shiftUntilReadable(BRAND_PINK, '#ffffff', 7), '#ffffff')!).toBeGreaterThanOrEqual(7);
  });

  it('passes unparseable colors straight through', () => {
    expect(shiftUntilReadable('var(--accent)', '#ffffff')).toBe('var(--accent)');
    expect(shiftUntilReadable('#ec4899', 'var(--page)')).toBe('#ec4899');
  });
});

describe('deriveAccentTokens', () => {
  it('keeps the brand pink for decoration and deepens only the text-bearing forms', () => {
    const light = deriveAccentTokens(BRAND_PINK, false);
    expect(light.accentGlow).toBe(BRAND_PINK);
    expect(light.accent).toBe('#b33774');
    expect(light.accentInk).toBe('#b33774');
    expect(light.accentFg).toBe(LIGHT_INK);
    // The failures the audit found: pink as an active tab, and white on pink.
    expect(contrastRatio(light.accentInk, '#ffffff')!).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(light.accentFg, light.accent)!).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('lightens the text form in dark mode while the filled form stays put', () => {
    const dark = deriveAccentTokens(BRAND_PINK, true);
    expect(dark.accent).toBe(deriveAccentTokens(BRAND_PINK, false).accent);
    expect(dark.accentInk).toBe('#f38abe');
    expect(contrastRatio(dark.accentInk, '#1e293b')!).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('gives every theme preset a family that clears AA in both themes', () => {
    const presets = ['#ec4899', '#3b82f6', '#6366f1', '#8b5cf6', '#14b8a6', '#10b981', '#f59e0b', '#f43f5e', '#64748b'];
    for (const accent of presets) {
      const light = deriveAccentTokens(accent, false);
      const dark = deriveAccentTokens(accent, true);
      expect(contrastRatio(light.accentFg, light.accent)!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(light.accentInk, LIGHT_GROUND)!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(light.accentInk, '#ffffff')!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(dark.accentInk, DARK_GROUND)!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(dark.accentInk, '#1e293b')!).toBeGreaterThanOrEqual(AA_TEXT);
      // The hover shade is darker than the resting one, never lighter.
      expect(luminance(light.accentHover)!).toBeLessThan(luminance(light.accent)!);
    }
  });

  it('handles a hand-typed accent from the theme editor, however extreme', () => {
    for (const accent of ['#ffffff', '#000000', '#ffff00', '#fde68a']) {
      const light = deriveAccentTokens(accent, false);
      const dark = deriveAccentTokens(accent, true);
      expect(contrastRatio(light.accentFg, light.accent)!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(light.accentInk, LIGHT_GROUND)!).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(dark.accentInk, DARK_GROUND)!).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('tintedChipStyle', () => {
  // A department chip paints itself with its department's colour at 13% alpha
  // and writes the same colour on top. For a green or yellow department that
  // lands around 2:1 — nobody chose it, it falls out of whatever colour someone
  // picked from a colour well.
  const CHIP_TINT = 0x22 / 255;
  const SURFACES = { light: '#ffffff', dark: '#1e293b' };

  /** The ground the browser actually composites: surface seen through the tint. */
  function chipGround(color: string, dark: boolean): string {
    const s = parseColor(SURFACES[dark ? 'dark' : 'light'])!;
    const c = parseColor(color)!;
    return toHex({
      r: s.r + (c.r - s.r) * CHIP_TINT,
      g: s.g + (c.g - s.g) * CHIP_TINT,
      b: s.b + (c.b - s.b) * CHIP_TINT,
    });
  }

  // Every colour the department colour well offers.
  const PALETTE = ['#22c55e', '#eab308', '#3b82f6', '#ec4899', '#ef4444',
                   '#8b5cf6', '#14b8a6', '#f97316', '#6b7280'];

  it('clears AA on every palette colour, in both themes', () => {
    for (const dark of [false, true]) {
      for (const color of PALETTE) {
        const style = tintedChipStyle(color, dark);
        const ratio = contrastRatio(style.color, chipGround(color, dark))!;
        expect(
          ratio,
          `${color} in ${dark ? 'dark' : 'light'} mode read ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('leaves the tint itself alone — only the text moves', () => {
    expect(tintedChipStyle('#22c55e', false).backgroundColor).toBe('#22c55e22');
  });

  it('keeps a colour recognisably itself', () => {
    // A green department must still read green, not a generic dark gray.
    const ink = parseColor(tintedChipStyle('#22c55e', false).color)!;
    expect(ink.g).toBeGreaterThan(ink.r);
    expect(ink.g).toBeGreaterThan(ink.b);
  });

  it('falls back to a readable gray when a department has no colour', () => {
    for (const dark of [false, true]) {
      const style = tintedChipStyle(undefined, dark);
      const ratio = contrastRatio(style.color, chipGround('#6b7280', dark))!;
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('shiftUntilReadable returns what it promises', () => {
  it('measures the rounded hex it hands back, not the float behind it', () => {
    // toHex rounds each channel, which can shave the ratio below the target —
    // #8b5cf6 on a dark chip ground came back at 4.48:1 against a 4.5 target.
    const grounds = ['#ffffff', '#1e293b', '#e2e8f0', '#334155', '#26303f'];
    const colors = ['#8b5cf6', '#22c55e', '#eab308', '#3b82f6', '#ec4899', '#14b8a6'];
    for (const ground of grounds) {
      for (const color of colors) {
        const out = shiftUntilReadable(color, ground);
        const ratio = contrastRatio(out, ground)!;
        expect(ratio, `${color} on ${ground} → ${out} = ${ratio.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
