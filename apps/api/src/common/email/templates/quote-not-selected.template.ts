import { escapeHtml } from './escape';
import { greet } from './sanitize';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email every OTHER provider receives when the client selects a
 * different quote on a call for tenders.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ SENT ONLY TO THE QUOTES THIS ACCEPT ACTUALLY REJECTED — the SUBMITTED ones
 * `rejectSiblings` flipped to REJECTED in the same transaction. A provider who
 * already withdrew, or whose quote expired, is not told "the client chose
 * someone else": they had already left the race.
 *
 * ⚠️ THIN, and no winning amount, no winner's name: telling the losers what
 * won would publish another provider's price.
 *
 * The link goes to the calls-for-tenders tab, not to a dead end: the useful
 * next step for a provider who was not selected is the next opportunity.
 */
export type QuoteNotSelectedEmailVars = {
  /** Provider owner's first name, for the greeting. */
  firstName: string;
  /**
   * Absolute URL of the provider dashboard, built from WEB_APP_BASE_URL, on the
   * `?onglet=appels-offres` tab. Quasi-immutable — see
   * `_components/dashboard-tabs.tsx`.
   */
  dashboardUrl: string;
};

type QuoteNotSelectedCopy = {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  detail: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * "peut-être" is load-bearing: nothing guarantees an open tender matches this
 * provider right now, and the copy must not promise one.
 */
const COPY: Record<Locale, QuoteNotSelectedCopy> = {
  'fr-CA': {
    subject: 'Linkr — une autre offre a été retenue',
    heading: 'Une autre offre a été retenue',
    intro: "Le client a retenu une autre offre pour une demande de service.",
    cta: "Voir les appels d'offres",
    detail:
      "Merci d'avoir répondu. D'autres appels d'offres correspondant à vos métiers vous attendent peut-être.",
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — another offer was selected',
    heading: 'Another offer was selected',
    intro: "The client selected another offer for a service request.",
    cta: 'View calls for tenders',
    detail:
      'Thank you for responding. Other calls for tenders matching your trades may be waiting for you.',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The quote-not-selected email.
 *
 * No request title is rendered: a title is written by another account and the
 * address it goes to is never confirmed, so the intro uses a fixed phrase.
 */
export const quoteNotSelectedEmail = (
  vars: QuoteNotSelectedEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const text = [
    copy.heading,
    '',
    greet(locale, vars.firstName),
    '',
    copy.intro,
    '',
    vars.dashboardUrl,
    '',
    copy.detail,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.dashboardUrl);

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(greet(locale, vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
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
