import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a client receives when the provider marks the job done.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THE ONLY TEMPLATE THAT ANNOUNCES A DEADLINE. From this moment the
 * auto-release cron counts down: if the client neither confirms nor contests,
 * the balance is captured and the right to contest is gone. Email is the one
 * channel that reaches a client who never reopens the app, so the delay is
 * NAMED here — unlike the screen, which says "après le délai prévu" because
 * `PLATFORM_AUTO_RELEASE_HOURS` never reaches the front. No mirror is created:
 * the value is read from config at send time, on the API side.
 *
 * "environ" is deliberate: the cron runs hourly and may lag, so the release
 * happens AT THE EARLIEST after the delay, never exactly on it.
 *
 * Otherwise thin: no amount, no balance, no provider name (same reasons as
 * request-accepted). The link leads to `CompletionActions`, which exist.
 */
export type JobCompletedEmailVars = {
  /** Client's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /** PLATFORM_AUTO_RELEASE_HOURS, read from config — never hard-coded. */
  autoReleaseHours: number;
  /** Absolute URL of the client's requests list, built from WEB_APP_BASE_URL. */
  requestsUrl: string;
};

type JobCompletedCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  deadline: (hours: number) => string;
  cta: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * The noun agrees with the number: the Joi schema allows 1 as a minimum, and
 * "1 heures" would ship otherwise. French treats 0 and 1 as singular; the
 * value cannot be 0 here, but the rule is written the French way anyway.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, JobCompletedCopy> = {
  'fr-CA': {
    subject: 'Linkr — votre prestataire a terminé le travail',
    heading: 'Le travail est terminé',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Votre prestataire indique avoir terminé le travail pour votre demande « ${requestTitle} ».`,
    deadline: (hours) =>
      `Vous disposez d'environ ${hours} ${hours < 2 ? 'heure' : 'heures'} pour confirmer ou signaler un problème, après quoi le paiement sera versé automatiquement.`,
    cta: 'Confirmer ou signaler un problème',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — your provider has finished the job',
    heading: 'The job is done',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `Your provider reports having finished the job for your request "${requestTitle}".`,
    deadline: (hours) =>
      `You have about ${hours} ${hours === 1 ? 'hour' : 'hours'} to confirm or report a problem, after which the payment will be released automatically.`,
    cta: 'Confirm or report a problem',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The job-completed email.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const jobCompletedEmail = (
  vars: JobCompletedEmailVars,
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
    copy.deadline(vars.autoReleaseHours),
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
    // The deadline is the point of this email — body colour, not muted grey.
    `<p>${escapeHtml(copy.deadline(vars.autoReleaseHours))}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
