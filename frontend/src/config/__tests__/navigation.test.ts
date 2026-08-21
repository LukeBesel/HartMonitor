import { describe, it, expect } from 'vitest';
import { SECTIONS, findSectionForPath, filterNavByModules } from '../navigation';

describe('findSectionForPath (route → workspace derivation)', () => {
  it('maps top-level screens to their owning workspace', () => {
    expect(findSectionForPath('/dashboard')?.id).toBe('production');
    expect(findSectionForPath('/schedule')?.id).toBe('production');
    expect(findSectionForPath('/inventory')?.id).toBe('inventory');
    expect(findSectionForPath('/quality')?.id).toBe('quality_ops');
    expect(findSectionForPath('/capa')?.id).toBe('quality_ops');
    expect(findSectionForPath('/kaizen')?.id).toBe('kaizen');
    expect(findSectionForPath('/maintenance')?.id).toBe('maintenance_ops');
    expect(findSectionForPath('/training')?.id).toBe('people');
    expect(findSectionForPath('/analytics')?.id).toBe('reporting');
  });

  it('maps deep links (sub-routes) to the owning workspace', () => {
    expect(findSectionForPath('/quality/ncr-123')?.id).toBe('quality_ops');
    expect(findSectionForPath('/apps/abc/build')?.id).toBe('apps');
    expect(findSectionForPath('/apps/abc')?.id).toBe('apps');
    expect(findSectionForPath('/departments/dept-1')?.id).toBe('production');
    expect(findSectionForPath('/maintenance/assets')?.id).toBe('maintenance_ops');
    expect(findSectionForPath('/dashboards/d1/edit')?.id).toBe('reporting');
  });

  it('prefers the longest matching item path', () => {
    // /inventory/kitting/:kitId should resolve via the Kitting item, not the
    // shorter Inventory Tracker item — same workspace, but the match must be
    // the deepest item.
    expect(findSectionForPath('/inventory/kitting/kit-42')?.id).toBe('inventory');
    expect(findSectionForPath('/inventory/boms')?.id).toBe('inventory');
  });

  it('resolves legacy multi-entry deep links through the collapsed nav item', () => {
    // /training/certs and /training/plans no longer have their own nav items —
    // they resolve to People via the single /training entry.
    expect(findSectionForPath('/training/certs')?.id).toBe('people');
    expect(findSectionForPath('/training/plans')?.id).toBe('people');
    expect(findSectionForPath('/purchasing/orders')?.id).toBe('inventory');
  });

  it('maps the fixed Reports routes to their workspaces', () => {
    expect(findSectionForPath('/reports/production')?.id).toBe('production');
    expect(findSectionForPath('/reports/inventory')?.id).toBe('inventory');
    expect(findSectionForPath('/reports/quality')?.id).toBe('quality_ops');
    expect(findSectionForPath('/reports/kaizen')?.id).toBe('kaizen');
    expect(findSectionForPath('/reports/maintenance')?.id).toBe('maintenance_ops');
    expect(findSectionForPath('/reports/people')?.id).toBe('people');
  });

  it('returns null for routes outside every workspace', () => {
    expect(findSectionForPath('/settings')).toBeNull();
    expect(findSectionForPath('/stations')).toBeNull();
    expect(findSectionForPath('/completions/c-1')).toBeNull();
    expect(findSectionForPath('/')).toBeNull();
  });

  it('does not treat shared path prefixes as sub-routes', () => {
    // '/inventory-extra' is not under '/inventory'
    expect(findSectionForPath('/inventory-extra')).toBeNull();
    expect(findSectionForPath('/trainingcamp')).toBeNull();
  });

  it('respects a module-filtered section list', () => {
    const withoutInventory = filterNavByModules(SECTIONS, key => key !== 'inventory');
    expect(findSectionForPath('/inventory', withoutInventory)).toBeNull();
    expect(findSectionForPath('/dashboard', withoutInventory)?.id).toBe('production');
  });
});

describe('SECTIONS shape', () => {
  it('puts Apps first — it is the product\'s front door', () => {
    expect(SECTIONS[0].id).toBe('apps');
    expect(SECTIONS[0].items.map(i => i.to)).toEqual(['/apps', '/tables', '/operator']);
    // The App Library must not also live in another workspace, or the tab bar
    // would light up two places for the same screen.
    const appsEntries = SECTIONS.flatMap(s => s.items).filter(i => i.to === '/apps');
    expect(appsEntries).toHaveLength(1);
  });

  it('has a Reports item LAST in each workspace with its fixed path', () => {
    const expected: Record<string, string> = {
      production: '/reports/production',
      inventory: '/reports/inventory',
      quality_ops: '/reports/quality',
      kaizen: '/reports/kaizen',
      maintenance_ops: '/reports/maintenance',
      people: '/reports/people',
    };
    for (const [sectionId, path] of Object.entries(expected)) {
      const section = SECTIONS.find(s => s.id === sectionId);
      expect(section, `section ${sectionId}`).toBeDefined();
      const last = section!.items[section!.items.length - 1];
      expect(last.label).toBe('Reports');
      expect(last.to).toBe(path);
    }
  });

  it('keeps multi-tab pages collapsed to a single nav item each', () => {
    const allPaths = SECTIONS.flatMap(s => s.items.map(i => i.to));
    // Training's certs/plans entries are gone — internal tabs are the sub-nav.
    expect(allPaths).toContain('/training');
    expect(allPaths).not.toContain('/training/certs');
    expect(allPaths).not.toContain('/training/plans');
    // Maintenance and Purchasing keep exactly one entry each.
    expect(allPaths.filter(p => p.startsWith('/maintenance'))).toEqual(['/maintenance']);
    expect(allPaths.filter(p => p.startsWith('/purchasing'))).toEqual(['/purchasing']);
  });
});
