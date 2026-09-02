import { describe, it, expect } from 'vitest';
import { displayId, hasCompanyTag } from '../ids';

describe('displayId', () => {
  it('strips the six-hex-digit company tag a sandbox mints ids with', () => {
    expect(displayId('6BDD57-WO-1001')).toBe('WO-1001');
    expect(displayId('6BDD57-NCR-101')).toBe('NCR-101');
    expect(displayId('6BDD57-MWO-100')).toBe('MWO-100');
    expect(displayId('6BDD57-PO-2001')).toBe('PO-2001');
    expect(displayId('6BDD57-CAPA-001')).toBe('CAPA-001');
    expect(displayId('6BDD57-SN-0042')).toBe('SN-0042');
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

  it('leaves a part number that IS six hex digits and a dash alone', () => {
    // The whole reason the tag is recognised by the id family behind it: this
    // shape is a real part number, and trimming it printed "01" in the cell.
    expect(displayId('100234-01')).toBe('100234-01');
    expect(displayId('A1B2C3-500')).toBe('A1B2C3-500');
    // A tagged item SKU is not one of the id families either — a customer's
    // own SKU is never rewritten on the way to the screen.
    expect(displayId('6BDD57-M6KIT-BAG')).toBe('6BDD57-M6KIT-BAG');
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
    expect(hasCompanyTag('100234-01')).toBe(false);
    expect(hasCompanyTag(null)).toBe(false);
  });
});
