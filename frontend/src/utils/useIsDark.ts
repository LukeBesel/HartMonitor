import { useEffect, useState } from 'react';

/**
 * Whether the dark theme is currently applied.
 *
 * Reads the `.dark` class on `<html>` rather than the theme context, because
 * that class IS the source of truth — it is what every stylesheet keys off, it
 * is set by the boot script before React exists, and `useTheme()` throws
 * outside a ThemeProvider, which would make any component using it impossible
 * to render on its own (a test rendering one page shouldn't have to know that
 * a chip somewhere inside it wanted to know the theme).
 *
 * Subscribed rather than read once, so a colour derived from the theme
 * re-derives when someone toggles it instead of waiting for the next render.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    // MutationObserver is absent in some non-browser runtimes; the value read
    // above is still correct there, it just won't follow a later toggle.
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

export default useIsDark;
