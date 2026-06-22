import { createApiClient, type paths } from "@linkr/api-client";

// Render at request time so this page is a *live* API smoke test, never a
// build-time snapshot.
export const dynamic = "force-dynamic";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

// Proves the generated OpenAPI types are imported AND used: the /health 200 body
// shape is read straight from packages/api-client's generated schema. If codegen
// were missing or stale, this type (and the build) would break.
type HealthPayload =
  paths["/health"]["get"]["responses"]["200"]["content"]["application/json"];

type ConnectivityResult =
  | { reachable: true; status: number; payload: HealthPayload }
  | { reachable: false; detail: string };

async function checkApiHealth(): Promise<ConnectivityResult> {
  const client = createApiClient({ baseUrl: API_BASE_URL });
  try {
    // Typed call against the generated client — the path is validated against
    // `paths`, and `data` is typed as the /health 200 body.
    const { data, error, response } = await client.GET("/health", {
      cache: "no-store",
    });

    if (error || !response.ok || !data) {
      const body = JSON.stringify(error ?? data ?? {});
      return { reachable: false, detail: `HTTP ${response.status} — ${body}` };
    }

    return { reachable: true, status: response.status, payload: data };
  } catch (err) {
    // API down / DNS / connection refused — keep the page rendering.
    return {
      reachable: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function Home() {
  const result = await checkApiHealth();

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Linkr — Portail web
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Test de connectivité API (SSR · client OpenAPI généré)
          </p>
        </header>

        {result.reachable ? (
          <div className="rounded-xl border border-green-300 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full bg-green-500"
              />
              <span className="font-medium text-green-800 dark:text-green-300">
                API connectée
              </span>
              <span className="ml-auto text-xs text-green-700 dark:text-green-400">
                HTTP {result.status}
              </span>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-green-100/60 p-3 text-xs leading-relaxed text-green-900 dark:bg-green-900/40 dark:text-green-200">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full bg-red-500"
              />
              <span className="font-medium text-red-800 dark:text-red-300">
                API injoignable
              </span>
            </div>
            <p className="mt-3 break-words text-xs leading-relaxed text-red-900 dark:text-red-200">
              {result.detail}
            </p>
            <p className="mt-2 text-xs text-red-700 dark:text-red-400">
              Vérifie que l&apos;API tourne et que <code>NEXT_PUBLIC_API_URL</code>{" "}
              est correct.
            </p>
          </div>
        )}

        <footer className="mt-6 border-t border-zinc-100 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Cible :{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
            {API_BASE_URL}/health
          </code>
        </footer>
      </section>
    </main>
  );
}
