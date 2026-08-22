/**
 * Locales every template must render. Adding one here breaks every template at
 * compile time until its copy exists — which is the point: a missing string is
 * a build error, never a silent fallback to another language.
 */
export type Locale = 'fr-CA' | 'en-CA';

/**
 * Quebec first. There is NO `locale` column on `users` and nothing reads a
 * stored preference, so every send lands here until one exists.
 */
export const DEFAULT_LOCALE: Locale = 'fr-CA';

/**
 * What every template returns. `text` is NOT optional: an email without a
 * plain-text part is treated as spam by most receivers.
 */
export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Variables handed to a template.
 *
 * ⚠️ A template's vars type must be declared as a `type` alias, never an
 * `interface`. TypeScript gives object type aliases an implicit index
 * signature and denies one to interfaces, so an interface would not be
 * assignable to this and the enqueue would need a cast. Switching one to an
 * interface breaks the build loudly — it does not degrade quietly.
 */
export type EmailVars = Record<string, unknown>;

/**
 * Shape every template function satisfies: pure, synchronous, no engine, no
 * build step. `(vars, locale) => { subject, html, text }`.
 */
export type EmailTemplate<TVars extends EmailVars> = (
  vars: TVars,
  locale?: Locale,
) => RenderedEmail;
