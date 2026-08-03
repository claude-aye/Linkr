import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';

import { CreateProviderForm } from './create-provider-form';

// Reads the access cookie — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * « Devenir prestataire » (`/providers/new`) — the web door to
 * `POST /service-providers`, reached from the dashboard's empty state.
 *
 * Route shape mirrors the existing creation form `/requests/new`: a static `new`
 * segment beside the dynamic `/providers/[id]` public profile (static segments
 * win in the App Router, so the two never collide).
 *
 * The page itself only gates the session and resolves the suggested name; the
 * form owns the geocoding and the POST. It deliberately does NOT pre-check
 * whether the user already has a provider: that would be a third call site for
 * `GET /service-providers/me` (the layout and the dashboard already make two —
 * tracked debt), and the API's 409 is mapped to copy that says what to do.
 */
export default async function NewProviderPage() {
  // The page is PRIVATE (it lives under `(app)`). `redirect` throws, so it stays
  // outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Suggestion, not an imposition: `businessName` is optional on the DTO, but a
  // provider without one shows up as « Prestataire » on every discovery card, so
  // the field is pre-filled from the session identity and stays editable.
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const suggestedBusinessName = user.displayName ?? fullName;

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <CreateProviderForm suggestedBusinessName={suggestedBusinessName} />
    </main>
  );
}
