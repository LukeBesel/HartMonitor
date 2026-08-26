import { describe, it, expect } from 'vitest';
import { AA_TEXT, contrastRatio, parseColor, tintedChipOn, toHex } from '../contrast';
import { fmtMinutes } from '../time';

/**
 * The full-screen surfaces — the department and leaderboard wall boards, the
 * operator portal and the player's takt alarm — keep a fixed dark palette in
 * both themes. That makes every ground on them knowable exactly, so the ink
 * they carry can be pinned here rather than re-measured in a browser each time
 * someone nudges an opacity.
 *
 * Ratios below are against the COMPOSITED ground: a `bg-white/5` panel is not
 * white, it is the board showing through white at 5%, and a `text-white/60`
 * label is not white either. Reading `background-color` alone gives numbers
 * that are wrong by a factor of two on these screens.
 */

/** Lay `color` over `ground` at `alpha`, the way the compositor will. */
function over(color: string, alpha: number, ground: string): string {
  const c = parseColor(color)!;
  const g = parseColor(ground)!;
  return toHex({
    r: g.r + (c.r - g.r) * alpha,
    g: g.g + (c.g - g.g) * alpha,
    b: g.b + (c.b - g.b) * alpha,
  });
}

const ratio = (fg: string, bg: string) => contrastRatio(fg, bg)!;

/** WCAG 1.4.11: icons and other non-text content. */
const AA_NON_TEXT = 3;

// ── The wall boards ──────────────────────────────────────────────────────────

const BOARD = '#020617';                       // bg-slate-950
const PANEL = over('#ffffff', 0.05, BOARD);    // bg-white/5 card
const CHIP = over('#ffffff', 0.10, PANEL);     // bg-white/10 inside one

describe('wall board ink', () => {
  const grounds = { board: BOARD, panel: PANEL, chip: CHIP };

  it('carries secondary text at 4.5:1 on every ground it lands on', () => {
    for (const [name, ground] of Object.entries(grounds)) {
      const ink = over('#ffffff', 0.6, ground);
      expect(ratio(ink, ground), `text-white/60 on the ${name}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('is why the boards no longer use white at 40% or 30%', () => {
    // The values these screens shipped with, on the plainest ground of the
    // three. Kept as an assertion so nobody restores them believing they pass.
    expect(ratio(over('#ffffff', 0.4, BOARD), BOARD)).toBeLessThan(AA_TEXT);
    expect(ratio(over('#ffffff', 0.3, BOARD), BOARD)).toBeLessThan(AA_NON_TEXT);
  });
});

// ── The behind-takt banner ───────────────────────────────────────────────────

const BANNER = '#b91c1c';        // bg-red-700
const BANNER_SLOT = over('#000000', 0.25, BANNER);   // bg-black/25 job chip

describe('behind-takt banner', () => {
  it('holds white and its secondary ink on both the bar and the job chips', () => {
    expect(ratio('#ffffff', BANNER)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio('#ffffff', BANNER_SLOT)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(over('#ffffff', 0.85, BANNER_SLOT), BANNER_SLOT)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('does not pulse, because a fading bar takes its own text down with it', () => {
    // The banner used bg-red-600 under `animate-pulse`, which drops the whole
    // element — bar and lettering together — toward the board behind it. At the
    // dim end of that cycle the job numbers measured under 3:1, so half of
    // every second the most urgent thing on the board was the least readable.
    const dimmedBar = over('#dc2626', 0.5, BOARD);
    const dimmedSecondary = over(over('#ffffff', 0.7, '#dc2626'), 0.5, BOARD);
    expect(ratio(dimmedSecondary, dimmedBar)).toBeLessThan(AA_NON_TEXT);
    // The solid replacement clears AA at every moment, because it has none.
    expect(ratio(over('#ffffff', 0.85, BANNER), BANNER)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

// ── The player's takt alarm ──────────────────────────────────────────────────

const P_SURFACE_1 = '#1b212b';   // --p-surface-1, the player header
const P_BAD = '#f87171';         // --p-bad, the over-takt readout
const P_LIVE = '#e03131';        // --p-live, the alarm wash and ring

describe('over-takt readout', () => {
  it('stays legible at both ends of the alarm flash', () => {
    // .p-takt-over flashes a wash BEHIND the number rather than fading the
    // number itself, so both frames of the cycle are measurable and both pass.
    const washed = over(P_LIVE, 0.22, P_SURFACE_1);
    expect(ratio(P_BAD, P_SURFACE_1)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio(P_BAD, washed)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('is why the readout no longer fades to 45% opacity', () => {
    expect(ratio(over(P_LIVE, 0.45, P_SURFACE_1), P_SURFACE_1)).toBeLessThan(AA_NON_TEXT);
  });
});

// ── The operator's job card ──────────────────────────────────────────────────

/** The lightest surface a job card presents: bg-blue-600/20 over the light end
 *  of the portal's fixed navy gradient. */
const PORTAL_CARD_LIGHTEST = '#324a73';

describe('department chip on a job card', () => {
  it('keeps AA ink for any colour someone picks out of the colour well', () => {
    for (const picked of ['#3b82f6', '#22c55e', '#eab308', '#ec4899', '#6b7280', '#8b5cf6']) {
      const style = tintedChipOn(picked, PORTAL_CARD_LIGHTEST);
      // The chip paints its own tint over the card, and that blend — not the
      // card — is what the label sits on.
      const ground = over(picked, 0x22 / 255, PORTAL_CARD_LIGHTEST);
      expect(ratio(style.color, ground), `${picked} chip`).toBeGreaterThanOrEqual(AA_TEXT);
      // The tint itself is untouched, so a blue department still reads blue.
      expect(style.backgroundColor.toLowerCase()).toBe(`${picked}22`);
    }
  });

  it('is why the chip no longer writes the picked colour on itself', () => {
    const ground = over('#3b82f6', 0x22 / 255, PORTAL_CARD_LIGHTEST);
    expect(ratio('#3b82f6', ground)).toBeLessThan(AA_TEXT);
  });
});

// ── Numbers a person reads ───────────────────────────────────────────────────

describe('fmtMinutes', () => {
  it('never puts a float tail on an operator’s job card', () => {
    expect(fmtMinutes(6.083333333333333)).toBe('6.1');
    expect(fmtMinutes(6)).toBe('6');
    expect(fmtMinutes(0.5)).toBe('0.5');
    expect(fmtMinutes(12.25)).toBe('12.3');
  });
});
