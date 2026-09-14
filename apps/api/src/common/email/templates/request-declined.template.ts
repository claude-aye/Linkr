import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a client receives when the targeted provider declines.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THE ONE TEMPLATE THAT CARRIES USER-WRITTEN PROSE. Every other template
 * here passes only a title and a link; this one passes `reason`, free text a
 * provider typed. That is deliberate: a refusal without a reason is a cold
 * event for someone who was waiting, and the provider wrote that sentence
 * precisely so the client would read it. It is not internal data like an
 * amount or an address.
 *
 * Two guards come with it, and neither is optional:
 *   - escaped like everything else (`escapeHtml`), and
 *   - capped at REASON_MAX_CHARS, because nothing upstream limits how much
 *     somebody can type into that box.
 *
 * `reason` is absent when the provider gave none. The service does NOT pass the
 * `'Refusé par le prestataire'` default that lands in `cancellation_reason` —
 * printing it under a heading that already says the request was declined would
 * be noise dressed as information.
 */
export type RequestDeclinedEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /** The provider's own words, when they wrote any. */
  reason?: string;
  /** Absolute URL of the client's requests list, built from WEB_APP_BASE_URL. */
  requestsUrl: string;
};

/** Long enough for a real explanation, short enough to stay an email. */
const REASON_MAX_CHARS = 300;

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max).trimEnd()}…`;

type RequestDeclinedCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  reasonLabel: string;
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
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Le prestataire que vous aviez choisi ne peut pas prendre votre demande « ${requestTitle} ».`,
    reasonLabel: 'Sa réponse :',
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
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `The provider you picked cannot take your request "${requestTitle}".`,
    reasonLabel: 'Their reply:',
    nextStep:
      'You can send a new request to another provider whenever you are ready.',
    cta: 'View my requests',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The request-declined email.
 *
 * Both `requestTitle` and `reason` are user-supplied and escaped; `reason` is
 * capped as well.
 */
export const requestDeclinedEmail = (
  vars: RequestDeclinedEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const reason = vars.reason?.trim()
    ? truncate(vars.reason.trim(), REASON_MAX_CHARS)
    : null;

  const text = [
    copy.heading,
    '',
    copy.greeting(vars.firstName),
    '',
    copy.intro(vars.requestTitle),
    ...(reason ? ['', `${copy.reasonLabel} ${reason}`] : []),
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
    `<p>${escapeHtml(copy.greeting(vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro(vars.requestTitle))}</p>`,
    ...(reason
      ? [
          `<p style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #e4e4e7; color: #3f3f46;"><strong>${escapeHtml(copy.reasonLabel)}</strong><br />${escapeHtml(reason)}</p>`,
        ]
      : []),
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
