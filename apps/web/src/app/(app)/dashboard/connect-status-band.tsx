import Link from 'next/link';
import type { components } from '@linkr/api-client';

import { ConnectLinkAction } from './_actions/connect-link-action';
import { ConnectRecheckAction } from './_actions/connect-recheck-action';

/**
 * Stripe Connect state band — the provider-facing answer to « puis-je être
 * payé ? ».
 *
 * PRESENTATIONAL ONLY: it receives the mirror in props and makes NO network
 * call of its own. The page that shows it is the one that reads
 * `GET /service-providers/{id}/connect/status`.
 *
 * ⚠️ IT LIVES IN PAGES, NEVER IN A LAYOUT. The App Router does not re-render
 * parent layouts on a client navigation, so a band hoisted into
 * `(app)/dashboard/layout.tsx` would keep showing the state it had when the
 * layout last rendered — stale the moment the provider navigates to
 * `/dashboard/paiements` right after finishing onboarding. Each page that
 * displays it renders it. Do not factor this into a layout to save the
 * duplicated read.
 *
 * The DTO is consumed NATIVELY from the generated schema — no local mirror, no
 * cast. Only `onboardedAtUtc` degrades to `Record<string, never>` (the §6
 * nullable debt), and nothing here reads it.
 */
type ConnectAccount = components['schemas']['ConnectAccountResponseDto'];

/**
 * Support contact for a blocked account. TODO: replace with the real support
 * address once one exists. It is deliberately a visible placeholder rather than
 * an empty string — and `href="#"` is forbidden, because a contact affordance
 * that goes nowhere is worse than no affordance at all.
 */
const SUPPORT_EMAIL = 'REMPLACER@linkr.ca';

/**
 * WHERE the band sits, decided by CAPABILITIES — never by the status enum.
 *
 * The enum picks the WORDS; these two booleans pick the weight and the place.
 * That split is what keeps the band honest: `onboarding_status` is a derived
 * label, whereas `charges_enabled` / `payouts_enabled` are what actually decide
 * whether money can move.
 *
 * Exported so the dashboard can order its sections from the SAME rule the band
 * renders from. Two copies of this predicate would be free to drift, and the
 * drift would be silent: a provider who cannot be paid quietly demoted below
 * his inbox, with nothing on screen to say so.
 */
export function connectBandPlacement(
  account: ConnectAccount | null,
): 'head' | 'foot' {
  // No mirror row at all = onboarding never started. The caller turns the API's
  // 404 into `null`; that 404 is NOT an error, it is a state.
  if (!account) return 'head';

  /**
   * ⚠️ `chargesEnabled && !payoutsEnabled` IS DELIBERATELY A HEAD CONDITION,
   * and it is the single most important line in this file.
   *
   * `assertPayable` (payments) reads ONLY `charges_enabled`. So in this state
   * the booking goes through, the destination charge moves the money to the
   * provider's Stripe balance — and it NEVER LEAVES. The provider works,
   * believing he has been paid, and nothing anywhere tells him otherwise.
   * That is a worse failure than a visible block, so it gets the same weight as
   * « you cannot be paid at all ».
   */
  if (!account.chargesEnabled || !account.payoutsEnabled) return 'head';

  // Fully enabled: a one-line footer, whether or not something is still due.
  return 'foot';
}

interface BandCopy {
  title: string;
  body: string;
  /** Which Stripe link to mint, if any. `null` = nothing for the provider to do. */
  action: { kind: 'onboard' | 'refresh-link'; label: string } | null;
  /** Discreet « Vérifier de nouveau » (re-reads Stripe through `sync`). */
  recheck: boolean;
  /** Support mailto — DISABLED only (see below). */
  contact: boolean;
}

/**
 * The words, chosen by the status enum WITHIN the capability condition.
 *
 * Read this together with {@link connectBandPlacement}: this function never
 * decides placement, and that function never decides copy.
 */
