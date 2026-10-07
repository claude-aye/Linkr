// Pause, réactivation et retrait d'un métier déclaré — « Mes métiers » de
// l'Espace pro (Métiers — PR B). Règles pures, sans React.
//
// ⚠️ Module SANS AUCUN IMPORT, par contrat : il est chargé tel quel par
// `node --test` (cf. `trade-lifecycle.test.mjs`) et par le job CI `web-tests`,
// qui n'installe aucune dépendance. Les types d'API sont donc écrits ici en
// littéraux ; `ProviderCategory` (lib/providers/types.ts) les dérive du schéma,
// et un écart casserait le typecheck au site d'appel.

/** Statut de vérification d'une revendication de métier (`verification_status`). */
export type TradeVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'NOT_REQUIRED';

// ---------------------------------------------------------------------------
// Ce qui est offert
// ---------------------------------------------------------------------------

/**
 * La pause et la réactivation ne sont offertes que sur un métier ÉLIGIBLE
 * (`NOT_REQUIRED`, `VERIFIED`).
 *
 * ⚠️ L'API, elle, accepte la pause d'un métier `PENDING` ou `REJECTED` (dette
 * §6). On ne l'offre pas : le badge vient de `isActive ? statut : « En pause »`,
 * donc un métier refusé mis en pause afficherait « En pause » à la place de
 * « Vérification refusée » — le refus deviendrait invisible.
 */
export function canTogglePause(status: TradeVerificationStatus): boolean {
  return status === 'NOT_REQUIRED' || status === 'VERIFIED';
}

// ---------------------------------------------------------------------------
// Compter, par métier, les demandes en attente et les jobs actifs
// ---------------------------------------------------------------------------

/** Statut d'une réservation directe en attente de la réponse du prestataire. */
export const PENDING_BOOKING_STATUSES = ['OPEN'] as const;

/**
 * Statuts qui BLOQUENT le retrait d'un métier. `COMPLETED` n'en fait pas partie,
 * décision rendue : rien après la complétion ne lit le métier (solde, contestation,
 * cron d'auto-libération, relance de l'acompte), et une contestation peut garder
 * une demande en `COMPLETED` indéfiniment. Le blocage est un choix d'INTERFACE —
 * l'API permet de retirer un métier qui a des jobs actifs (dette §6).
 */
export const ACTIVE_JOB_STATUSES = ['ASSIGNED', 'IN_PROGRESS'] as const;

/**
 * Une liste de demandes du prestataire, et si elle est COMPLÈTE.
 *
 * `complete` vaut `total <= items.length` : la lecture est paginée (plafond 100),
 * et un compte fait sur une page tronquée serait trop BAS — il autoriserait un
 * retrait que des jobs plus anciens, sortis de la page, devraient bloquer.
 */
export interface RequestSnapshot {
  readonly items: readonly { readonly status: string; readonly serviceCategoryId: string }[];
  readonly complete: boolean;
}

/**
 * Nombre de demandes d'un métier (identifiant du CATALOGUE, pas de la ligne de
 * revendication) dans les statuts donnés. `null` = INCONNU : la lecture a échoué
 * (`snapshot === null`) ou la liste est tronquée. Jamais un zéro inventé.
 */
export function countForTrade(
  snapshot: RequestSnapshot | null,
  statuses: readonly string[],
  serviceCategoryId: string,
): number | null {
  if (snapshot === null || !snapshot.complete) return null;
  let count = 0;
  for (const item of snapshot.items) {
    if (item.serviceCategoryId === serviceCategoryId && statuses.includes(item.status)) count += 1;
  }
  return count;
}

/**
 * Réunit deux lectures filtrées (une par statut). Inconnue dès que l'une l'est :
 * la réunion d'un compte exact et d'un compte inconnu n'est pas un compte.
 */
export function mergeSnapshots(
  a: RequestSnapshot | null,
  b: RequestSnapshot | null,
): RequestSnapshot | null {
  if (a === null || b === null) return null;
  return { items: [...a.items, ...b.items], complete: a.complete && b.complete };
}

// ---------------------------------------------------------------------------
// Textes
// ---------------------------------------------------------------------------

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/** Ligne des devis — sans nombre : on ne peut pas les compter de façon fiable. */
export const QUOTES_LINE =
  'Vos devis déjà envoyés pour ce métier ne pourront plus être acceptés par les clients.';

export const RETIRE_UNVERIFIED_MESSAGE =
  'Nous n’avons pas pu vérifier vos jobs en cours. Veuillez réessayer plus tard.';

/**
 * Pourquoi « Retirer » est bloqué — `null` quand il ne l'est pas.
 *
 * Un compte INCONNU bloque : laisser passer un retrait qu'on n'a pas pu vérifier
 * échangerait une certitude contre une supposition. La suggestion de pause n'est
 * faite que si la pause est réellement offerte (métier éligible et actif).
 */
export function retireBlockedReason(
  activeJobs: number | null,
  pauseOffered: boolean,
): string | null {
  if (activeJobs === null) return RETIRE_UNVERIFIED_MESSAGE;
  if (activeJobs === 0) return null;
  const jobs = `${activeJobs} ${plural(activeJobs, 'job', 'jobs')}`;
  const finish = plural(activeJobs, 'Terminez-le', 'Terminez-les');
  return pauseOffered
    ? `Vous avez ${jobs} en cours sur ce métier. ${finish} avant de retirer le métier, ou mettez-le en pause.`
    : `Vous avez ${jobs} en cours sur ce métier. ${finish} avant de retirer le métier.`;
}

