import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { resolvePageTitle } from '../../config/pageTitles';

/**
 * Keeps `document.title` in step with the route. Mounted once inside the
 * router; renders nothing.
 *
 * This is the only place that writes `document.title` — a page that sets its
 * own would win or lose the race depending on whether its chunk had already
 * loaded, which is exactly the kind of intermittent difference nobody enjoys
 * chasing. New screens get a tab label by adding a line to `pageTitles.ts`.
 */
export default function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = resolvePageTitle(pathname);
  }, [pathname]);

  return null;
}
