import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a CLIENT receives when their deposit could not be charged.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ ONE FAILURE, TWO RECIPIENTS, TWO TEMPLATES. This one goes to the client,
 * who is the only person able to fix the CAUSE (expired card, insufficient
 * funds, 3-D Secure block) — and who has NO retry button: `retryDeposit` is
 * guarded by the assignment and only the assigned worker may call it. See
 * deposit-failed-provider.template.ts for the other half.
 *
 * ⚠️ SINCE THE 3-D SECURE CHANTIER (D1), THE CLIENT USUALLY HAS A WAY OUT OF
 * THEIR OWN: `/account/payment-methods` offers « Confirmer le paiement » on the
 * same PaymentIntent. USUALLY, NOT ALWAYS — and the copy must cover both,
 * because this email cannot know at send time what the page will show. The
 * synchronous path (`announceDepositFailure` after a failed capture at
 * acceptance) fires on EVERY exception of `captureDeposit`, including a Stripe
 * error that carries no intent (row FAILED, `stripe_payment_intent_id` NULL)
 * and a commit/capture race that throws before any `payments` row exists.
 * Neither is listed by `deposits-awaiting-confirmation`, so the page has no
 * button for them and the provider's retry stays the only way back. Hence:
 * « if a payment awaits your confirmation, a button…; otherwise… », and a CTA
 * that names the page (« Voir mes moyens de paiement »), never a promise
 * (« Confirmer mon paiement » would lie in exactly those cases).
 *
 * The job is NOT cancelled and the tone must not suggest it is: the assignment
 * is committed (T4), the provider holds the job, and only the money is stuck.
 */
export type DepositFailedClientEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /**
   * Absolute URL of the client's payment-methods screen, built from
   * WEB_APP_BASE_URL + `/account/payment-methods`.
   *
   * ⚠️ IT POINTED AT `/requests` UNTIL 5.1, AND THAT WAS THE BUG. The message
   * asks for exactly one thing — update the payment method — and the button
   * under it opened a list of requests, on which nothing about a card can be
   * done. The one action the client is able to take must land on the screen
   * that performs it; anything else turns the only useful email of the deposit
   * failure into a dead end.
   */
  paymentMethodsUrl: string;
};

type DepositFailedClientCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  reassurance: string;
  action: string;
  cta: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * NO Stripe decline reason is ever shown. `failure_reason` is a raw API string
 * ("Your card was declined.", "No such PaymentMethod: pm_…"), untranslated and
 * sometimes an internal identifier. The client is told WHAT to do, not what
 * Stripe said.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, DepositFailedClientCopy> = {
  'fr-CA': {
    subject: 'Linkr — votre acompte n’a pas pu être prélevé',
    heading: 'Votre acompte n’a pas pu être prélevé',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Le prélèvement de l’acompte pour votre demande « ${requestTitle} » n’a pas abouti.`,
    reassurance:
      'Votre demande reste active et le prestataire conserve le mandat. Seul le paiement est en attente.',
    action:
      'Ouvrez la page de vos moyens de paiement. Si un paiement attend votre confirmation, un bouton vous permettra de le régler ; votre banque peut demander une vérification. Sinon, vérifiez votre carte : le prestataire relancera ensuite le prélèvement.',
    cta: 'Voir mes moyens de paiement',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your deposit could not be charged',
    heading: 'Your deposit could not be charged',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `The deposit for your request "${requestTitle}" could not be charged.`,
    reassurance:
      'Your request is still active and the provider still holds the job. Only the payment is pending.',
    action:
      'Open your payment methods page. If a payment is awaiting your confirmation, a button will let you complete it; your bank may ask you to verify it. Otherwise, check your card: the provider will then re-attempt the charge.',
    cta: 'View my payment methods',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The deposit-failed email, client half.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const depositFailedClientEmail = (
  vars: DepositFailedClientEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const text = [
    copy.heading,
    '',
    copy.greeting(vars.firstName),
    '',
    copy.intro(vars.requestTitle),
    '',
    copy.reassurance,
    '',
    copy.action,
    '',
    vars.paymentMethodsUrl,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.paymentMethodsUrl);

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.greeting(vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro(vars.requestTitle))}</p>`,
    `<p>${escapeHtml(copy.reassurance)}</p>`,
    `<p>${escapeHtml(copy.action)}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
