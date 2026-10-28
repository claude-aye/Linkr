/**
 * Règles pures de la barre de navigation du shell `(app)` (R3).
 *
 * ⚠️ AUCUN IMPORT, par contrat : `node --test` charge ce fichier tel quel (le job
 * `web-tests` n'installe rien). L'îlot `nav-menu.tsx` les applique ; les tests
 * `nav-active.test.mjs` les tiennent.
 *
 * DEUX RÈGLES D'ACTIF, ET ELLES DIFFÈRENT EXPRÈS :
 * - `aria-current="page"` dit « vous êtes SUR cette page » : égalité stricte du
 *   chemin. Sur `/requests/abc/devis`, le lien « Mes demandes » n'est pas la page
 *   courante, et l'annoncer comme telle mentirait au lecteur d'écran.
 * - le style actif dit « vous êtes DANS cette section » : égalité, ou chemin qui
 *   commence par `href + '/'`. Le `'/'` ajouté évite qu'un `/requestsx` allume
 *   `/requests`.
 *
 * La marque (`/`) n'entre JAMAIS dans ces règles : tout chemin commence par `/`,
 * donc elle serait active partout. Elle n'est pas dans la liste des liens.
 */

/** La page affichée est exactement celle du lien (`aria-current="page"`). */
export function isCurrentPage(pathname: string | null, href: string): boolean {
  return pathname === href;
}

/** La page affichée est dans la section du lien (style actif). */
export function isInSection(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Le panneau mobile est-il ouvert ?
 *
 * L'îlot retient le chemin sur lequel le panneau a été ouvert, pas un booléen.
 * Une navigation change le chemin, et le panneau se ferme de lui-même, sans effet
 * ni `setState` dans un effet (refusé par `react-hooks/set-state-in-effect`).
 */
export function isMenuOpen(openedOn: string | null, pathname: string | null): boolean {
  return openedOn !== null && openedOn === pathname;
}
