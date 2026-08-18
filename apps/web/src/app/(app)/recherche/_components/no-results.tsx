import Link from 'next/link';

import type { RegulationLevel } from '@/lib/providers/discovery-types';

/**
 * The « zero result » surface of `/recherche` (chantier H).
 *
 * ⚠️ THIS IS A PRODUCT SURFACE, NOT AN ERROR STATE — and on a marketplace
 * starting cold it is the NOMINAL case, not an edge case. A client searching
 * « plombier » today gets nothing back. A bare « aucun résultat » reads as a bug
 * and teaches them the platform is empty; what it must do instead is say WHICH
 * trade, in WHICH area, and WHY zero is possible.
 *
 * ⚠️ THE TWO BRANCHES ARE NOT THE SAME INFORMATION, AND `discover` CANNOT TELL
 * THEM APART. Ground truth, probed on the real stack with ONE provider based at
 * the searched point, declaring one INFORMAL and one REGULATED trade:
 *
 *   INFORMAL trade it declared       → { items: [1 item], total: 1 }
 *   REGULATED trade it declared      → { items: [], total: 0 }   (claim PENDING)
 *   INFORMAL trade NOBODY declared   → { items: [], total: 0 }
 *
 * The last two responses are BYTE-IDENTICAL. The signal that separates them is
 * not in the discovery response at all — it is the catalog's `regulationLevel`,
 * which the page already holds for its trade selector. Hence this component takes
 * the regulation level instead of trying to infer anything from `total`.
 *
 * Server-side eligibility (`eligibilityFromWhere()`) keeps only
 * `VERIFIED | NOT_REQUIRED` claims, and `addCategory` files an INFORMAL claim as
 * `NOT_REQUIRED` (immediately eligible) but a REGULATED one as `PENDING`. So:
 *
 *   INFORMAL  + zero ⇒ nobody covers this point. There is no gate to be stuck in.
 *   REGULATED + zero ⇒ nobody VERIFIED covers this point. People may well work
 *                      here without appearing yet — that is the gate, not absence.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT SAY: « 3 plombiers attendent leur
 * vérification ». We do not know that, finding out would take a new endpoint, and
 * it would publish how thin the supply is. The copy states the RULE, never a
 * count, and PROMISES NO DELAY — the admin console cannot even display the
 * document it is asked to approve today (tracked debt), so any « bientôt » would
 * be a promise the product cannot keep.
 *
 * It is never a dead end: the trade and the address are both editable in the form
 * directly above, and the full trade list is one link away.
 */
export function NoResults({
  tradeLabel,
  regulationLevel,
}: {
  /** Trade name already resolved via `pickTranslation`; null when unknown. */
  tradeLabel: string | null;
  /** Catalog regulation level; null when the catalog read failed. */
  regulationLevel: RegulationLevel | null;
}) {
  // Naming the trade is what turns « aucun résultat » into an answer. When the
  // catalog read failed we genuinely do not know the name — say « ce métier »
  // rather than print a UUID or invent a label.
  const trade = tradeLabel ?? 'ce métier';
  const isRegulated = regulationLevel === 'REGULATED';

  // ⚠️ THREE-WAY, NOT TWO-WAY — and the third branch is the whole reason this is
  // not a boolean. `regulationLevel` is null when the catalog read failed OR when
  // the URL carries a well-formed uuid that is not a category at all (both reach
  // this component with a real zero result). Falling through to the INFORMAL copy
  // there would assert « ce métier ne demande aucune vérification de licence »
  // about a trade we know NOTHING about — caught by probing a synthetic uuid, and
  // exactly the class of lie this whole surface exists to remove. When the level
  // is unknown we say what we measured (zero providers) and NOTHING about why.
  const explanation = isRegulated ? (
    <>
      C’est un métier réglementé&nbsp;: Linkr n’affiche un professionnel qu’une fois sa
      licence vérifiée. Des professionnels peuvent donc exercer dans ce secteur sans
      encore apparaître ici.
    </>
  ) : regulationLevel === 'INFORMAL' ? (
    <>
      Ce métier ne demande aucune vérification de licence&nbsp;: si personne n’apparaît,
      c’est qu’aucun prestataire ne couvre encore votre position.
    </>
  ) : null;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {isRegulated
          ? 'Aucun professionnel vérifié dans ce secteur'
          : 'Aucun prestataire dans ce secteur'}
      </h2>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        {isRegulated ? (
          <>
            Aucun professionnel vérifié en <strong>{trade}</strong> ne couvre encore ce
            secteur.
          </>
        ) : (
          <>
            Aucun prestataire n’offre <strong>{trade}</strong> dans ce secteur pour le
            moment.
          </>
        )}
      </p>

      {/* The « why » — the whole point of splitting the branches. On a regulated
          trade, absence HERE does not mean absence in the world. Omitted entirely
          when the level is unknown: no explanation beats a wrong one. */}
      {explanation !== null && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{explanation}</p>
      )}

      {/* Never a dead end — both search inputs sit in the form just above, and
          the full trade list is one link away. */}
      <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
        Modifiez le métier ou l’adresse ci-dessus, ou{' '}
        <Link
          href="/"
          className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          parcourez tous les métiers
        </Link>
        .
      </p>
    </div>
  );
}
