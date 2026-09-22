import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { tradesOfferedAtLaunch } from '@/lib/catalog/launch-scope';
import { pickTranslation } from '@/lib/i18n/translations';
import type { CategoryOption } from '@/lib/providers/discovery-types';

import { CreateTenderForm, type TenderCategoryOption } from './create-tender-form';

// Reads the access cookie + the live catalogue — always rendered per request.
export const dynamic = 'force-dynamic';

/**
 * « Publier un appel d'offres » — the web door to a `PROJECT_TENDER` (PR 1b).
 *
 * Server Component: session gate + catalogue read; the Client Component carries
 * the geocoding and the POST (to the BFF relay, never a Server Action).
 *
 * Categories are narrowed to the LAUNCH SCOPE (informal trades only), through
 * the same `tradesOfferedAtLaunch` as every other client entry. A regulated
 * tender could not receive a single quote today — no provider can be verified
 * on a regulated trade from the interface — so offering it would open a door
 * that never opens (CLAUDE.md §11, session 5). This page only OFFERS: it has no
 * lookup duty, so unlike `/recherche` it narrows the list right here.
 */
export default async function NewTenderPage() {
  // PRIVATE page under `(app)`. `redirect` throws — outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  // `GET /service-categories` ships no response schema (`content: never`) and
  // returns a bare array — read through the shared `CategoryOption` mirror.
  let categories: TenderCategoryOption[] | null = null;
  try {
    const { data, error, response } = await client.GET('/service-categories');
    if (!error && response.ok && Array.isArray(data)) {
      categories = tradesOfferedAtLaunch(data as unknown as CategoryOption[])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => ({
          id: category.id,
          label: pickTranslation(category.nameTranslations),
        }));
    }
  } catch {
    categories = null;
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      {categories === null || categories.length === 0 ? (
        // Without a trade there is nothing to publish — say so rather than
        // render a form whose first field is an empty list.
        <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Chargement impossible
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            La liste des métiers n’a pas pu être récupérée. Veuillez réessayer plus tard.
          </p>
          <p className="mt-4 text-sm">
            <Link
              href="/requests"
              className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              ← Retour à mes demandes
            </Link>
          </p>
        </section>
      ) : (
        <CreateTenderForm categories={categories} />
      )}
    </main>
  );
}
