import Link from 'next/link';

import { NavMenu, type NavLink } from './nav-menu';

/**
 * Barre de navigation du shell `(app)` — Server Component, direction A (R3).
 *
 * Portée A (verrouillée) : les liens CLIENT sont toujours affichés, le lien
 * PRESTATAIRE seulement si la session résout un profil prestataire. Il n'y a PAS
 * de lien « Admin » : le rôle admin n'est jamais exposé au front
 * (`lib/nav/capabilities.ts`), `/admin/*` reste atteignable par l'URL et gardé
 * côté API. Pas de pastille de notification non plus (CLAUDE.md §13.1 nº 3).
 *
 * Ce composant ne lit rien : `isProvider` vient de `(app)/layout.tsx`, qui lit
 * `getShellCapabilities()` une seule fois par requête. Il construit la liste des
 * liens et la marque, puis délègue l'affichage à l'îlot client `NavMenu`, seul à
 * connaître le chemin courant (`usePathname`) et l'état du panneau mobile.
 *
 * COMPORTEMENT RÉEL (R3) :
 * - à partir de `md` (768 px) : une seule rangée, marque, liens, Déconnexion ;
 * - sous `md`, tous rôles : la rangée du haut porte la marque et un bouton
 *   « Menu ». Le panneau s'ouvre DANS LE FLUX, sous cette rangée, et pousse le
 *   contenu. Il remplace les deux et trois rangées de liens empilés de G-1/5.1 :
 *   la hauteur du header ne dépend plus du rôle, du nombre de liens ni de leurs
 *   libellés.
 *
 * ⚠️ `--shell-header-h` (`globals.css`) est la hauteur de la RANGÉE DU HAUT, et
 * c'est aussi la hauteur du header fermé : la bordure basse est une ombre
 * intérieure, qui ne prend aucune place. `/recherche` s'en sert pour remplir
 * exactement l'écran sous le header. Ne pas la remplacer par un `border-b` (un
 * pixel de défilement parasite), ni appliquer la hauteur au `<header>` entier
 * (le panneau ouvert serait rogné).
 *
 * Les libellés restent les plus courts honnêtes (« Mes cartes », « Espace pro »,
 * §13.1 nº 19g) : avec le menu, ils ne décident plus du nombre de rangées, mais
 * ils décident encore de la place à partir de `md`.
 */
export function Nav({ isProvider }: { isProvider: boolean }) {
  const links: NavLink[] = [
    { href: '/recherche', label: 'Trouver un pro' },
    { href: '/requests', label: 'Mes demandes' },
    // 5.1 — toujours affiché : n'importe quel compte peut détenir une carte,
    // prestataire compris (§13.1 nº 19a et 19g).
    { href: '/account/payment-methods', label: 'Mes cartes' },
    ...(isProvider ? [{ href: '/dashboard', label: 'Espace pro' }] : []),
  ];

  return (
    <header className="bg-surface shadow-[inset_0_-1px_0_var(--color-edge)]">
      <NavMenu
        links={links}
        brand={
          <Link
            href="/"
            className="-ml-2 flex min-h-11 items-center rounded-lg px-2 text-base font-semibold tracking-tight text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Linkr
          </Link>
        }
      />
    </header>
  );
}
