import { escapeHtml } from './escape';
import { greet } from './sanitize';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email-verification email (mandate L1).
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars`.
 */
export type EmailVerificationEmailVars = {
  /** Recipient's first name, cleaned by `greet()` at render time. */
  firstName: string;
  /** Absolute URL, token included: WEB_APP_BASE_URL + /verify-email?token=… */
  verifyUrl: string;
  /** Whole hours the link stays valid, so the copy cannot drift from the TTL. */
  expiresInHours: number;
};

type EmailVerificationCopy = {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  expiry: (hours: number) => string;
  fallbackLead: string;
  ignore: string;
  signoff: string;
};

/**
 * Fixed copy, no free text from any account beyond the cleaned first name.
 * Vouvoiement. The `ignore` line is the mandate's: someone who did not sign up
 * can simply ignore this mail.
 */
const COPY: Record<Locale, EmailVerificationCopy> = {
  'fr-CA': {
    subject: 'Linkr — confirmez votre adresse courriel',
    heading: 'Confirmez votre adresse courriel',
    intro:
      "Un compte Linkr vient d'être créé avec cette adresse. Cliquez sur le lien ci-dessous pour confirmer qu'elle vous appartient.",
    cta: 'Confirmer mon adresse',
    expiry: (hours) =>
      `Ce lien est valide ${hours} heures et ne peut servir qu'une seule fois.`,
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    ignore:
      "Si vous ne vous êtes pas inscrit à Linkr, vous pouvez ignorer ce message : l'adresse ne sera pas confirmée.",
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — confirm your email address',
    heading: 'Confirm your email address',
    intro:
      'A Linkr account was just created with this address. Use the link below to confirm that it belongs to you.',
    cta: 'Confirm my address',
    expiry: (hours) =>
      `This link is valid for ${hours} hours and can only be used once.`,
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    ignore:
      'If you did not sign up for Linkr, you can ignore this message — the address will not be confirmed.',
    signoff: '— Linkr',
  },
};

/**
 * The email-verification email.
 *
 * ⚠️ THE RAW TOKEN IS INSIDE `verifyUrl`; the database holds only its SHA-256.
 * Nothing here may be logged (EmailService never logs `vars`).
 */
export const emailVerificationEmail = (
  vars: EmailVerificationEmailVars,
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
    vars.verifyUrl,
    '',
    copy.expiry(vars.expiresInHours),
    '',
    copy.ignore,
    '',
    copy.signoff,
  ].join('\n');

  const safeUrl = escapeHtml(vars.verifyUrl);

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading)}</h1>`,
    `<p>${escapeHtml(greet(locale, vars.firstName))}</p>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.expiry(vars.expiresInHours))}</p>`,
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.ignore)}</p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
