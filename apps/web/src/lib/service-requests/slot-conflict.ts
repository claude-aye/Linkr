// CAL-3 — the two 409 that a slot already taken produces, told apart by the
// `code` the API puts in the body (like EMAIL_NOT_VERIFIED, L3). Every other
// 409 keeps the status-only mapping of its screen (lock 3.12b).
//
// ⚠️ Module WITHOUT ANY IMPORT, by contract: `node --test` loads it as is
// (`slot-conflict.test.mjs`).

/** Body code of `POST /service-requests` when the window is already taken. */
export const SLOT_TAKEN_CODE = 'SLOT_TAKEN';

/** Body code of `POST /service-requests/{id}/accept` when it would double-book the provider. */
export const SLOT_CONFLICT_CODE = 'SLOT_CONFLICT';

/** Booking form. The availability is refreshed right after it is shown. */
export const SLOT_TAKEN_MESSAGE = "Ce créneau vient d'être pris. Choisissez-en un autre.";

/** « Accepter » of the provider dashboard. */
export const SLOT_CONFLICT_MESSAGE =
  'Vous avez déjà un rendez-vous confirmé sur ce créneau. Refusez cette demande ou proposez une autre heure au client.';

/**
 * Does this response carry `code`? Only a 409 is read, through a CLONE, so the
 * caller can still read the body. A body that is not JSON, or has no such
 * code, answers false.
 */
export async function hasConflictCode(
  response: { status: number; clone(): { json(): Promise<unknown> } },
  code: string,
): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const body = await response.clone().json();
    return (
      typeof body === 'object' && body !== null && (body as { code?: unknown }).code === code
    );
  } catch {
    return false;
  }
}
