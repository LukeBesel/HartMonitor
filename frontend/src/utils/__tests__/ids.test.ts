import { describe, it, expect } from 'vitest';
import { displayId, hasCompanyTag } from '../ids';

describe('displayId', () => {
  it('strips the six-hex-digit company tag a sandbox mints ids with', () => {
    expect(displayId('6BDD57-WO-1001')).toBe('WO-1001');
    expect(displayId('6BDD57-NCR-101')).toBe('NCR-101');
    expect(displayId('6BDD57-MWO-100')).toBe('MWO-100');
    expect(displayId('6BDD57-M6KIT-BAG')).toBe('M6KIT-BAG');
  });

  it('leaves an untagged id exactly as it is', () => {
    // The ids a real company mints through the numbering helpers carry no tag.
    expect(displayId('WO-2026-004')).toBe('WO-2026-004');
    expect(displayId('CAPA-2026-001')).toBe('CAPA-2026-001');
  });

  it('does not eat a part number that merely looks like a prefix', () => {
    // Not six characters, or not hex — a real part number, left alone.
    expect(displayId('AB12-BRACKET')).toBe('AB12-BRACKET');
    expect(displayId('ASSY-100')).toBe('ASSY-100');
    expect(displayId('6BDD57G-WO-1')).toBe('6BDD57G-WO-1');
    expect(displayId('abcdef-WO-1')).toBe('abcdef-WO-1');
  });

  it('never strips the id down to nothing', () => {
    expect(displayId('6BDD57-')).toBe('6BDD57-');
  });

  it('is safe on a missing id', () => {
    expect(displayId(null)).toBe('');
    expect(displayId(undefined)).toBe('');
    expect(displayId('')).toBe('');
  });

  it('reports whether the full id says anything the short one does not', () => {
    expect(hasCompanyTag('6BDD57-WO-1001')).toBe(true);
    expect(hasCompanyTag('WO-2026-004')).toBe(false);
    expect(hasCompanyTag(null)).toBe(false);
  });
});
