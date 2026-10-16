/**
 * Caption normalisation, shared by the upload and the edit: trim the ends, and
 * turn an empty result into `null` — a blank caption is stored as NULL, never
 * as '' (the column CHECK refuses an empty string). Anything that is not a
 * string is passed through untouched so the validators refuse it with a 400.
 */
export function normaliseCaption(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
