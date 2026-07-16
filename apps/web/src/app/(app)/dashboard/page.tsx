import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type {
  ProviderProfile,
  ProviderServiceRequestItem,
  ServiceRequestStatus,
} from '@/lib/providers/types';

import { AcceptRequestAction } from './_actions/accept-request-action';
import { DeclineRequestAction } from './_actions/decline-request-action';
import { JobPipelineAction } from './_actions/job-pipeline-action';

// Reads the access cookie + live provider data — always rendered per request.
export const dynamic = 'force-dynamic';

const dateTimeFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

function formatMoney(amount: string | null, currency: string | null): string {
  if (!amount) return '—';
  const n = Number(amount);
  if (!currency || Number.isNaN(n)) return currency ? `${amount} ${currency}` : amount;
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(n);
  } catch {
    // Unknown ISO 4217 code — degrade to the raw pair rather than crash.
    return `${amount} ${currency}`;
  }
}

/**
 * Static relative deadline label, computed once server-side at render time
 * (this page is force-dynamic, so "now" is the request time) — no live
 * ticking (`'use client'`) in this slice; the urgency signal is the pill +
 * this label. Live-tick is a deferred fast-follow.
 */
function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const deadlineMs = new Date(iso).getTime();
  if (Number.isNaN(deadlineMs)) return null;
  const diffMin = Math.round((deadlineMs - Date.now()) / 60_000);
  if (diffMin <= 0) return 'Expirée';
  if (diffMin < 60) return `Expire dans ~${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h >= 48) return `Expire dans ~${Math.round(h / 24)} j`;
  const m = diffMin % 60;
  return m > 0
    ? `Expire dans ~${h} h ${String(m).padStart(2, '0')}`
    : `Expire dans ~${h} h`;
}

/** One distinct color per pipeline status (feminine: la demande). */
const STATUS_BADGES: Record<ServiceRequestStatus, { label: string; className: string }> = {
  DRAFT: {
    label: 'Brouillon',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  OPEN: {
    label: 'Ouverte',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  ASSIGNED: {
    label: 'Assignée',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  IN_PROGRESS: {
    label: 'En cours',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  COMPLETED: {
    label: 'Terminée',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  },
  PAID: {
    label: 'Payée',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  EXPIRED: {
    label: 'Expirée',
    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
  CANCELLED: {
    label: 'Annulée',
    className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
  REFUNDED: {
    label: 'Remboursée',
    className: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  },
};

/** « Plomberie · Déboucher un évier » — item-less tenders show the trade alone. */
function tradeLine(item: ProviderServiceRequestItem): string {
  const trade = pickTranslation(item.serviceCategoryNameTranslations);
  const service = item.serviceItemNameTranslations
    ? pickTranslation(item.serviceItemNameTranslations)
    : null;
  return service ? `${trade} · ${service}` : trade;
}

function Detail({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
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

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
      {children}
    </div>
  );
}

function DetailLink({ requestId }: { requestId: string }) {
  return (
    <div className="mt-4">
      <Link
        href={`/dashboard/requests/${requestId}`}
        className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
      >
        Voir le détail →
      </Link>
    </div>
  );
}

/**
 * Inbox card: an OPEN DIRECT_BOOKING targeting this provider — time-sensitive
 * revenue opportunity, hence the amber accent + deadline label.
 *
 * Loi 25 debt (deliberate product choice, cf. CLAUDE.md): the full
 * `serviceAddress` is shown BEFORE acceptance (delivery-app pattern — see to
 * evaluate). To revisit in phase B alongside the accept/decline actions.
 */
function PendingRequestCard({ item }: { item: ProviderServiceRequestItem }) {
  const deadline = formatDeadline(item.responseDeadlineUtc);

  return (
    <li className="rounded-2xl border border-amber-300/70 bg-white p-5 shadow-sm dark:border-amber-900 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Nouvelle demande
        </span>
        {deadline && (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {deadline}
          </span>
        )}
      </div>

      <h3 className="mt-2 font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</h3>
      <p
        className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400"
        title={item.serviceCategoryId}
      >
        {tradeLine(item)}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Detail label="Client">{item.clientDisplayName || '—'}</Detail>
        <Detail label="Date souhaitée">{formatDateTime(item.desiredStartAtUtc)}</Detail>
        <Detail label="Prix estimé">
          {formatMoney(item.estimatedAmount, item.estimatedCurrency)}
        </Detail>
        <Detail label="Adresse" wide>
          {item.serviceAddress}
        </Detail>
      </dl>

      {/* Decide (accept/decline) — primary then secondary, grouped and kept
          distinct from the tertiary « consult » link below. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <AcceptRequestAction
          requestId={item.id}
          title={item.title}
          clientDisplayName={item.clientDisplayName}
          serviceAddress={item.serviceAddress}
          estimatedAmount={item.estimatedAmount}
          estimatedCurrency={item.estimatedCurrency}
        />
        <DeclineRequestAction requestId={item.id} />
      </div>

      <DetailLink requestId={item.id} />
    </li>
  );
}

/** Pipeline card: a request assigned to this provider, whatever its status. */
function JobCard({ item }: { item: ProviderServiceRequestItem }) {
  const badge = STATUS_BADGES[item.status];
  const showFinal = item.finalAmount != null;

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Planifié le{' '}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {formatDateTime(item.scheduledAtUtc)}
          </span>
        </span>
      </div>

      <h3 className="mt-2 font-semibold text-zinc-900 dark:text-zinc-50">{item.title}</h3>
      <p
        className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400"
        title={item.serviceCategoryId}
      >
        {tradeLine(item)}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Detail label="Client">{item.clientDisplayName || '—'}</Detail>
        <Detail label={showFinal ? 'Prix final' : 'Prix estimé'}>
          {showFinal
            ? formatMoney(item.finalAmount, item.finalCurrency)
            : formatMoney(item.estimatedAmount, item.estimatedCurrency)}
        </Detail>
        <Detail label="Adresse" wide>
          {item.serviceAddress}
        </Detail>
      </dl>

      {/* Self-nulling: renders Démarrer (ASSIGNED) / Compléter (IN_PROGRESS) /
          nothing otherwise — the card does no status branching itself. */}
      <div className="mt-4">
        <JobPipelineAction requestId={item.id} status={item.status} />
      </div>

      <DetailLink requestId={item.id} />
    </li>
  );
}

export default async function DashboardPage() {
  // Session gate — `redirect` throws, so it is called outside any try/catch.
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  const userLabel = user.displayName ?? (fullName || user.email);

  const client = await getServerApiClient();

  let provider: ProviderProfile | null = null;
  let notPro = false;
  let failed = false;

  try {
    const { data, error, response } = await client.GET('/service-providers/me');
    if (response.status === 404) {
      // The user never activated Pro mode — sober empty state (the full
      // « Devenir prestataire » onboarding CTA is deferred to a later phase).
      notPro = true;
    } else if (error || !response.ok || !data) {
      failed = true;
    } else {
      // Generated type degrades nullable fields to `Record<string, never>` —
      // cast through the faithful local mirror (see lib/providers/types.ts).
      provider = data as unknown as ProviderProfile;
    }
  } catch {
    failed = true;
  }

  // Option A (locked): ONE data call, no status filter — the two Vision B
  // branches are disjoint, so a single `?limit=100` page carries both sections.
  // Pagination is deliberately deferred (limit 100 covers seeds + early MVP).
  let pending: ProviderServiceRequestItem[] = [];
  let jobs: ProviderServiceRequestItem[] = [];

  if (provider) {
    try {
      const { data, error, response } = await client.GET(
        '/service-providers/{id}/service-requests',
        { params: { path: { id: provider.id }, query: { limit: 100 } } },
      );
      // The pagination envelope (`items`/`total`/`page`/`limit`) is now typed
      // natively by the generated schema — no envelope cast. Only the items'
      // nullable fields still degrade to `Record<string, never>` upstream
      // (separate JSONB/nullable debt, cf. lib/providers/types.ts), so cast the
      // items array alone through the faithful item mirror.
      if (error || !response.ok || !data || !Array.isArray(data.items)) {
        failed = true;
      } else {
        const items = data.items as unknown as ProviderServiceRequestItem[];
        // Server-side split: OPEN = awaiting my answer (inbox), rest = my jobs.
        pending = items.filter((item) => item.status === 'OPEN');
        jobs = items.filter((item) => item.status !== 'OPEN');
      }
    } catch {
      failed = true;
    }
  }

  return (
    <main className="flex flex-1 justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <section className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {provider ? `Bonjour, ${provider.businessName ?? userLabel}` : 'Tableau de bord'}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {provider
              ? (provider.headline ?? 'Tableau de bord prestataire')
              : `Connecté·e en tant que ${user.email}`}
          </p>
        </header>

        {failed ? (
          <StateCard title="Chargement impossible">
            Le tableau de bord n’a pas pu être récupéré. Réessaie plus tard.
          </StateCard>
        ) : notPro ? (
          <StateCard title="Vous n’avez pas encore de profil prestataire">
            Ce tableau de bord est réservé aux prestataires Linkr.
          </StateCard>
        ) : (
          <div className="space-y-8">
            {/* Inbox first and visually dominant: OPEN targeted bookings are
                time-sensitive revenue opportunities. */}
            <section aria-labelledby="pending-title">
              <div className="mb-3 flex items-center gap-2">
                <h2
                  id="pending-title"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
                >
                  En attente de réponse
                </h2>
                {pending.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-sm font-medium text-white">
                    {pending.length}
                  </span>
                )}
              </div>
              {pending.length === 0 ? (
                <EmptyHint>Aucune demande en attente.</EmptyHint>
              ) : (
                <ul className="space-y-4">
                  {pending.map((item) => (
                    <PendingRequestCard key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="jobs-title">
              <div className="mb-3 flex items-center gap-2">
                <h2
                  id="jobs-title"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
                >
                  Mes jobs
                </h2>
                {jobs.length > 0 && (
                  <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
                    {jobs.length}
                  </span>
                )}
              </div>
              {jobs.length === 0 ? (
                <EmptyHint>Aucun job pour le moment.</EmptyHint>
              ) : (
                <ul className="space-y-4">
                  {jobs.map((item) => (
                    <JobCard key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
