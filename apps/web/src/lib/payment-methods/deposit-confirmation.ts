// Confirmation, par le client, d'un acompte — ou, depuis le lot « solde 3D
// Secure », d'un solde — refusé hors session (`/account/payment-methods`,
// section « … à confirmer »).
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

// ---------------------------------------------------------------------------
// Le SOLDE (80 %), depuis le lot « solde 3D Secure ».
//
// La même liste (`deposits-awaiting-confirmation`) porte désormais des soldes,
// distingués par `paymentType`. Le même bouton les confirme, par le même
// mécanisme ; seuls changent l'endpoint appelé et les mots. Les codes HTTP de
// l'endpoint du solde sont ceux de l'acompte (401/403/404/409/422/502) :
// `prepareErrorMessage` sert les deux.
// ---------------------------------------------------------------------------

/**
 * Le paiement en attente, tel que l'API le nomme (`paymentType`). Écrit ici en
 * toutes lettres parce que ce module n'importe rien ; le composant lui passe
 * l'union générée, qui est la même.
 */
export type AwaitingPaymentType = 'DEPOSIT' | 'BALANCE';

/**
 * Le relais BFF que le bouton appelle. ⚠️ C'est le seul aiguillage : appeler
 * l'endpoint de l'acompte pour un solde répondrait 409 (aucun acompte à
 * confirmer), et le client resterait devant un bouton qui ne fait rien.
 */
export function confirmationEndpoint(
  serviceRequestId: string,
  paymentType: AwaitingPaymentType,
): string {
  const segment = paymentType === 'BALANCE' ? 'balance-confirmation' : 'deposit-confirmation';
  return `/api/service-requests/${serviceRequestId}/${segment}`;
}

/** « Acompte de 30,00 $ » / « Solde de 120,00 $ ». */
export function awaitingAmountLabel(
  paymentType: AwaitingPaymentType,
  amount: string,
  currency: string,
): string {
  const noun = paymentType === 'BALANCE' ? 'Solde' : 'Acompte';
  return `${noun} de ${formatDepositAmount(amount, currency)}`;
}

/**
 * Ce qui s'est passé, et ce que le bouton va faire. Les deux causes (banque qui
 * exige le 3D Secure, carte refusée) laissent le même état et ne se distinguent
 * pas : le texte couvre les deux, le geste est le même.
 *
 * Le texte de l'acompte est INCHANGÉ au caractère près (lot D1).
 */
export function awaitingExplanation(paymentType: AwaitingPaymentType): string {
  if (paymentType === 'BALANCE') {
    return 'Les travaux sont terminés, mais le prélèvement automatique du solde n’a pas abouti : votre banque demande que vous confirmiez le paiement, ou la carte utilisée a été refusée. Le prestataire attend ce paiement. Il sera fait avec votre carte par défaut, et votre banque peut vous demander une vérification.';
  }
  return 'Le prélèvement automatique de cet acompte n’a pas abouti : votre banque demande que vous confirmiez le paiement, ou la carte utilisée a été refusée. Le paiement sera fait avec votre carte par défaut, et votre banque peut vous demander une vérification.';
}

/**
 * Titre de la section, accordé à son contenu : « Acompte(s) à confirmer »,
 * « Solde(s) à confirmer », ou « Paiements à confirmer » quand les deux se
 * côtoient. Liste vide : la section n'est pas affichée, le titre est sans objet.
 */
export function awaitingSectionTitle(types: readonly AwaitingPaymentType[]): string {
  const plural = types.length > 1;
  if (types.length > 0 && types.every((t) => t === 'DEPOSIT')) {
    return plural ? 'Acomptes à confirmer' : 'Acompte à confirmer';
  }
  if (types.length > 0 && types.every((t) => t === 'BALANCE')) {
    return plural ? 'Soldes à confirmer' : 'Solde à confirmer';
  }
  return 'Paiements à confirmer';
}

/**
 * Où `confirm-completion` envoie le client quand l'API répond 202 : le solde
 * attend sa propre confirmation. Le paramètre allume le bandeau ci-dessous.
 */
export const BALANCE_AWAITING_FLAG = 'a-confirmer';
export const BALANCE_AWAITING_REDIRECT = `/account/payment-methods?solde=${BALANCE_AWAITING_FLAG}`;

/**
 * Le bandeau du 202, sur `/account/payment-methods`. ⚠️ DEUX TEXTES, comme le
 * bandeau 202 de l'acompte (lot D1) : on ne promet le bouton que si la liste
 * contient bien un solde. Sinon (lecture en échec, ou ligne déjà réglée par le
 * webhook entre-temps), le texte ne promet rien.
 */
export function balanceRedirectBanner(hasBalanceAwaiting: boolean): string {
  return hasBalanceAwaiting
    ? 'La fin des travaux est confirmée. Le paiement du solde demande toutefois votre confirmation : votre banque veut une vérification, ou votre carte a été refusée. Confirmez le paiement ci-dessous.'
    : 'La fin des travaux est confirmée, mais le prélèvement du solde n’a pas abouti. Si un paiement attend votre confirmation, il apparaît ci-dessous ; sinon, vérifiez votre carte par défaut.';
}
