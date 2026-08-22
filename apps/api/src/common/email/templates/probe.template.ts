import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the probe email.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts. That rule applies to every template's vars.
 */
export type ProbeEmailVars = {
  /** Free-form label echoed in the body, so two probe runs can be told apart. */
  label: string;
  /** ISO-8601 instant the probe was enqueued, rendered as-is. */
  enqueuedAtUtc: string;
};

type ProbeCopy = {
  subject: string;
  heading: string;
  intro: string;
  labelLead: string;
  enqueuedLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale.
 *
 * `Record<Locale, ProbeCopy>` rather than several `Record<Locale, string>`:
 * exhaustive on the locales AND on the keys of each locale, so a half-written
 * translation is a build error rather than an `undefined` interpolated into a
 * subject line.
 */
const COPY: Record<Locale, ProbeCopy> = {
  'fr-CA': {
    subject: 'Linkr — courriel de vérification',
    heading: 'Le socle courriel fonctionne',
    intro:
      "Ce message a été produit par le socle d'envoi de Linkr. Si vous le lisez, la mise en file, le rendu du gabarit et le transport SMTP fonctionnent tous les trois.",
    labelLead: 'Repère',
    enqueuedLead: 'Mis en file (UTC)',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — probe email',
    heading: 'The email foundation works',
    intro:
      "This message was produced by Linkr's outbound email foundation. If you are reading it, queueing, template rendering and SMTP transport all work.",
    labelLead: 'Label',
    enqueuedLead: 'Enqueued (UTC)',
    signoff: '— Linkr',
  },
};

/**
 * The probe email: no business meaning, its only job is to prove the chain end
 * to end without a route, a controller or a domain event.
 */
export const probeEmail = (
  vars: ProbeEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const text = [
    copy.heading,
    '',
    copy.intro,
    '',
    `${copy.labelLead} : ${vars.label}`,
    `${copy.enqueuedLead} : ${vars.enqueuedAtUtc}`,
    '',
    copy.signoff,
  ].join('\n');

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    '<ul>',
    `<li>${escapeHtml(copy.labelLead)} : <strong>${escapeHtml(vars.label)}</strong></li>`,
    `<li>${escapeHtml(copy.enqueuedLead)} : <code>${escapeHtml(vars.enqueuedAtUtc)}</code></li>`,
    '</ul>',
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
