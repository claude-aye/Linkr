import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a CLIENT receives when the auto-release cron could not
 * charge the 80% balance, and that balance now awaits their own confirmation.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ ONE RECIPIENT, ONE MOMENT. Unlike `deposit-failed-*`, the provider gets
 * nothing: they have no button on a balance, and their work is done. And the
 * email leaves ONCE, from the cron, at the real transition (no BALANCE row
 * before the pass, a row awaiting the client after it — see
 * `ServiceRequestsService.runAutoReleaseCheck`). A client who confirmed the
 * job themselves got a 202 on screen and was sent to the payment page at once:
 * they get no email.
 *
 * ⚠️ WHEN THIS LEAVES, THE PAGE HAS A BUTTON. The cron only mails when the row
 * awaits the client (FAILED or REQUIRES_ACTION WITH a PaymentIntent), which is
 * exactly what `/account/payment-methods` lists — so, unlike the deposit
 * email, the copy can say « confirm the payment there ». The CTA still names
 * the PAGE, not the action (same rule as D1): between the send and the click,
 * the request may have been contested or settled, and a button labelled
 * « Confirmer mon paiement » would then lie.
 *
 * The two causes (3-D Secure demanded on every payment, a declined card) leave
 * the same intent state and cannot be told apart; the copy covers both, and
 * the gesture is the same.
 */
export type BalanceFailedClientEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /**
   * Absolute URL of the client's payment-methods screen, built from
   * WEB_APP_BASE_URL + `/account/payment-methods` — the quasi-immutable path
   * (CLAUDE.md §13.1 nº 19 (a)) where the balance is listed with its button.
   */
  paymentMethodsUrl: string;
};

type BalanceFailedClientCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  consequence: string;
  action: string;
  cta: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * NO Stripe decline reason and NO amount: the client is told WHAT to do, not
 * what Stripe said, and the page shows the amount next to the button.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, BalanceFailedClientCopy> = {
  'fr-CA': {
    subject: 'Linkr — le paiement du solde attend votre confirmation',
    heading: 'Le paiement du solde attend votre confirmation',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Le délai de confirmation des travaux pour votre demande « ${requestTitle} » est écoulé, mais le prélèvement automatique du solde n’a pas abouti : votre banque demande que vous confirmiez ce paiement, ou votre carte a été refusée.`,
    consequence:
      'Tant que ce paiement n’est pas confirmé, le prestataire n’est pas payé pour son travail.',
    action:
      'Ouvrez la page de vos moyens de paiement et cliquez sur « Confirmer le paiement » ; votre banque peut vous demander une vérification. Si votre carte a été refusée, enregistrez d’abord une autre carte par défaut.',
    cta: 'Voir mes moyens de paiement',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your balance payment awaits your confirmation',
    heading: 'Your balance payment awaits your confirmation',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `The confirmation period for the work on your request "${requestTitle}" has ended, but the automatic charge of the balance did not go through: your bank wants you to confirm this payment, or your card was declined.`,
    consequence:
      'Until this payment is confirmed, the provider is not paid for their work.',
    action:
      // The web is French-only: the button is named as it is actually labelled.
      'Open your payment methods page and click "Confirmer le paiement" (confirm the payment); your bank may ask you to verify it. If your card was declined, first save another card as your default.',
    cta: 'View my payment methods',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The balance-failed email (client only).
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const balanceFailedClientEmail = (
  vars: BalanceFailedClientEmailVars,
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
    copy.consequence,
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
    `<p>${escapeHtml(copy.consequence)}</p>`,
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
