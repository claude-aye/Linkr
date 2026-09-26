// Règles d'affichage des DEVIS REÇUS par le client d'un appel d'offres (PR 4b).
//
// Module PUR, sans aucun import, chargé tel quel par `node --test`
// (`received-quotes.test.mjs`) — même banc que `tender-rules.ts`. La page et
// l'îlot client ne font que brancher l'état ; le tri, la conversion des montants
// et la règle de réputation vivent ICI.
//
// ⚠️ AUCUN CALCUL D'ACOMPTE ICI, ni nulle part côté web. `depositAmount` arrive
// calculé par le serveur (PR 4a-bis), avec le taux de `PLATFORM_DEPOSIT_RATE_PERCENT`
// qu'aucun miroir ne pourrait suivre ; on l'AFFICHE tel quel.

/**
 * Chaîne décimale (« 850.50 », « 1500 », « 0.3 ») → centimes ENTIERS. Aucun
 * flottant : « 0.1 + 0.2 » ne doit jamais décider de l'ordre de deux offres.
 * `null` sur une chaîne illisible — on ne fabrique pas un prix. Au-delà de deux
 * décimales, les chiffres surnuméraires sont TRONQUÉS : l'API sérialise
 * `numeric(12,2)`, ce cas ne survient pas ; il ne doit simplement pas planter.
 */
export function decimalToCents(amount: string): number | null {
  const m = /^\s*(-?)(\d+)(?:\.(\d*))?\s*$/.exec(amount);
  if (!m) return null;
  const [, sign, whole, frac = ''] = m;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === '-' ? -cents : cents;
}

export type QuoteSortMode = 'arrival' | 'price';

/**
 * Tri côté navigateur.
 *   - `arrival` (défaut) : l'ordre de l'API, INCHANGÉ — elle place déjà les offres
 *     vivantes d'abord, puis l'ordre d'arrivée. On ne le recalcule pas.
 *   - `price` : montant croissant, comparé en centimes ; égalité → ordre
 *     d'arrivée (l'ordre de l'API). Un montant illisible va en queue plutôt que
 *     de fausser la comparaison.
 * Jamais par note : la plateforme ne classe pas les prestataires (§11 D tr. 3).
 * Retourne un NOUVEAU tableau ; l'entrée n'est pas mutée.
 */
export function sortReceivedQuotes<T extends { amount: string }>(
  items: readonly T[],
  mode: QuoteSortMode,
): T[] {
  if (mode === 'arrival') return [...items];
  return items
    .map((item, index) => ({ item, index, cents: decimalToCents(item.amount) }))
    .sort((a, b) => {
      if (a.cents === null || b.cents === null) {
        if (a.cents === b.cents) return a.index - b.index;
        return a.cents === null ? 1 : -1;
      }
      return a.cents - b.cents || a.index - b.index;
    })
    .map(({ item }) => item);
}

export type Reputation =
  | { kind: 'unavailable' }
  | { kind: 'rated'; averageRating: number; reviewCount: number }
  | { kind: 'count'; reviewCount: number }
  | { kind: 'none' };

/**
 * La réputation d'un devis, règle D-4 — l'API la gate déjà, on ne la re-dérive pas.
 *   - `reviewCount === null` → lecture en échec : « Réputation indisponible »,
 *     DISTINCT de zéro (inventer un zéro fausserait la comparaison) ;
 *   - `averageRating !== null` → note + nombre d'avis ;
 *   - `averageRating === null` et 1 ou 2 avis → le compte seul, sans note ;
 *   - `0` → rien du tout (tout prestataire démarre à zéro).
 * On ne teste JAMAIS `reviewCount >= 3` : c'est `averageRating === null` qui dit
 * que le seuil n'est pas atteint. Recompter serait une seconde copie de la règle.
 */
export function reputationOf(
  reviewCount: number | null,
  averageRating: number | null,
): Reputation {
  if (reviewCount === null) return { kind: 'unavailable' };
  if (averageRating !== null) return { kind: 'rated', averageRating, reviewCount };
  if (reviewCount > 0) return { kind: 'count', reviewCount };
  return { kind: 'none' };
}

/** « À N km » ; `0` (arrondi serveur au km) → « À moins de 1 km » ; `null` → rien. */
export function distanceLabel(distanceKm: number | null): string | null {
  if (distanceKm === null) return null;
  return distanceKm < 1 ? 'À moins de 1 km' : `À ${distanceKm} km`;
}

/**
 * Minutes → heures, virgule québécoise : 90 → « 1,5 h », 120 → « 2 h »,
 * 45 → « 45 min ». Les devis sont saisis par pas d'une demi-heure (PR 3) ; un
 * reste non rond reste lisible (100 → « 1 h 40 »).
 */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 30 === 0) return `${String(minutes / 60).replace('.', ',')} h`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
