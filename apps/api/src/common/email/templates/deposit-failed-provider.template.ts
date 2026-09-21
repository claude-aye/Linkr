import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the email a PROVIDER receives when the client's deposit failed.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars` in
 * ./types.ts.
 *
 * ⚠️ THIS EMAIL EXISTS TO PROTECT THE PROVIDER, AND TO CLOSE THE LOOP. Two
 * reasons, both load-bearing:
 *   1. Money. The provider holds a committed assignment and may buy materials
 *      or drive out believing the deposit is secured. It is not.
 *   2. Deadlock. The client can fix their card but CANNOT retry — `retryDeposit`
 *      is guarded by the assignment. If nobody tells the provider to come back
 *      and press retry, the request stays ASSIGNED with a FAILED deposit
 *      forever, which is exactly the dead end #96 set out to remove.
 *
 * ⚠️ IT TELLS THEM TO WAIT, NOT TO RETRY NOW — deliberately. Both emails leave
 * in the same second, so at the moment this one is read the client has not even
 * opened theirs. An immediate retry is a guaranteed failure: the same card, the
 * same decline, a 502 in their face, and a provider who concludes the platform
 * is broken. "Wait, then retry" also sets the right mental model: the ball is
 * in the client's court.
 *
 * There is NO notification when the client fixes their card — that event is not
 * in EVENT_CHANNELS and is tracked as debt. Asynchronous retry is the only way
 * back, which is precisely why the copy says "quelques heures" rather than
 * naming a moment we cannot know.
 */
export type DepositFailedProviderEmailVars = {
  /** Provider owner's first name, for the greeting. */
  firstName: string;
  /** The request title, so the message is recognisable at a glance. */
  requestTitle: string;
  /**
   * Absolute URL of the provider dashboard, built from WEB_APP_BASE_URL.
   * Carries `?onglet=jobs`: the retry button lives on the « Mes jobs » tab,
   * and an ASSIGNED request is precisely what the default tab filters out.
   */
  dashboardUrl: string;
};

type DepositFailedProviderCopy = {
  subject: string;
  heading: string;
  greeting: (firstName: string) => string;
  intro: (requestTitle: string) => string;
  clientNotified: string;
  caution: string;
  cta: string;
  fallbackLead: string;
  signoff: string;
};

/**
 * Copy, local to this file and keyed by locale — exhaustive on the locales AND
 * on each locale's keys, so a half-written translation is a build error.
 *
 * NO Stripe decline reason here either: it is the client's banking business,
 * and forwarding it to the provider would leak what a counterparty's card did.
 *
 * Vouvoiement, per the project-wide convention.
 */
const COPY: Record<Locale, DepositFailedProviderCopy> = {
  'fr-CA': {
    subject: 'Linkr — l’acompte de votre mandat n’est pas sécurisé',
    heading: 'L’acompte n’a pas pu être prélevé',
    greeting: (firstName) => `Bonjour ${firstName},`,
    intro: (requestTitle) =>
      `Le prélèvement de l’acompte pour la demande « ${requestTitle} » n’a pas abouti. Le mandat vous reste attribué.`,
    clientNotified:
      'Le client vient d’être invité à mettre à jour son moyen de paiement. Patientez quelques heures avant de tenter une relance depuis votre tableau de bord.',
    caution:
      'Attendez la confirmation de l’acompte avant d’engager des frais ou de commencer les travaux.',
    cta: 'Voir la demande sur mon tableau de bord',
    fallbackLead:
      'Si le lien ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    signoff: '— Linkr',
  },
  'en-CA': {
    subject: 'Linkr — the deposit on your job is not secured',
    heading: 'The deposit could not be charged',
    greeting: (firstName) => `Hello ${firstName},`,
    intro: (requestTitle) =>
      `The deposit for the request "${requestTitle}" could not be charged. The job is still yours.`,
    clientNotified:
      'The client has just been asked to update their payment method. Please wait a few hours before re-attempting the charge from your dashboard.',
    caution:
      'Wait for the deposit to be confirmed before incurring any costs or starting the work.',
    cta: 'View the request on my dashboard',
    fallbackLead: 'If the link does not work, copy this address into your browser:',
    signoff: '— Linkr',
  },
};

/**
 * The deposit-failed email, provider half.
 *
 * `requestTitle` is user-supplied text and is escaped like everything else.
 */
export const depositFailedProviderEmail = (
  vars: DepositFailedProviderEmailVars,
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
    copy.clientNotified,
    '',
    copy.caution,
    '',
    vars.dashboardUrl,
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
    `<p>${escapeHtml(copy.clientNotified)}</p>`,
    // The money warning is the point of this email — body colour, not muted.
    `<p>${escapeHtml(copy.caution)}</p>`,
    `<p><a href="${safeUrl}" style="display: inline-block; background: #18181b; color: #fafafa; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${escapeHtml(copy.cta)}</a></p>`,
    `<p style="color: #71717a; font-size: 12px;">${escapeHtml(copy.fallbackLead)}<br /><span style="word-break: break-all;">${safeUrl}</span></p>`,
    `<p style="color: #71717a;">${escapeHtml(copy.signoff)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject, html, text };
};
