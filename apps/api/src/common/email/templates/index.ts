import { probeEmail } from './probe.template';

/**
 * The template registry.
 *
 * `as const` is what turns an unknown template name into a COMPILE error at
 * the call site (see EmailService.send) instead of a runtime surprise found
 * three days later in a log — assuming anyone was reading the log.
 */
export const EMAIL_TEMPLATES = {
  probe: probeEmail,
} as const;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;

/**
 * The vars the named template requires, derived from the function itself: a
 * template that gains a field breaks its callers at compile time rather than
 * rendering `undefined` into a message somebody receives.
 */
export type EmailTemplateVars<TName extends EmailTemplateName> = Parameters<
  (typeof EMAIL_TEMPLATES)[TName]
>[0];

/**
 * Runtime re-narrowing for the worker. A payload that has crossed Redis is
 * plain JSON, so `template` arrives as a bare string and the compile-time
 * proof does not survive the trip — this is where it is re-established.
 */
export function isEmailTemplateName(value: string): value is EmailTemplateName {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value);
}

export type { ProbeEmailVars } from './probe.template';
