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
 * guarded by the assignment and only the assigned worker may call it. So this
 * email asks for exactly one thing, the thing the client can actually do:
 * update the payment method. It must NOT promise that the charge will then go
 * through by itself — the provider still has to press retry. See
 * deposit-failed-provider.template.ts for the other half.
 *
 * The job is NOT cancelled and the tone must not suggest it is: the assignment
 * is committed (T4), the provider holds the job, and only the money is stuck.
 */
export type DepositFailedClientEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /** Absolute URL of the client's requests list, built from WEB_APP_BASE_URL. */
  requestsUrl: string;
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
      'Vérifiez votre moyen de paiement et mettez-le à jour au besoin. Le prestataire pourra ensuite relancer le prélèvement.',
    cta: 'Mettre à jour mon moyen de paiement',
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
      'Please check your payment method and update it if needed. The provider can then re-attempt the charge.',
    cta: 'Update my payment method',
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
    vars.requestsUrl,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.requestsUrl);

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
