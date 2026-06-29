/**
 * Picks the best display string from a JSONB translations map
 * (e.g. `service_categories.name_translations`).
 *
 * Priority: `fr-CA` (Quebec primary) -> `en-CA` (secondary) -> first available
 * key -> em dash. Reusable across the app for any `*_translations` map
 * (catalog categories, items, regulatory requirements...).
 *
 * Defensive: a null/undefined/empty map resolves to `—`, never throws.
 */
export function pickTranslation(
  translations: Record<string, string> | null | undefined,
  preferred: string = 'fr-CA',
  secondary: string = 'en-CA',
): string {
  if (!translations) return '—';
  return (
    translations[preferred] ??
    translations[secondary] ??
    Object.values(translations)[0] ??
    '—'
  );
}
