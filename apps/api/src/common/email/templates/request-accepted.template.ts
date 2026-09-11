import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a client receives when a provider takes their job.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THIN, like every template here: first name, title, link. No provider name,
 * no address, no amount, and — deliberately — NOTHING ABOUT THE DEPOSIT.
 *
 * The deposit is a separate matter from the assignment: that is the whole point
 * of the T4 decision behind #96. An accept whose capture failed is still an
 * accept, and the job IS the provider's. Saying otherwise here would recreate,
 * in an inbox, the confusion the API stopped producing.
 *
 * There is also nothing useful the client could do about it. The deposit is
 * taken from THEIR card, but `retry-deposit` requires the assigned worker, so a
 * client told "your deposit failed" has no gesture available. That asymmetry is
 * tracked as product debt in CLAUDE.md; until it is resolved, worrying the
 * client without an exit is worse than silence.
 *
 * The provider's name is left out too — not for privacy, but to avoid a second
 * resolution path (an ORGANIZATION provider has a null `businessName` and no
 * owner to fall back on). The dashboard shows who took the job.
 */
export type RequestAcceptedEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /** Absolute URL of the client's requests list, built from WEB_APP_BASE_URL. */
  requestsUrl: string;
};

type RequestAcceptedCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  cta: string;
  detail: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, RequestAcceptedCopy> = {
  'fr-CA': {
    subject: 'Linkr — votre demande a été acceptée',
    heading: 'Votre demande a été acceptée',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Un prestataire vient d'accepter votre demande « ${requestTitle} ».`,
    cta: 'Voir ma demande',
    detail:
      'Le détail de la demande et la suite des étapes se trouvent dans vos demandes.',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your request was accepted',
    heading: 'Your request was accepted',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `A provider just accepted your request "${requestTitle}".`,
    cta: 'View my request',
    detail: 'The details and next steps are in your requests.',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The request-accepted email.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const requestAcceptedEmail = (
  vars: RequestAcceptedEmailVars,
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
    vars.requestsUrl,
    '',
    copy.detail,
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
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.detail)}</p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
