// Message affiché quand l'acceptation d'une réservation directe échoue
// (« Accepter » de l'Espace pro, `dashboard/_actions/accept-request-action.tsx`).
//
// ⚠️ Module SANS AUCUN IMPORT, par contrat : il est chargé tel quel par
// `node --test` (cf. `accept-error-message.test.mjs`). L'adresse de support est
// donc un PARAMÈTRE — le composant lui passe `SUPPORT_EMAIL` (`lib/constants.ts`),
// qui reste la seule source de l'adresse.

/** Repris tel quel par la garde « montant manquant » du composant et par le 422. */
export const MISSING_AMOUNT_MESSAGE =
  "Cette demande n'a pas de montant estimé et ne peut être acceptée.";

/** Repli de tout statut non mappé, et des erreurs réseau/transport. */
export const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Traduit le statut relayé par le BFF en message FR figé. Décision verrouillée
 * (3.12b) : le mapping se fait par code HTTP SEUL — le corps n'est jamais lu
 * pour choisir un message.
 */
export function acceptErrorMessage(status: number, supportEmail: string): string {
  switch (status) {
    // ⚠️ Ce 403 a DEUX causes que le code ne distingue pas : le métier perdu
    // (pause, suppression, vérification qui n'est plus valide —
    // `ProviderNotEligibleToAcceptException`) ET « vous n'êtes pas le
    // prestataire ciblé » (`NotRequestOwnerException`). Elles partagent ce
    // message, délibérément : la seconde est quasi inatteignable depuis
    // l'interface, qui ne propose « Accepter » qu'au prestataire ciblé.
    // L'adresse est là parce qu'aucun écran ne permet de rétablir un métier.
    case 409:
      return "Cette demande n'est plus disponible ou un problème de paiement empêche l'acceptation. Veuillez rafraîchir la page et réessayer.";
    case 502:
      return 'Le prélèvement du dépôt a échoué. Veuillez réessayer dans quelques instants.';
    case 422:
      return MISSING_AMOUNT_MESSAGE;
    case 404:
      return "Cette demande n'est plus accessible.";
    default:
      return UNEXPECTED_MESSAGE;
  }
}
