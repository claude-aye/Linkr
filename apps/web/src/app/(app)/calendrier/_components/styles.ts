/**
 * Class strings shared by the calendar's islands — STRINGS ONLY, written in
 * full (Tailwind finds classes by reading the source; a string assembled at
 * run time would never be generated). Same shapes as the portfolio tab.
 */

export const inputClass =
  'w-full min-h-11 rounded-2xl border border-edge bg-surface px-3 py-2 text-base text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60';

/** A time `<select>`: as wide as its content needs, never squeezed under 44 px. */
export const selectClass =
  'min-h-11 min-w-0 flex-1 rounded-2xl border border-edge bg-surface px-2 py-2 text-base text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none sm:w-28';

export const labelClass = 'block text-sm font-medium text-text-muted';

export const hintClass = 'text-sm text-text-muted';

export const errorClass =
  'rounded-2xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800';

export const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-2xl bg-accent px-4 text-sm font-medium text-on-accent shadow-sm transition hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

export const ghostButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border border-edge px-4 text-sm font-medium text-text-muted transition hover:bg-text/5 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

export const dangerButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-2xl border border-red-300 px-4 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

export const cardClass = 'rounded-2xl border border-edge bg-surface p-4 sm:p-5';
