import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contrastRatio, deriveAccentTokens } from '../contrast';

// ─── The accent must survive being written twice ─────────────────────────────
// index.html paints the stored accent before React exists, so the derivation
// runs against it — and then ThemeContext writes the SAME raw value again on
// mount. The guard used to compare only the raw input, so that second write
// looked like "nothing changed" and returned early, leaving the RAW colour on
// <html> for the rest of the session. Measured in a browser: a tenant on
// forest green got 2.54:1 on every primary button, on amber 2.15:1, and on a
// hand-typed yellow 1.19:1 — while Settings' own preview showed 5.6:1.
//
// This reproduces that exact ordering, which is the only thing that triggers it.

async function freshInstall() {
  // Module state (lastRaw / lastSolid / lastDark) has to start clean, or a
  // second test in this file inherits the first one's memory — the same
  // "remembered too much" shape as the bug being reproduced.
  vi.resetModules();
  const mod = await import('../accentTokens');
  return mod.installAccentTokens;
}

const RAW = '#10b981';       // forest green, as a picker returns it
const root = () => document.documentElement;

describe('accent derivation survives the boot script', () => {
  beforeEach(() => {
    root().removeAttribute('style');
    root().classList.remove('dark');
  });

  it('re-derives when the raw accent is written again after the first pass', async () => {
    const install = await freshInstall();

    // 1. index.html's boot script paints the stored accent.
    root().style.setProperty('--accent', RAW);

    // 2. main.tsx installs the deriver, which reads what the boot script wrote.
    install();
    const afterInstall = root().style.getPropertyValue('--accent').trim();
    expect(afterInstall).toBe(deriveAccentTokens(RAW, false).accent);

    // 3. ThemeContext mounts and writes the same RAW value over the top. The
    //    MutationObserver is async, so drive sync the way the observer would.
    root().style.setProperty('--accent', RAW);
    await new Promise(r => setTimeout(r, 0));

    const final = root().style.getPropertyValue('--accent').trim();
    expect(final, 'the raw colour must not be left on <html>').not.toBe(RAW);
    expect(final).toBe(deriveAccentTokens(RAW, false).accent);
  });

  it('leaves the button legible for every colour a picker can return', async () => {
    // The three the audit measured failing, plus the shipped default.
    for (const raw of ['#10b981', '#f59e0b', '#ffef00', '#ec4899']) {
      const t = deriveAccentTokens(raw, false);
      const r = contrastRatio(t.accentFg, t.accent)!;
      expect(r, `${raw} → ${t.accentFg} on ${t.accent} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
