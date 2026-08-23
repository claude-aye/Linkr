import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the password reset email.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts. That rule applies to every template's vars.
 */
export type PasswordResetEmailVars = {
  /** Recipient's first name, for the greeting. */
  firstName: string;
  /** Absolute reset URL, token included. Escaped before it reaches the HTML. */
  resetUrl: string;
  /** Whole minutes the link stays valid, so the copy cannot drift from A-2.3. */
  expiresInMinutes: number;
};

type PasswordResetCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: string;
  cta: string;
  /** Rendered with the figure so "60 minutes" is never hard-coded in prose. */
  expiry: (minutes: number) => string;
  fallbackLead: string;
  ignore: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale. `Record<Locale, PasswordResetCopy>`
 * is exhaustive on the locales AND on each locale's keys, so a half-written
 * translation is a build error rather than an `undefined` in a subject line.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, PasswordResetCopy> = {
  'fr-CA': {
    subject: 'Linkr — réinitialisation de votre mot de passe',
    heading: 'Réinitialisation de votre mot de passe',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro:
      'Vous avez demandé à réinitialiser votre mot de passe Linkr. Cliquez sur le lien ci-dessous pour en choisir un nouveau.',
    cta: 'Choisir un nouveau mot de passe',
    expiry: (minutes) =>
      `Ce lien est valide ${minutes} minutes et ne peut servir qu'une seule fois.`,
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    ignore:
      "Si vous n'avez pas fait cette demande, vous pouvez ignorer ce message : votre mot de passe reste inchangé.",
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — reset your password',
    heading: 'Reset your password',
    greeting: (firstName) => `Hello ${firstName},`,
    intro:
      'You asked to reset your Linkr password. Use the link below to choose a new one.',
    cta: 'Choose a new password',
    expiry: (minutes) =>
      `This link is valid for ${minutes} minutes and can only be used once.`,
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    ignore:
      'If you did not make this request, you can ignore this message — your password stays unchanged.',
    signoff: '— Linkr',
  },
};

/**
 * The password reset email.
 *
 * ⚠️ THE RAW TOKEN IS INSIDE `resetUrl`, AND THIS IS THE ONLY PLACE IT IS EVER
 * WRITTEN DOWN. The database holds only its SHA-256. Nothing here may be logged,
 * which is why `EmailService` logs the recipient and template name but never
 * `vars` — a log line is the one place a secret outlives every retention policy
 * written for the store it came from.
 *
 * The URL is escaped for the HTML body like any other var: a reset URL is
 * assembled from configuration and a base64url token, but escaping by habit is
 * what keeps the habit — `&` in a query string alone would otherwise produce
 * invalid markup.
 */
export const passwordResetEmail = (
  vars: PasswordResetEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];

  const text = [
    copy.heading,
    '',
    copy.greeting(vars.firstName),
    '',
    copy.intro,
    '',
    vars.resetUrl,
    '',
    copy.expiry(vars.expiresInMinutes),
    '',
    copy.ignore,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.resetUrl);

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(copy.greeting(vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.expiry(vars.expiresInMinutes))}</p>`,
    // Plenty of clients strip or rewrite buttons; the bare URL is the fallback.
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.ignore)}</p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
