'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { resultElementId } from '@/lib/map/map-data';

/**
 * List ↔ map synchronisation for the results state of `/recherche` (R2b).
 *
 * The result cards stay Server Components and keep their own link: this file
 * only WRAPS each card in an `<li>` that reports hover/focus and receives the
 * « active » highlight. Nothing here builds, rewrites or intercepts an `href` —
 * the link to `/providers/{id}?lat=&lng=` is the card's, byte for byte.
 *
 * `source` says who changed the active result. Only a change coming FROM THE MAP
 * scrolls the list: a card the user is already hovering must not jump.
 */

type ActiveSource = 'list' | 'map';

interface ResultsSyncValue {
  activeId: string | null;
  source: ActiveSource | null;
  setActive: (id: string | null, source: ActiveSource) => void;
}

const ResultsSyncContext = createContext<ResultsSyncValue | null>(null);

export function ResultsSyncProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ activeId: string | null; source: ActiveSource | null }>({
    activeId: null,
    source: null,
  });
  const value = useMemo<ResultsSyncValue>(
    () => ({
      activeId: state.activeId,
      source: state.source,
      setActive: (activeId, source) => setState({ activeId, source }),
    }),
    [state],
  );
  return <ResultsSyncContext.Provider value={value}>{children}</ResultsSyncContext.Provider>;
}

export function useResultsSync(): ResultsSyncValue | null {
  return useContext(ResultsSyncContext);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * One list item around a result card. Hover or keyboard focus inside it marks
 * the provider active (the map highlights its pin); a pin click marks it active
 * from the map, and the item scrolls itself into view (`block: 'nearest'`).
 */
export function SyncedResult({ id, children }: { id: string; children: React.ReactNode }) {
  const sync = useResultsSync();
  const ref = useRef<HTMLLIElement>(null);
  const isActive = sync?.activeId === id;
  const fromMap = isActive && sync?.source === 'map';

  useEffect(() => {
    if (!fromMap) return;
    ref.current?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [fromMap]);

  return (
    <li
      ref={ref}
      id={resultElementId(id)}
      data-active={isActive ? 'true' : undefined}
      onMouseEnter={() => sync?.setActive(id, 'list')}
      onMouseLeave={() => {
        if (sync?.activeId === id && sync.source === 'list') sync.setActive(null, 'list');
      }}
      onFocus={() => sync?.setActive(id, 'list')}
      // The highlight sits on the list item, around the card's own link, so the
      // card keeps its classes and its focus ring untouched.
      className="scroll-mt-4 rounded-2xl transition motion-reduce:transition-none data-active:ring-2 data-active:ring-accent data-active:ring-offset-2 data-active:ring-offset-bg"
    >
      {children}
    </li>
  );
}
