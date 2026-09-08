/**
 * Allowed mime types for service-request attachment uploads.
 * Images + short videos (Avant/Après). Mirrors the 3.7c verification upload
 * validation pattern with an attachment-appropriate whitelist.
 */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
] as const;

/** Maximum attachment upload size: 50 MiB (videos are larger than documents). */
export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Fenêtre souhaitée (desired window) — règles temporelles du DIRECT_BOOKING.
// ---------------------------------------------------------------------------

/**
 * Délai minimum entre la création d'une demande et le début souhaité (D4).
 * Un client ne réserve pas pour dans dix minutes : le prestataire doit avoir
 * une chance de voir la demande avant l'heure du rendez-vous.
 */
export const MIN_LEAD_TIME_HOURS = 2;

/**
 * Fenêtre maximale laissée au prestataire pour répondre (D5). La deadline est
 * min(début souhaité, maintenant + cette fenêtre) : le prestataire ne peut ni
 * répondre après l'heure du rendez-vous, ni s'asseoir dessus plus longtemps.
 */
export const RESPONSE_WINDOW_HOURS = 48;

/**
 * Largeur maximale de la fenêtre souhaitée (D5d). Miroir de la règle client
 * (`create-request-form.tsx`), qui applique la même valeur avec le même
 * comparateur STRICT — 24 h pile passe, 24 h + 1 ms est refusée.
 *
 * ⚠️ Existe à cause de D8 : l'acceptation retient le DÉBUT, donc une plage très
 * large est un « quand vous voulez » que le système écrase silencieusement.
 * Mieux vaut refuser franchement que d'accepter une donnée qu'on trahit ensuite.
 */
export const MAX_WINDOW_HOURS = 24;