/**
 * La pause demande une confirmation seulement si au moins une réservation
 * attend sur ce métier — ou si on n'a pas pu le savoir.
 */
export function pauseNeedsConfirmation(pendingBookings: number | null): boolean {
  return pendingBookings === null || pendingBookings > 0;
}

/** Corps de la confirmation de pause, ligne par ligne. */
export function pauseConfirmationLines(pendingBookings: number | null): string[] {
  const lines = [
    'Pendant la pause, vous n’apparaissez plus dans les recherches pour ce métier. Vos jobs en cours se poursuivent normalement.',
  ];
  if (pendingBookings === null) {
    lines.push(
      'Les demandes en attente sur ce métier ne pourront plus être acceptées tant qu’il est en pause. Refusez-les d’abord depuis l’onglet En attente si vous ne comptez pas les honorer.',
    );
  } else if (pendingBookings > 0) {
    lines.push(
      pendingBookings === 1
        ? 'Vous avez 1 demande en attente sur ce métier. Elle ne pourra plus être acceptée tant que le métier est en pause. Refusez-la d’abord depuis l’onglet En attente si vous ne comptez pas l’honorer.'
        : `Vous avez ${pendingBookings} demandes en attente sur ce métier. Elles ne pourront plus être acceptées tant que le métier est en pause. Refusez-les d’abord depuis l’onglet En attente si vous ne comptez pas les honorer.`,
    );
  }
  lines.push(QUOTES_LINE);
  return lines;
}

export interface RetireConfirmationInput {
  /** Services rattachés à ce métier — `null` si la liste n'a pas pu être lue. */
  serviceCount: number | null;
  pendingBookings: number | null;
  status: TradeVerificationStatus;
  isActive: boolean;
}

/** Corps de la confirmation de retrait, ligne par ligne. */
export function retireConfirmationLines({
  serviceCount,
  pendingBookings,
  status,
  isActive,
}: RetireConfirmationInput): string[] {
  const lines = ['Vous n’apparaîtrez plus dans les résultats de recherche pour ce métier.'];

  if (serviceCount === null) {
    lines.push(
      'Les services de ce métier seront perdus et ne reviendront pas si vous le redéclarez.',
    );
  } else if (serviceCount === 1) {
    lines.push('Votre service sera perdu et ne reviendra pas si vous redéclarez ce métier.');
  } else if (serviceCount > 1) {
    lines.push(
      `Vos ${serviceCount} services seront perdus et ne reviendront pas si vous redéclarez ce métier.`,
    );
  }

  if (pendingBookings === null) {
    lines.push('Les demandes en attente sur ce métier ne pourront plus être acceptées.');
  } else if (pendingBookings === 1) {
    lines.push('Votre demande en attente ne pourra plus être acceptée.');
  } else if (pendingBookings > 1) {
    lines.push(`Vos ${pendingBookings} demandes en attente ne pourront plus être acceptées.`);
  }

  lines.push(QUOTES_LINE);

  // Suggérer la pause n'a de sens que là où elle est offerte.
  if (canTogglePause(status)) {
    lines.push(
      isActive
        ? 'Pour une absence temporaire, préférez la pause.'
        : 'Pour une absence temporaire, gardez plutôt ce métier en pause.',
    );
  }
  return lines;
}

/** Repli des erreurs réseau et de tout statut non mappé. */
export const TRADE_UNAVAILABLE_MESSAGE =
  'Service momentanément indisponible. Veuillez réessayer plus tard.';

/**
 * Message d'échec d'un `PATCH` (pause, réactivation) ou d'un `DELETE` (retrait),
 * par CODE HTTP SEUL (verrou 3.12b). Les statuts que l'API envoie
 * (`ProviderServicesService.updateCategory` / `deleteCategory`) : 400, 401,
 * 403, 404 — jamais de 409.
 */
export function tradeActionMessageForStatus(
  status: number,
  action: 'toggle' | 'retire',
): string {
  switch (status) {
    case 404:
      // Inconnu, d'un autre prestataire, ou DÉJÀ retiré (`findById` exclut les
      // lignes supprimées) : l'écran est périmé dans les trois cas.
      return action === 'retire'
        ? 'Ce métier a déjà été retiré de votre profil. Veuillez actualiser la page.'
        : 'Ce métier n’existe plus sur votre profil. Veuillez actualiser la page.';
    case 403:
      return 'Vous n’êtes pas autorisé à modifier ce profil prestataire.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 400:
      return 'La requête est invalide. Veuillez actualiser la page.';
    default:
      return TRADE_UNAVAILABLE_MESSAGE;
  }
}

// ---------------------------------------------------------------------------
// Corps relayé
// ---------------------------------------------------------------------------

/**
 * Corps du `PATCH` relayé, assemblé CHAMP PAR CHAMP : `isActive` booléen, et
 * rien d'autre. `null` = refusé (400 au relais).
 *
 * ⚠️ Un booléen EXIGÉ, pas seulement permis : côté API `isActive` est optionnel,
 * donc un `PATCH {}` passe la validation puis écrit `isActive: undefined` — un
 * risque de 500 (dette §6). Le relais ne le laisse jamais partir.
 */
export function assembleTradeToggleBody(incoming: unknown): { isActive: boolean } | null {
  if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) return null;
  const { isActive } = incoming as { isActive?: unknown };
  if (typeof isActive !== 'boolean') return null;
  return { isActive };
}
