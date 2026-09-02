import { describe, it, expect } from 'vitest';
import { SECTIONS, findSectionForPath, filterNavByModules } from '../navigation';

describe('findSectionForPath (route → workspace derivation)', () => {
  it('maps top-level screens to their owning workspace', () => {
    expect(findSectionForPath('/dashboard')?.id).toBe('production');
    expect(findSectionForPath('/schedule')?.id).toBe('planning');
    expect(findSectionForPath('/inventory')?.id).toBe('inventory');
    expect(findSectionForPath('/quality')?.id).toBe('quality_ops');
    expect(findSectionForPath('/capa')?.id).toBe('quality_ops');
    expect(findSectionForPath('/kaizen')?.id).toBe('kaizen');
    expect(findSectionForPath('/maintenance')?.id).toBe('maintenance_ops');
    expect(findSectionForPath('/training')?.id).toBe('people');
    expect(findSectionForPath('/analytics')?.id).toBe('reporting');
  });

  it('keeps a department page inside Production without a menu item for it', () => {
    // A department's page is opened from a card on the Command Center, not from
    // the sidebar. The workspace still has to light up while somebody reads it,
    // or clicking through from the Command Center looks like leaving the app.
    expect(SECTIONS.flatMap(s => s.items).some(i => i.to === '/departments')).toBe(false);
    expect(findSectionForPath('/departments/dept-1')?.id).toBe('production');
    expect(findSectionForPath('/departments/dept-1/tv')?.id).toBe('production');
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

  it('keeps Inventory lit on every URL the retired Materials items handed out', () => {
    // Seven menu items became seven tabs on one screen. The URLs they handed
    // out still render it — three of them from paths outside /inventory — and
    // the workspace has to stay lit while somebody is reading one, or a printed
    // purchase order's link looks like it left the app.
    for (const url of [
      '/inventory', '/inventory/boms', '/inventory/kitting',
      '/inventory/kitting/kit-42', '/inventory/item-7',
      '/purchasing', '/purchasing/vendors', '/shipments', '/requirements',
    ]) {
      expect(findSectionForPath(url)?.id, `${url} lost its workspace`).toBe('inventory');
    }
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

describe('one screen per app, one screen to compare apps', () => {
  it('names the cross-app screen App comparison and gives OEE no item of its own', () => {
    const reporting = SECTIONS.find(s => s.id === 'reporting')!;
    const analytics = reporting.items.find(i => i.to === '/analytics');
    expect(analytics?.label).toBe('App comparison');
    expect(reporting.items.some(i => i.to === '/oee')).toBe(false);
  });
});

describe('one live-floor screen', () => {
  // Four screens used to answer "what is the floor doing right now" and they
  // disagreed at the same minute. The menu is where that started: Production
  // offered the Command Center AND a Departments list, and Planning hid a third
  // floor screen under "Manager View". There is one now, and the department
  // pages are reached from it.
  it('gives Production exactly one live-floor entry', () => {
    const production = SECTIONS.find(s => s.id === 'production')!;
    const floorItems = production.items.filter(i => ['/dashboard', '/departments', '/manager', '/plant', '/sqdc'].includes(i.to));
    expect(floorItems.map(i => i.to)).toEqual(['/dashboard']);
    expect(floorItems[0].label).toBe('Command Center');
  });

  it('offers no menu item for a screen that is now a redirect', () => {
    const paths = SECTIONS.flatMap(s => s.items.map(i => i.to));
    for (const gone of ['/departments', '/manager', '/transaction-log', '/leaderboard/tv', '/sqdc', '/plant', '/step-metrics',
      // Three per-app screens became tabs on /apps/:id, and /oee became a tab
      // on App comparison. None of them is a menu item any more.
      '/apps/dashboard', '/apps/:id/history', '/apps/:id/analytics', '/oee']) {
      expect(paths, `nav still points at ${gone}`).not.toContain(gone);
    }
    const labels = SECTIONS.flatMap(s => s.items.map(i => i.label));
    for (const gone of ['Departments', 'Manager View', 'Transaction Log', 'OEE Tracker', 'Operation Analytics']) {
      expect(labels, `nav still lists "${gone}"`).not.toContain(gone);
    }
  });

  it('keeps the one production log, under its one name', () => {
    const paths = SECTIONS.flatMap(s => s.items.map(i => i.to));
    expect(paths.filter(p => p === '/audit-log')).toHaveLength(1);
  });
});

describe('SECTIONS shape', () => {
  it('opens with Production then Apps, and five primary workspaces', () => {
    // Production is where a manager starts the day; Apps is what produces
    // everything Production reports on. The remaining four sit under "More".
    expect(SECTIONS.map(s => s.id).slice(0, 5))
      .toEqual(['production', 'apps', 'quality_ops', 'maintenance_ops', 'people']);
    expect(SECTIONS.filter(s => !s.secondary)).toHaveLength(5);
    expect(SECTIONS.filter(s => s.secondary).map(s => s.id))
      .toEqual(['planning', 'inventory', 'kaizen', 'reporting']);
  });

  it('gives Apps one entrance to app data, plus the operator portal', () => {
    // The app card in the library is the only way into a single app's runs —
    // the "Dashboard" item was a second front door to the same numbers under a
    // second set of labels.
    const apps = SECTIONS.find(s => s.id === 'apps')!;
    expect(apps.items.map(i => i.to)).toEqual(['/apps', '/operator']);
    // The App Library must not also live in another workspace, or the tab bar
    // would light up two places for the same screen.
    expect(SECTIONS.flatMap(s => s.items).filter(i => i.to === '/apps')).toHaveLength(1);
    // Tables moved out of the Apps row and in beside Dashboards; it must still
    // be reachable exactly once, since the builder's lookup widget needs it.
    expect(SECTIONS.flatMap(s => s.items).filter(i => i.to === '/tables')).toHaveLength(1);
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
    // Maintenance keeps exactly one entry.
    expect(allPaths.filter(p => p.startsWith('/maintenance'))).toEqual(['/maintenance']);
    // Purchasing has no entry of its own at all any more: it is a tab on the
    // one Materials screen, reached from /inventory.
    expect(allPaths.filter(p => p.startsWith('/purchasing'))).toEqual([]);
  });
});

describe('one Materials screen', () => {
  // Eight items under Inventory — Inventory Tracker, BOMs, Kitting, Receiving,
  // Materials Required, Shipments, Purchasing, Reports — led to seven page
  // files for one small shop's materials. Two items now: the screen, and its
  // reports.
  const inventory = () => SECTIONS.find(s => s.id === 'inventory')!;

  it('leaves exactly two items: Materials and Reports', () => {
    expect(inventory().items.map(i => i.label)).toEqual(['Materials', 'Reports']);
    expect(inventory().items.map(i => i.to)).toEqual(['/inventory', '/reports/inventory']);
  });

  it('names none of the seven items it replaced', () => {
    const labels = SECTIONS.flatMap(s => s.items.map(i => i.label));
    for (const gone of [
      'Inventory Tracker', 'BOMs', 'Kitting', 'Receiving',
      'Materials Required', 'Shipments', 'Purchasing',
    ]) {
      expect(labels, `nav still lists "${gone}"`).not.toContain(gone);
    }
    const paths = SECTIONS.flatMap(s => s.items.map(i => i.to));
    for (const gone of [
      '/inventory/boms', '/inventory/kitting', '/receiving',
      '/requirements', '/shipments', '/purchasing',
    ]) {
      expect(paths, `nav still points at ${gone}`).not.toContain(gone);
    }
  });

  it('keeps the plan gate at the menu and moves the role gate into the screen', () => {
    // The seven items it replaces did not agree: four were open to every role,
    // three asked for a supervisor. Merging them could only have thrown one of
    // those away. So the item keeps the `proOnly` the stock tracker always had
    // and carries NO `minRole` — a role gate here would take the four open tabs
    // off the roles that could always reach them — and the three that asked for
    // a supervisor still ask, one level down, in MATERIALS_SUPERVISOR_TABS.
    const materials = inventory().items[0];
    expect(materials.proOnly).toBe(true);
    expect(materials.minRole).toBeUndefined();
    expect(materials.module).toBe('inventory');
    // Not `exact`: the item stays lit on /inventory/boms and on the kit URL a
    // traveller's barcode prints.
    expect(materials.exact).toBeUndefined();
  });

  it('owns the three addresses that do not sit under /inventory', () => {
    // /purchasing, /shipments and /requirements still render this screen, so
    // the item that replaced their menu entries has to own them too — a side
    // table of aliases is a second place to forget.
    const materials = inventory().items[0];
    expect(materials.altPaths).toEqual(['/purchasing', '/shipments', '/requirements']);
    for (const url of ['/purchasing/vendors', '/shipments', '/requirements']) {
      expect(findSectionForPath(url)?.id, url).toBe('inventory');
    }
  });

  it('still hides the whole workspace when the module is off', () => {
    const off = filterNavByModules(SECTIONS, key => key !== 'inventory');
    expect(off.some(s => s.id === 'inventory')).toBe(false);
    expect(findSectionForPath('/purchasing', off)).toBeNull();
  });
});
