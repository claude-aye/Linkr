/**
 * Shared class strings of the public landing (R5b). Class strings only, every
 * class written out literally (Tailwind finds classes by scanning the source).
 */

/** Visible focus ring: bordeaux, offset on the beige ground. */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** Same ring for links drawn over the hero photo: offset on bordeaux. */
export const focusRingOnPhoto =
  'outline-none focus-visible:ring-2 focus-visible:ring-beige focus-visible:ring-offset-2 focus-visible:ring-offset-bordeaux';

export const buttonBase =
  'inline-flex min-h-11 items-center justify-center rounded-2xl px-6 text-base font-medium transition motion-reduce:transition-none';

/** Section shell: one `<h2>`, generous spacing, centred column. */
export const sectionClass = 'mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24';

export const h2Class = 'text-3xl font-semibold tracking-tight text-balance text-text sm:text-4xl';

export const leadClass = 'mt-4 max-w-2xl text-base text-pretty text-text-muted sm:text-lg';

/**
 * Gentle reveal on scroll, defined in `globals.css` (`.landing-reveal`): pure
 * CSS, only under `prefers-reduced-motion: no-preference` AND
 * `@supports (animation-timeline: view())`. Without either, nothing hides the
 * content: it is simply there.
 */
export const reveal = 'landing-reveal';
