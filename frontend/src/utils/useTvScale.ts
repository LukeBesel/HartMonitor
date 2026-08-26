import { useEffect, useState } from 'react';

/**
 * Mounts a route as a wall board and reports the type scale currently in force.
 *
 * `data-tv` on `<html>` is what tv.css keys the board's root font size off, the
 * same way the operator player uses `data-player`. It is an attribute on the
 * document rather than a class on the page because the root font size is what
 * every rem on the board resolves against, and only `<html>` carries that.
 *
 * The returned number is that root font size in pixels. Almost nothing needs
 * it — rem does the work — but a few things cannot be expressed in rem at all
 * (a Recharts tick takes a number, an SVG icon in a chart takes a number), and
 * those have to be derived from the same value the CSS is applying or the chart
 * ends up as phone-sized labels on a 4K board. Reading it back from the
 * document rather than recomputing the clamp keeps the two in step by
 * construction.
 */
export function useTvScale(): number {
  const [rootPx, setRootPx] = useState(16);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-tv', '1');

    const read = () => {
      const px = parseFloat(getComputedStyle(root).fontSize);
      if (Number.isFinite(px) && px > 0) setRootPx(px);
    };
    read();
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
      root.removeAttribute('data-tv');
    };
  }, []);

  return rootPx;
}

export default useTvScale;
