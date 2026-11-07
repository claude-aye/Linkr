import Link from 'next/link';

import { GUIDE_TESTEUR_PATH } from '@/lib/legal/legal-pages';

/**
 * Rappel « données de test » affiché là où une personne saisit ou lance un
 * paiement. Texte seul : aucune logique de paiement.
 *
 * ⚠️ MÊME CONDITION D'AFFICHAGE QUE LE BANDEAU « VERSION D'ESSAI » du layout
 * racine (`app/layout.tsx`) : il est permanent pendant l'essai. À la fin de
 * l'essai, retirer le bandeau ET ce composant (chercher `TestDataNotice`) dans
 * la même PR.
 *
 * Textes alignés sur le Guide du testeur ; ne rien promettre de plus.
 */
export type TestDataNoticeKind = 'payment' | 'connect';

const COPY: Record<TestDataNoticeKind, string> = {
  payment:
    "Version d'essai : les paiements sont fictifs. Utilisez la carte de test 4242 4242 4242 4242. N'entrez jamais vos vraies informations bancaires.",
  connect:
    "Version d'essai : sur la page de Stripe, utilisez les données de test proposées. N'entrez jamais vos vraies informations d'identité ou bancaires.",
};

export function TestDataNotice({
  kind,
  className = '',
}: {
  kind: TestDataNoticeKind;
  className?: string;
}) {
  return (
    <p
      className={`rounded-2xl border border-edge bg-surface px-4 py-3 text-sm text-text ${className}`}
    >
      {COPY[kind]}{' '}
      <Link
        href={GUIDE_TESTEUR_PATH}
        className="font-medium text-accent underline underline-offset-2"
      >
        Guide du testeur
      </Link>
    </p>
  );
}