function headCopy(account: ConnectAccount | null): BandCopy {
  // Nothing started yet — the entry point into onboarding.
  if (!account || account.onboardingStatus === 'NOT_STARTED') {
    return {
      title: 'Configurez vos paiements',
      body:
        'Vous ne pouvez pas encore recevoir de paiement. Stripe, notre partenaire ' +
        'de paiement, doit d’abord vérifier votre identité.',
      action: { kind: 'onboard', label: 'Configurer mes paiements' },
      recheck: false,
      contact: false,
    };
  }

  /**
   * ⚠️ DISABLED CARRIES BOTH AFFORDANCES — a retry AND a way to reach a human.
   *
   * `deriveStatus` rule 2 fires on ANY `disabled_reason`, which covers both an
   * outright rejection and a document that merely went past due — and the local
   * mirror does not store `disabled_reason`, so we genuinely cannot tell the two
   * apart. The costs are asymmetric: offering a link on a truly rejected account
   * fails visibly with a 502, while withholding it from a recoverable one locks
   * somebody out permanently. So we offer both and promise nothing.
   */
  if (account.onboardingStatus === 'DISABLED') {
    return {
      title: 'Votre compte de paiement est bloqué',
      body:
        'Vous ne pouvez plus recevoir de paiement. Vous pouvez tenter de mettre ' +
        'votre compte à jour, ou nous écrire.',
      action: { kind: 'refresh-link', label: 'Mettre à jour mon compte' },
      recheck: false,
      contact: true,
    };
  }

  /**
   * Under review: the provider has NOTHING to do, so there is no call to
   * action — offering one would invent work and imply he is at fault for the
   * wait. Only the discreet re-check, which re-reads Stripe (Phase 5 explains
   * why it reports « rien n'a changé » rather than refreshing in silence).
   */
  if (account.onboardingStatus === 'PENDING_VERIFICATION') {
    return {
      title: 'Vérification en cours',
      body:
        'Stripe examine votre dossier. Vous n’avez rien à faire : vous pourrez ' +
        'recevoir des paiements dès que la vérification sera terminée.',
      action: null,
      recheck: true,
      contact: false,
    };
  }

  // Charges live but payouts frozen — the silent-failure case above.
  if (account.chargesEnabled && !account.payoutsEnabled) {
    return {
      title: 'Vos versements sont suspendus',
      body:
        'Vous pouvez recevoir des paiements, mais Stripe ne peut pas les verser ' +
        'sur votre compte bancaire : l’argent reste bloqué chez Stripe. ' +
        'Complétez votre dossier pour débloquer vos versements.',
      action: { kind: 'refresh-link', label: 'Débloquer mes versements' },
      recheck: false,
      contact: false,
    };
  }

  // INFO_NEEDED, RESTRICTED, and any future member that still leaves charges
  // off: the file is incomplete and the provider can act on it.
  return {
    title:
      account.onboardingStatus === 'INFO_NEEDED'
        ? 'Stripe a besoin d’informations'
        : 'Vous ne pouvez pas encore être payé',
    body:
      'Votre dossier est incomplet : vous ne pouvez pas encore recevoir de ' +
      'paiement. Complétez-le auprès de Stripe pour activer vos paiements.',
    action: { kind: 'refresh-link', label: 'Compléter mon dossier' },
    recheck: false,
    contact: false,
  };
}

export interface ConnectStatusBandProps {
  providerId: string;
  /** The mirror, or `null` when the API answered 404 (= onboarding not started). */
  account: ConnectAccount | null;
  /**
   * Where the band is rendered. Only effect: the dashboard's all-green footer
   * links through to the payments page, which would otherwise link to itself.
   */
  context: 'dashboard' | 'paiements';
}

export function ConnectStatusBand({
  providerId,
  account,
  context,
}: ConnectStatusBandProps) {
  const placement = connectBandPlacement(account);

  if (placement === 'foot') {
    // Fully enabled. Either something is still due (act before the deadline) or
    // nothing is — one discreet line either way, never a card.
    const due = account !== null && account.requirementsCurrentlyDue.length > 0;

    return (
      <section
        aria-labelledby="connect-title"
        className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="connect-title" className="sr-only">
          Paiements
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {due ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Stripe a besoin d’informations complémentaires pour maintenir vos
              paiements actifs.
            </p>
          ) : (
            <p className="text-sm text-emerald-800 dark:text-emerald-300">
              Vos paiements sont actifs.
            </p>
          )}

          {due ? (
            <ConnectLinkAction
              providerId={providerId}
              kind="refresh-link"
              label="Compléter mon dossier"
              variant="link"
            />
          ) : (
            context === 'dashboard' && (
              <Link
                href="/dashboard/paiements"
                className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                Voir mes paiements →
              </Link>
            )
          )}
        </div>
      </section>
    );
  }

  const copy = headCopy(account);
  // DISABLED is the one blocked-outright state; the others are in-progress, so
  // they take the attention tone the inbox already uses rather than the error
  // tone the repo reserves for a refusal.
  const blocked = account?.onboardingStatus === 'DISABLED';
  const frame = blocked
    ? 'border-red-300/70 dark:border-red-900'
    : 'border-amber-300/70 dark:border-amber-900';
  const chip = blocked
    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';

  return (
    <section
      aria-labelledby="connect-title"
      className={`rounded-2xl border bg-white p-5 shadow-sm dark:bg-zinc-900 ${frame}`}
    >
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${chip}`}
      >
        Paiements
      </span>

      <h2
        id="connect-title"
        className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        {copy.title}
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{copy.body}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {copy.action && (
          <ConnectLinkAction
            providerId={providerId}
            kind={copy.action.kind}
            label={copy.action.label}
            variant="primary"
          />
        )}

        {/* `recheck` is only ever set on a branch where the mirror exists; the
            null-check is what makes that narrowing explicit to the compiler. */}
        {copy.recheck && account && (
          <ConnectRecheckAction
            providerId={providerId}
            onboardingStatus={account.onboardingStatus}
            chargesEnabled={account.chargesEnabled}
            payoutsEnabled={account.payoutsEnabled}
          />
        )}

        {copy.contact && (
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            Nous écrire
          </a>
        )}
      </div>
    </section>
  );
}
