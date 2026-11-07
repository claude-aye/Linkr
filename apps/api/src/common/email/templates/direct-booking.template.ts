import { escapeHtml } from './escape';
import { greet } from './sanitize';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the direct-booking email sent to a provider.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ DELIBERATELY THIN. No client name, no address, no estimated amount. An
 * inbox is forwarded, synced to third-party clients and kept in backups long
 * after the job is done; the job's details belong behind authentication. This
 * email's only purpose is to get the provider to open the dashboard. It also
 * means the copy cannot drift when the provider DTO changes — which it did
 * twice already.
 */
export type DirectBookingEmailVars = {
  /** Provider owner's first name, for the greeting. */
  firstName: string;
  /** Absolute dashboard URL, built from WEB_APP_BASE_URL. */
  dashboardUrl: string;
};

type DirectBookingCopy = {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  deadline: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, DirectBookingCopy> = {
  'fr-CA': {
    subject: 'Linkr — une nouvelle demande vous a été adressée',
    heading: 'Une nouvelle demande vous attend',
    intro: "Un client vous a choisi directement pour une demande de service.",
    cta: 'Voir la demande',
    deadline:
      'Les détails, la période souhaitée et le prix estimé se trouvent sur votre tableau de bord.',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — a new request was sent to you',
    heading: 'A new request is waiting',
    intro: "A client picked you directly for a service request.",
    cta: 'View the request',
    deadline:
      'The details, the requested window and the estimated price are on your dashboard.',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The direct-booking email.
 *
 * No request title is rendered: a title is written by another account and the
 * address it goes to is never confirmed, so the intro uses a fixed phrase.
 */
export const directBookingEmail = (
  vars: DirectBookingEmailVars,
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
    copy.deadline,
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
    `<p style="color: #71717a;">${escapeHtml(copy.deadline)}</p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
