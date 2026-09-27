import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email the provider whose quote was SELECTED receives.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THIN, and — deliberately — NOTHING ABOUT THE DEPOSIT. Same reasoning as
 * `request-accepted`: the assignment is committed whatever the card did (T4,
 * behind #96 and #108), so this email is sent on a 200 AND on a 202. When the
 * capture failed, the provider gets `deposit-failed-provider` as well, which
 * carries the caution; saying anything about money here would contradict it on
 * the success path or duplicate it on the failure path.
 *
 * No amount either: the provider wrote the quote and knows it.
 */
export type QuoteAcceptedEmailVars = {
  /** Provider owner's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /**
   * Absolute URL of the provider dashboard, built from WEB_APP_BASE_URL.
   * Carries `?onglet=jobs`: the request is now ASSIGNED, which is exactly what
   * the default tab (« En attente », OPEN only) filters out. The slug is
   * quasi-immutable — see `_components/dashboard-tabs.tsx`.
   */
  dashboardUrl: string;
};

type QuoteAcceptedCopy = {
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
 * Vouvoiement, provider vocabulary (« mandat »).
 */
const COPY: Record<Locale, QuoteAcceptedCopy> = {
  'fr-CA': {
    subject: 'Linkr — votre devis a été retenu',
    heading: 'Votre devis a été retenu',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) => `Votre devis pour « ${requestTitle} » a été retenu.`,
    cta: 'Voir mes jobs',
    detail: "Le mandat se trouve désormais dans l'onglet « Mes jobs » de votre espace pro.",
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your quote was selected',
    heading: 'Your quote was selected',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) => `Your quote for "${requestTitle}" was selected.`,
    cta: 'View my jobs',
    detail: 'The job is now in the jobs tab of your pro space.',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The quote-accepted email.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const quoteAcceptedEmail = (
  vars: QuoteAcceptedEmailVars,
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
