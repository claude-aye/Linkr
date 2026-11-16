import { escapeHtml } from './escape';
import { DEFAULT_LOCALE, Locale, RenderedEmail } from './types';

/**
 * Vars for the operator quota alert (mandate J).
 *
 * ⚠️ NO PERSONAL DATA, by construction: counters, a clock reading and the
 * environment name. No account id, no address, no IP — the fields below are
 * the whole payload, and the template is the only place they are rendered.
 *
 * Declared as a `type`, not an `interface` — see the note on `EmailVars`.
 */
export type OpsAlertEmailVars = {
  trigger: 'noon-threshold' | 'saturation';
  /** Global confirmation sends counted today. */
  count: number;
  /** Global daily cap. */
  cap: number;
  /** Resend sub-counter, or null when it could not be read. */
  resends: number | null;
  /** Resend sub-cap. */
  resendCap: number;
  /** Toronto clock reading, already formatted by the caller. */
  torontoTime: string;
  environment: string;
};

type OpsAlertCopy = {
  subject: Record<OpsAlertEmailVars['trigger'], string>;
  heading: Record<OpsAlertEmailVars['trigger'], string>;
  lines: {
    total: string;
    resends: string;
    unknown: string;
    time: string;
    environment: string;
  };
  action: string;
};

const COPY: Record<Locale, OpsAlertCopy> = {
  'fr-CA': {
    subject: {
      'noon-threshold': '[Linkr] Quota de confirmation : seuil de midi',
      saturation: '[Linkr] Quota de confirmation : saturation',
    },
    heading: {
      'noon-threshold':
        "Plus de 30 envois de confirmation avant midi : le plafond du jour sera probablement atteint (souvent un script).",
      saturation:
        'Le plafond quotidien des envois de confirmation est atteint : les demandes de confirmation répondent 503 jusqu\'à minuit.',
    },
    lines: {
      total: 'Envois de confirmation (total / plafond)',
      resends: 'Renvois (compteur / plafond)',
      unknown: 'inconnu',
      time: 'Heure de Toronto',
      environment: 'Environnement',
    },
    action: 'À faire : consulter docs/deploy/arret-urgence.md.',
  },
  'en-CA': {
    subject: {
      'noon-threshold': '[Linkr] Confirmation quota: noon threshold',
      saturation: '[Linkr] Confirmation quota: saturation',
    },
    heading: {
      'noon-threshold':
        'More than 30 confirmation sends before noon: the daily cap will likely be reached (often a script).',
      saturation:
        'The daily cap on confirmation sends is reached: confirmation requests answer 503 until midnight.',
    },
    lines: {
      total: 'Confirmation sends (total / cap)',
      resends: 'Resends (counter / cap)',
      unknown: 'unknown',
      time: 'Toronto time',
      environment: 'Environment',
    },
    action: 'Next step: see docs/deploy/arret-urgence.md.',
  },
};

export const opsAlertEmail = (
  vars: OpsAlertEmailVars,
  locale: Locale = DEFAULT_LOCALE,
): RenderedEmail => {
  const copy = COPY[locale];
  const resends =
    vars.resends === null ? copy.lines.unknown : `${vars.resends} / ${vars.resendCap}`;
  const rows: Array<[string, string]> = [
    [copy.lines.total, `${vars.count} / ${vars.cap}`],
    [copy.lines.resends, resends],
    [copy.lines.time, vars.torontoTime],
    [copy.lines.environment, vars.environment],
  ];

  const text = [
    copy.heading[vars.trigger],
    '',
    ...rows.map(([k, v]) => `${k} : ${v}`),
    '',
    copy.action,
  ].join('\n');

  const html = [
    '<!doctype html>',
    `<html lang="${locale}">`,
    '<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #18181b;">',
    `<h1 style="font-size: 18px;">${escapeHtml(copy.heading[vars.trigger])}</h1>`,
    '<ul>',
    ...rows.map(([k, v]) => `<li>${escapeHtml(k)} : <strong>${escapeHtml(v)}</strong></li>`),
    '</ul>',
    `<p style="color: #71717a;">${escapeHtml(copy.action)}</p>`,
    '</body>',
    '</html>',
  ].join('\n');

  return { subject: copy.subject[vars.trigger], html, text };
};
