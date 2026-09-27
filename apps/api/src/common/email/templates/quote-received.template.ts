import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a CLIENT receives when a provider submits a quote on their
 * call for tenders. One email PER submitted quote.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THIN, like every template here: first name, title, link. No amount, no
 * provider name, no validity date. The comparison screen shows all of that,
 * side by side with the other offers — a single quote's amount in an inbox
 * invites judging it alone.
 *
 * No date on purpose, and not only by taste: the worker runs in UTC and the API
 * has no date formatter zoned to DISPLAY_TIME_ZONE (it lives in `apps/web`
 * only). A date rendered here would be off by a full civil day for any evening
 * instant. The debt is tracked in CLAUDE.md, to be paid the day an email needs
 * a date.
 */
export type QuoteReceivedEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /**
   * Absolute URL of the received-quotes page of THIS request
   * (`/requests/{id}/devis`), built from WEB_APP_BASE_URL. The page is where
   * the quote can be compared and accepted — the email leads to the control.
   */
  quotesUrl: string;
};

type QuoteReceivedCopy = {
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
 * Vouvoiement, per the project-wide convention. The subject stays fixed, like
 * every other template's: the user-written title lives in the body.
 */
const COPY: Record<Locale, QuoteReceivedCopy> = {
  'fr-CA': {
    subject: 'Linkr — vous avez reçu un devis',
    heading: 'Vous avez reçu un devis',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) => `Vous avez reçu un devis pour « ${requestTitle} ».`,
    cta: 'Voir les devis reçus',
    detail:
      'Comparez les devis reçus et retenez celui qui vous convient depuis la page de votre demande.',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — you received a quote',
    heading: 'You received a quote',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) => `You received a quote for "${requestTitle}".`,
    cta: 'View received quotes',
    detail:
      'Compare the quotes you received and choose the one that suits you from your request page.',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The quote-received email.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const quoteReceivedEmail = (
  vars: QuoteReceivedEmailVars,
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
    vars.quotesUrl,
    '',
    copy.detail,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.quotesUrl);

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
