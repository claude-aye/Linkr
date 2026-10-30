'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { isCurrentPage, isInSection, isMenuOpen } from '@/lib/nav/nav-active';

import { LogoutButton } from './logout-button';

export interface NavLink {
  href: string;
  label: string;
}

/**
 * Îlot client de la barre de navigation (R3) : chemin courant et panneau mobile.
 *
 * - Actif : `aria-current="page"` sur égalité stricte du chemin, style actif
 *   (texte plein + pastille neutre) sur la page ET ses sous-routes. Règles dans
 *   `lib/nav/nav-active.ts`, avec leur pourquoi.
 * - Sous `md` : la rangée du haut porte la marque et le bouton « Menu ». Le
 *   panneau s'ouvre DANS LE FLUX : il pousse le contenu, sans superposition, sans
 *   verrou de défilement et sans piège de focus. Ce n'est pas une modale.
 * - Échap ferme le panneau ouvert et rend le focus au bouton.
 * - Une navigation ferme le panneau : l'état retient le CHEMIN d'ouverture, pas
 *   un booléen (`isMenuOpen`). Aucun effet ne réagit au chemin.
 *
 * ⚠️ `h-[var(--shell-header-h)]` est sur la RANGÉE DU HAUT, jamais sur le
 * `<header>` : le panneau ouvert serait rogné.
 */
export function NavMenu({ brand, links }: { brand: ReactNode; links: NavLink[] }) {
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = isMenuOpen(openedOn, pathname);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenedOn(null);
      buttonRef.current?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  function linkClass(href: string, fullWidth: boolean): string {
    const base =
      'flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
    const state = isInSection(pathname, href)
      ? 'bg-text/[0.08] text-text'
      : 'text-text-muted hover:bg-text/[0.05] hover:text-text';
    return `${base} ${state}${fullWidth ? ' w-full' : ''}`;
  }

  function renderLinks(fullWidth: boolean) {
    return links.map((link) => (
      <li key={link.href}>
        <Link
          href={link.href}
          aria-current={isCurrentPage(pathname, link.href) ? 'page' : undefined}
          className={linkClass(link.href, fullWidth)}
        >
          {link.label}
        </Link>
      </li>
    ));
  }

  return (
    <nav aria-label="Navigation principale" className="w-full px-4 sm:px-6">
      <div className="flex h-[var(--shell-header-h)] items-center gap-6">
        {brand}

        <ul className="hidden items-center gap-1 md:flex">{renderLinks(false)}</ul>

        <div className="ml-auto hidden md:block">
          <LogoutButton />
        </div>

        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setOpenedOn(open ? null : pathname)}
          className="-mr-2 ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-lg text-text transition-colors hover:bg-text/[0.05] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none md:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
          >
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      <div id={panelId} hidden={!open} className="border-t border-edge pt-2 pb-4 md:hidden">
        <ul className="-mx-3 flex flex-col gap-1">{renderLinks(true)}</ul>
        <div className="mt-3">
          <LogoutButton />
        </div>
      </div>
    </nav>
  );
}
