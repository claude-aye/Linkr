/**
 * Shared class strings of the `(auth)` screens — direction A (R4).
 *
 * ⚠️ CLASS STRINGS ONLY: no JSX, no component, no `<form>` (CLAUDE.md §13.1
 * nº 24). The four screens keep their own markup, and above all their own
 * `<form method="post">`: the ESLint rule that enforces that attribute is
 * scoped to `src/app/(auth)/**\/*.tsx`, so a form moved into a shared component
 * would leave its reach without a single warning.
 *
 * Tokens only (CLAUDE.md §13.1 nº 20). The two state colours — red for errors,
 * emerald for the post-reset notice — are kept on purpose until state tokens
 * are arbitrated; they are the only palette classes left here.
 */

/** Visible focus ring on every control: bordeaux, offset on the beige ground. */
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The glass card — the screen's ONE `backdrop-filter` layer.
 *
 * OPAQUE BY DEFAULT, GLASS ONLY UNDER `@supports`. Where `backdrop-filter` is
 * unsupported, the translucent surface would let the halos show through
 * unblurred. So the base paints the surface over the opaque beige ground (a
 * one-colour gradient over `bg-bg`, which is what the glass looks like over a
 * plain ground — tokens only), and each `supports-[…]` branch, standard and
 * `-webkit-`, swaps it for the translucent surface.
 *
 * ⚠️ Written positively on purpose: Tailwind 4.3 does NOT generate a composite
 * `not-supports-[(a)_or_(b)]` variant (measured: the class was absent from the
 * built CSS). Two single-condition `supports-[…]` variants are.
 */
//
// Every class is written out literally: Tailwind finds classes by scanning
// the source, so a string assembled at run time would never be generated.
export const authCardClass =
  'w-full max-w-sm rounded-2xl border border-on-accent/70 bg-bg bg-linear-to-b from-surface to-surface p-6 shadow-xl shadow-accent/10 backdrop-blur-xl sm:p-8 ' +
  'supports-[backdrop-filter:blur(1px)]:bg-none supports-[backdrop-filter:blur(1px)]:bg-surface ' +
  'supports-[-webkit-backdrop-filter:blur(1px)]:bg-none supports-[-webkit-backdrop-filter:blur(1px)]:bg-surface';

/** The single `<h1>` of each screen: the form's title, in Geist. */
export const authTitleClass = 'text-2xl font-semibold tracking-tight text-text';

/** Line under the title. */
export const authSubtitleClass = 'mt-1 text-sm text-text-muted';

/** `text-base` (16px) on purpose: below 16px, iOS zooms in on focus. */
export const authFieldClass =
  'mt-1 block min-h-11 w-full rounded-2xl border border-text/20 bg-bg/60 px-4 text-base text-text transition motion-reduce:transition-none placeholder:text-text-muted focus:border-accent ' +
  focusRing;

export const authLabelClass = 'block text-sm font-medium text-text';

/** Hint under a field (password length). */
export const authHintClass = 'mt-1 text-xs text-text-muted';

/** Submit button: the screen's one filled action. */
export const authButtonClass =
  'inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 text-sm font-medium text-on-accent transition hover:bg-accent/90 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ' +
  focusRing;

/** Error banner (`role="alert"`). State colour, kept. */
export const authErrorBannerClass =
  'rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800';

/** Post-reset notice on `/login` (`role="status"`). State colour, kept. */
export const authSuccessBannerClass =
  'mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800';

/**
 * The consent checkbox. Native control tinted by `accent-color` (token); its
 * 44px target is the `<label>` around it, not the 20px box.
 */
export const authCheckboxClass =
  'mt-0.5 h-5 w-5 shrink-0 rounded accent-accent ' + focusRing;

/** Error text under the consent box. State colour, kept. */
export const authCheckboxErrorClass = 'mt-1 text-sm text-red-700';

/**
 * Paragraph holding a link set apart under the form (« Créer un compte »…).
 */
export const authFooterTextClass = 'mt-4 text-center text-sm text-text-muted';

/**
 * A link set apart under the form: its own line, so the WCAG 2.5.8 « inline »
 * exception does not apply — hence the 44px floor.
 */
export const authStandaloneLinkClass =
  'inline-flex min-h-11 items-center rounded-lg font-medium text-accent underline-offset-2 hover:underline ' +
  focusRing;

/**
 * A link inside a sentence (consent label, error banner): stays inline, the
 * WCAG 2.5.8 exception applies. Colour inherited inside a banner.
 */
export const authInlineLinkClass =
  'rounded-sm font-medium underline underline-offset-2 ' + focusRing;
