import { escapeHtml } from './escape';
import { clipTitle, greet } from './sanitize';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a client receives when the targeted provider declines.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * No provider-written text is rendered. The provider's reply (`reason`) used to be
 * printed here; it is a free-text field from another account sent to an address
 * nobody has confirmed, so the email only says that the provider replied and
 * points to the application.
 */
export type RequestDeclinedEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /** Absolute URL of the client's requests list, built from WEB_APP_BASE_URL. */
  requestsUrl: string;
};

type RequestDeclinedCopy = {
  subject: string;
  heading: string;
  intro: (requestTitle: string) => string;
  replied: string;
  nextStep: string;
  cta: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, RequestDeclinedCopy> = {
  'fr-CA': {
    subject: 'Linkr — votre demande n’a pas été retenue',
    heading: 'Votre demande n’a pas été retenue',
    intro: (requestTitle) =>
      `Le prestataire que vous aviez choisi ne peut pas prendre votre demande « ${requestTitle} ».`,
    replied:
      'Le prestataire a répondu à votre demande. Vous pouvez consulter sa réponse dans l’application.',
    nextStep:
      'Votre demande reste disponible : vous pouvez en adresser une nouvelle à un autre prestataire.',
    cta: 'Voir mes demandes',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your request was not taken',
    heading: 'Your request was not taken',
    intro: (requestTitle) =>
      `The provider you picked cannot take your request "${requestTitle}".`,
    replied:
      'The provider replied to your request. You can read the reply in the application.',
    nextStep:
      'You can send a new request to another provider whenever you are ready.',
    cta: 'View my requests',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The request-declined email. The title is clipped and escaped; no free text
 * from the provider is ever rendered.
 */
export const requestDeclinedEmail = (
  vars: RequestDeclinedEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const text = [
    copy.heading,
    '',
    greet(locale, vars.firstName),
    '',
    copy.intro(clipTitle(vars.requestTitle)),
    '',
    copy.replied,
    '',
    copy.nextStep,
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
    `<p>${escapeHtml(greet(locale, vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro(clipTitle(vars.requestTitle)))}</p>`,
    `<p>${escapeHtml(copy.replied)}</p>`,
    `<p>${escapeHtml(copy.nextStep)}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
