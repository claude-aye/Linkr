// Confirmation, par le client, d'un acompte refusé hors session
// (`/account/payment-methods`, bandeau « Acompte à confirmer »).
//
// ⚠️ Module SANS AUCUN IMPORT, par contrat : il est chargé tel quel par
// `node --test` (cf. `deposit-confirmation.test.mjs`), dans un job CI qui
// n'installe rien. Tout ce qui demande React, Stripe.js ou `fetch` vit dans le
// composant (`confirm-deposit-action.tsx`) ; ici, seulement des décisions et du
// texte.

/** Repli de tout statut non mappé, et des erreurs réseau ou de transport. */
export const UNEXPECTED_MESSAGE =
  'Une erreur inattendue est survenue. Veuillez réessayer plus tard.';

/**
 * Stripe.js a refusé la confirmation : défi 3D Secure échoué ou abandonné,
 * carte refusée, ou panne réseau côté navigateur. UN seul message, parce que
 * le geste suivant du client est le même dans tous ces cas.
 *
 * ⚠️ Le message de Stripe n'est JAMAIS affiché : c'est une chaîne non traduite,
 * qui nomme parfois un identifiant interne (même règle que `card-form.tsx` et
 * que les courriels d'échec d'acompte).
 */
export const CONFIRMATION_FAILED_MESSAGE =
  "Le paiement n'a pas été confirmé. Réessayez, ou enregistrez une autre carte par défaut ci-dessous puis confirmez de nouveau.";

/** Stripe.js n'a pas pu être chargé (clé publiable absente au build, script bloqué). */
export const STRIPE_UNAVAILABLE_MESSAGE =
  'Le paiement en ligne est momentanément indisponible. Veuillez réessayer plus tard.';

/** Le paiement est confirmé côté banque. Le bandeau va disparaître. */
export const CONFIRMED_MESSAGE =
  'Paiement confirmé. Merci ! Le prestataire en sera informé.';

/**
 * Traduit le statut relayé par le BFF (`POST …/deposit-confirmation`) en
 * message FR figé. Décision verrouillée (3.12b) : le mapping se fait par code
 * HTTP SEUL, et le corps n'est jamais lu pour choisir un message.
 */
export function prepareErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 403:
    case 404:
      return "Ce paiement n'est plus accessible depuis votre compte.";
    // Toutes les causes « rien à confirmer ici » : demande qui n'est plus en
    // cours, acompte déjà réglé (la ligne vient d'être mise à jour), intention
    // de paiement annulée, montants en désaccord. Le geste est le même :
    // actualiser, ce que le composant fait de lui-même.
    case 409:
      return "Ce paiement n'est plus à confirmer ici. La page va être actualisée.";
    case 422:
      return 'Enregistrez une carte par défaut ci-dessous, puis confirmez le paiement.';
    case 502:
      return 'Le service de paiement est momentanément indisponible. Veuillez réessayer dans quelques minutes.';
    default:
      return UNEXPECTED_MESSAGE;
  }
}

/**
 * Un statut de PaymentIntent qui veut dire « l'argent est parti, ou part » :
 * le client n'a plus rien à faire. `requires_action` n'en fait PAS partie : il
 * ne survit pas à `confirmCardPayment`, qui joue le défi lui-même ; s'il
 * revenait quand même, le paiement ne serait pas fait.
 */
export function isSettledIntentStatus(status: string | null | undefined): boolean {
  return status === 'succeeded' || status === 'processing' || status === 'requires_capture';
}

/**
 * Montant de l'acompte, en `fr-CA` (« 30,00 $ »). Code ISO inconnu ⇒ la paire
 * brute, jamais une devise inventée.
 */
export function formatDepositAmount(amount: string, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}
