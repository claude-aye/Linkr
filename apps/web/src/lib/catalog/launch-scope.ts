import type { RegulationLevel } from '@/lib/providers/discovery-types';

/**
 * Which trades the CLIENT is offered as a starting point — the MVP launch scope.
 *
 * ⚠️ THIS IS A PRODUCT DECISION, NOT A TECHNICAL LIMIT, AND IT IS MEANT TO BE
 * REVERSED. Linkr launches on INFORMAL trades only. The regulated segment is not
 * abandoned — the backend is complete and proven (four states, correct
 * transitions, a working admin console, a first `VERIFIED` claim produced through
 * the real path in session 4). What is missing is on the PROVIDER side: the
 * dashboard's « Mes métiers » selector hard-blocks regulated trades, and there is
 * NO document-upload screen at all. A plumber signing up today can neither
 * declare their trade nor send their licence. So three of the seven catalog
 * categories can receive NO offer, and offering them to a client means showing
 * three doors that will never open.
 *
 * ⚠️ DERIVED FROM THE DATA, NEVER A LIST OF UUIDS. The test is on
 * `regulationLevel`, so a new informal category appears on its own, and reopening
 * the regulated segment is ONE LINE to invert here — not a hunt for constants
 * scattered across two call sites.
 *
 * ⚠️ THIS FILTERS WHAT IS *OFFERED*, NEVER WHAT IS *RESOLVABLE*. A regulated
 * `?categoryId=` reached by a shared link or a bookmark must still resolve to its
 * name and its regulation level, because that is what feeds the honest empty
 * state of `/recherche` (`_components/no-results.tsx`). Filtering the lookup set
 * instead of the choice set would silently demote that surface to its « unknown
 * trade » branch and reintroduce the exact lie chantier H removed. Call sites
 * apply this to the selector/tile list ONLY. See CLAUDE.md.
 *
 * NOT a feature-toggle framework. The project plans one for per-region legal
 * obligations (`regulatory_requirements`) and that is its natural long-term home;
 * building it here would be out of scope. Tracked as debt instead.
 */

/**
 * True when a trade is offered to clients at launch.
 *
 * Reopening the regulated segment is this line — nothing else.
 */
export function isTradeOfferedAtLaunch(category: {
  regulationLevel: RegulationLevel;
}): boolean {
  return category.regulationLevel === 'INFORMAL';
}

/**
 * The offered subset of a catalog list, order preserved. Returns a NEW array
 * (`filter` copies), so call sites may sort the result in place.
 *
 * Generic over the element type so both call sites keep their own shape
 * (`CategoryOption` today) instead of being widened to a lowest common type.
 */
export function tradesOfferedAtLaunch<T extends { regulationLevel: RegulationLevel }>(
  categories: T[],
): T[] {
  return categories.filter(isTradeOfferedAtLaunch);
}
