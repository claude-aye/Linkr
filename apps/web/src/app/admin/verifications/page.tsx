import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import type {
  RequiredDocumentType,
  VerificationDocument,
} from '@/lib/verifications/types';

import { ReviewActions } from './review-actions';

// Reads the access cookie + live admin data — always rendered per request, never a build snapshot.
export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';

const DOCUMENT_TYPE_LABELS: Record<RequiredDocumentType, string> = {
  LICENSE_NUMBER: 'Numéro de licence',
  COMPETENCY_CARD: 'Carte de compétence',
  CERTIFICATION: 'Certification',
};

const dateTimeFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dateFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' });

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} Ko`;
  return `${(kb / 1024).toFixed(1)} Mo`;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}

function Mono({ value }: { value: string }) {
  return (
    <span
      className="break-all font-mono text-xs text-zinc-600 dark:text-zinc-400"
      title={value}
    >
      {value}
    </span>
  );
}

function StateCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
    </div>
  );
}

function DocumentCard({ doc }: { doc: VerificationDocument }) {
  const fileHref = `${API_BASE_URL}${doc.downloadUrl}`;
  const typeLabel = DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType;

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {typeLabel}
          </span>
          <p className="mt-1 font-mono text-sm text-zinc-900 dark:text-zinc-50">
            {doc.documentNumber ?? '— (aucun numéro)'}
          </p>
        </div>
        <p className="text-right text-xs text-zinc-500 dark:text-zinc-400">
          Soumis le
          <br />
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {formatDateTime(doc.createdAtUtc)}
          </span>
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Detail label="Fichier">
          <a
            href={fileHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            Voir le fichier
          </a>
          <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">
            ({doc.fileMimeType}, {formatBytes(doc.fileSizeBytes)})
          </span>
        </Detail>
        <Detail label="Émis le">{formatDate(doc.issuedAtUtc)}</Detail>
        <Detail label="Expire le">{formatDate(doc.expiresAtUtc)}</Detail>
        <Detail label="Catégorie pro.">
          <Mono value={doc.professionalServiceCategoryId} />
        </Detail>
        <Detail label="Exigence régl.">
          <Mono value={doc.regulatoryRequirementId} />
        </Detail>
      </dl>

      <ReviewActions documentId={doc.id} />
    </li>
  );
}

export default async function AdminVerificationsPage() {
  // Session gate — reuses the dashboard pattern. A dead/expired session resolves to
  // null here → bounce to /login via the existing mechanism. `redirect` throws, so
  // it is called OUTSIDE the try/catch below.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const client = await getServerApiClient();

  let docs: VerificationDocument[] | null = null;
  let forbidden = false;
  let failed = false;

  try {
    const { data, error, response } = await client.GET('/admin/verification-documents', {
      params: { query: { status: 'PENDING' } },
    });
    if (response.status === 403) {
      // RBAC is the API's call alone: a logged-in non-admin lands here.
      forbidden = true;
    } else if (error || !response.ok) {
      failed = true;
    } else {
      // No response schema in the OpenAPI (`content: never`) → `data` types to
      // `never`; cast through the local mirror. openapi-fetch parses the JSON at runtime.
      docs = (data as unknown as VerificationDocument[] | undefined) ?? [];
    }
  } catch {
    failed = true;
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              File de vérification
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Documents en attente de revue (Hard Trust réglementaire).
            </p>
          </div>
          {docs && docs.length > 0 && (
            <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
              {docs.length}
            </span>
          )}
        </header>

        {forbidden ? (
          <StateCard title="Accès réservé aux administrateurs">
            Cette console est réservée au personnel Linkr (rôle ADMIN).
          </StateCard>
        ) : failed ? (
          <StateCard title="Chargement impossible">
            La file n’a pas pu être récupérée. Réessaie plus tard.
          </StateCard>
        ) : docs && docs.length === 0 ? (
          <StateCard title="Aucun document en attente de revue">
            La file est vide — rien à traiter pour le moment.
          </StateCard>
        ) : (
          <ul className="space-y-4">
            {docs!.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
