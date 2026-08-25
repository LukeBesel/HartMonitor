import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  resolvePageTitle, resolveScreenName, HOME_TITLE, TITLE_SUFFIX, NOT_FOUND_SCREEN,
} from '../pageTitles';
import { ALL_SECTION_ITEMS } from '../navigation';

const SUFFIX = ` — ${TITLE_SUFFIX}`;

/** App.tsx on disk. Walks up from the working directory so the suite runs the
 *  same from the frontend workspace or the repo root. */
function readAppSource(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const rel of [join('src', 'App.tsx'), join('frontend', 'src', 'App.tsx')]) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not locate frontend/src/App.tsx from ${process.cwd()}`);
}

/** Every `path="..."` declared in App.tsx, read from the source so a route
 *  added without a title fails here rather than in a customer's tab strip. */
function declaredRoutePaths(): string[] {
  const paths = [...readAppSource().matchAll(/path="([^"]+)"/g)].map(m => m[1]);
  return [...new Set(paths)].filter(p => p !== '*');
}

/** `/apps/:id/build` → `/apps/sample/build`, so a pattern can be resolved. */
function concrete(pattern: string): string {
  return pattern.replace(/:[^/]+/g, 'sample');
}

describe('resolvePageTitle', () => {
  it('gives the marketing home page the product brand line', () => {
    expect(resolvePageTitle('/')).toBe(HOME_TITLE);
  });

  it('resolves every route declared in App.tsx', () => {
    const unresolved = declaredRoutePaths()
      .filter(p => p !== '/')
      .filter(p => resolveScreenName(concrete(p)) === NOT_FOUND_SCREEN);
    expect(unresolved).toEqual([]);
  });

  it('suffixes every route except the home page', () => {
    const unsuffixed = declaredRoutePaths()
      .filter(p => p !== '/')
      .filter(p => !resolvePageTitle(concrete(p)).endsWith(SUFFIX));
    expect(unsuffixed).toEqual([]);
  });

  it('names each screen the way the sidebar names it', () => {
    const mismatched = ALL_SECTION_ITEMS
      .filter(item => !resolveScreenName(item.to).includes(item.label))
      .map(item => `${item.to} → "${resolveScreenName(item.to)}" (nav says "${item.label}")`);
    expect(mismatched).toEqual([]);
  });

  it('gives every navigable screen a distinct title', () => {
    // Parallel tabs are the whole point: two screens sharing a tab label is the
    // bug this table exists to prevent.
    const routes = [...new Set([
      '/', '/pricing', '/terms', '/privacy', '/login', '/settings',
      ...ALL_SECTION_ITEMS.map(i => i.to),
    ])];
    const titles = routes.map(resolvePageTitle);
    const duplicates = titles.filter((t, i) => titles.indexOf(t) !== i);
    expect(duplicates).toEqual([]);
  });

  it('no longer leaves the whole product on one generic title', () => {
    const shellRoutes = ['/dashboard', '/schedule', '/quality', '/maintenance', '/analytics'];
    for (const route of shellRoutes) {
      expect(resolvePageTitle(route)).not.toBe(HOME_TITLE);
    }
  });

  it('carries the suffix on the two screens that used to drop it', () => {
    expect(resolvePageTitle('/requirements')).toBe(`Materials Required${SUFFIX}`);
    expect(resolvePageTitle('/shipments')).toBe(`Shipments${SUFFIX}`);
  });

  it('names the workspace on each of the six Reports screens', () => {
    expect(resolvePageTitle('/reports/production')).toBe(`Production Reports${SUFFIX}`);
    expect(resolvePageTitle('/reports/quality')).toBe(`Quality Reports${SUFFIX}`);
    expect(resolvePageTitle('/reports/maintenance/edit')).toBe(`Maintenance Reports${SUFFIX}`);
  });

  it('resolves parameterised routes without leaking the parameter', () => {
    expect(resolvePageTitle('/apps/42/build')).toBe(`App Builder${SUFFIX}`);
    expect(resolvePageTitle('/apps/42')).toBe(`App Details${SUFFIX}`);
    expect(resolvePageTitle('/inventory/kitting/7')).toBe(`Kitting${SUFFIX}`);
    expect(resolvePageTitle('/departments/9/tv')).toBe(`Department TV${SUFFIX}`);
  });

  it('says so for a URL that matches nothing', () => {
    expect(resolvePageTitle('/nonexistent-page-xyz')).toBe(`${NOT_FOUND_SCREEN}${SUFFIX}`);
  });
});
