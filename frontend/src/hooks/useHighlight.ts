import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Lets a list/table highlight + scroll to a specific row when the user arrives
 * via a link like `/schedule?highlight=<id>` (e.g. from Needs Attention or a
 * notification). The query param is stripped from the URL after being read so
 * refreshing the page doesn't keep re-triggering the highlight.
 */
export function useHighlight(paramName = 'highlight') {
  const [searchParams, setSearchParams] = useSearchParams();
  const targetIdRef = useRef(searchParams.get(paramName));
  const [activeId, setActiveId] = useState<string | null>(targetIdRef.current);
  const scrolledRef = useRef(false);

  useEffect(() => {
    if (!targetIdRef.current) return;
    const next = new URLSearchParams(searchParams);
    next.delete(paramName);
    setSearchParams(next, { replace: true });
    const timer = setTimeout(() => setActiveId(null), 2200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const highlightRef = (id: string) => (el: HTMLElement | null) => {
    if (el && id === targetIdRef.current && !scrolledRef.current) {
      scrolledRef.current = true;
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  };

  return {
    highlightId: targetIdRef.current,
    isHighlighted: (id: string) => activeId !== null && activeId === id,
    highlightRef,
  };
}
