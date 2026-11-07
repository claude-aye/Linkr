import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/legal/legal-footer';
import { LEGAL_DOCUMENTS } from '@/lib/legal/legal-pages';

export const metadata: Metadata = {
  title: 'Guide du testeur',
};

const linkClass =
  'font-medium text-accent underline underline-offset-2 hover:opacity-80';

/**
 * « Guide du testeur » — texte repris mot pour mot du HANDOFF du 5 novembre
 * 2026, §9. ⚠️ NE RIEN Y AJOUTER NI Y PROMETTRE DE PLUS que la politique de
 * confidentialité : toute promesse nouvelle est un changement de fond, donc une
 * nouvelle `LEGAL_VERSION` (CLAUDE.md §13.1 nº 31). Évite « gratuit »,
 * « sécurisé », « vérifié ».
 *
 * Page publique : son chemin est lu par `proxy.ts` (`GUIDE_TESTEUR_PATH`).
 * Le site n'a aucun mécanisme de traduction pour ses pages : français seulement.
 */
export default function Page() {
  return (
    <>
      <main className="flex flex-1 justify-center bg-bg p-6">
        <article className="w-full max-w-3xl leading-7 text-text">
          <h1 className="border-b border-edge pb-6 text-3xl font-semibold tracking-tight">
            Guide du testeur
          </h1>
          <p className="mt-6">
            Linkr est en version d&apos;essai. Vous pouvez l&apos;essayer comme client
            (chercher un prestataire près de chez vous, envoyer une demande) ou comme
            prestataire (déclarer un métier, ajouter un service, recevoir et exécuter une
            demande).
          </p>
          <p className="mt-4">
            <strong className="font-semibold">Les paiements sont fictifs.</strong>{' '}
            Ils sont en mode test : aucune somme réelle n&apos;est prélevée. Pour ajouter une carte,
            utilisez la carte de test 4242 4242 4242 4242, avec une date d&apos;expiration
            future et un code de sécurité de votre choix. N&apos;entrez jamais vos vraies
            informations bancaires.
          </p>
          <p className="mt-4">
            <strong className="font-semibold">
              Configurer les paiements d&apos;un prestataire
            </strong>{' '}
            : la page de Stripe propose des données de test. Utilisez-les : n&apos;entrez
            jamais vos vraies informations d&apos;identité ou bancaires.
          </p>
          <p className="mt-4">
            <strong className="font-semibold">Vos renseignements</strong> : ils sont
            conservés pendant l&apos;essai. Si vous demandez la fermeture de votre compte, il
            est masqué rapidement ; vos données sont détruites au plus tard 30 jours après la
            fin de l&apos;essai, qui sera annoncée sur le site et par courriel (voir la{' '}
            <Link href={LEGAL_DOCUMENTS['privacy-fr'].path} className={linkClass}>
              politique de confidentialité
            </Link>
            , section 7).
          </p>
          <p className="mt-4">
            Pendant l&apos;essai, le nombre de courriels envoyés par jour est limité :
            certains courriels de notification peuvent ne pas partir.
          </p>
          <p className="mt-4">
            <strong className="font-semibold">Nous écrire</strong> :{' '}
            <a href="mailto:support@linkrapp.com" className={linkClass}>
              support@linkrapp.com
            </a>
            . Dites-nous la page où vous étiez, ce que vous faisiez, ce que vous attendiez
            et ce qui s&apos;est passé. Une capture d&apos;écran aide, sans renseignement
            personnel.
          </p>
        </article>
      </main>
      <LegalFooter locale="fr" />
    </>
  );
}
