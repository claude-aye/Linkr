import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { components } from '@linkr/api-client';

import { getCurrentUser, getServerApiClient } from '@/lib/auth/session';
import { pickTranslation } from '@/lib/i18n/translations';
import type { CategoryOption } from '@/lib/providers/discovery-types';
import type {
  ProviderCategory,
  ProviderProfile,
  ProviderServiceRequestItem,
  PscVerificationStatus,
  ServiceRequestStatus,
} from '@/lib/providers/types';

import { AcceptRequestAction } from './_actions/accept-request-action';
import { AddCategoryForm, type TradeOption } from './_actions/add-category-form';
import { DeclineRequestAction } from './_actions/decline-request-action';
import { JobPipelineAction } from './_actions/job-pipeline-action';
import {
  NotificationsSection,
  type NotificationView,
} from './_components/notifications-section';

/**
 * Both notification types are consumed NATIVELY from the generated schema — no
 * local mirror, no cast. PR B annotated every property explicitly (`nullable`
 * ones included), so none of them degrades to `Record<string, never>`: the
 * JSONB/nullable debt of §6 simply does not reach this endpoint.
 */
type NotificationList = components['schemas']['NotificationListDto'];
type NotificationItem = components['schemas']['NotificationItemDto'];

// Reads the access cookie + live provider data — always rendered per request.
export const dynamic = 'force-dynamic';

const dateTimeFmt = new Intl.DateTimeFormat('fr-CA', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Date only — the fallback once a relative age stops carrying meaning. */
const dateFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'medium' });

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

/**
 * Static relative age (« il y a 2 h »), computed once server-side at render —
 * same deliberate snapshot semantics as {@link formatDeadline} above, and the
 * same reason: no live ticking. The absolute timestamp rides along on hover, so
 * a stale relative label is never the only thing on offer.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const diffMin = Math.round((Date.now() - then) / 60_000);
  // A clock skew (or a notification written mid-render) must not read « dans ».
  if (diffMin < 1) return 'à l’instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;

  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `il y a ${hours} h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;

  // Past a week « il y a 43 j » stops meaning anything — give the date instead.
  return dateFmt.format(new Date(then));
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

/**
 * Declared-trade badge — the REAL `verification_status` the row holds, never a
 * hoped-for one. A paused trade (`is_active = false`) is reported as such
 * instead, because it is genuinely out of the discovery predicate whatever its
 * verification says.
 *
 * Deliberately a LOCAL const, like {@link STATUS_BADGES} above: the tracked
 * « shared status-badge helper » debt is not widened here, and not paid here
 * either (cf. CLAUDE.md, 3.13-B « VOIE 2 »). Same colour families as the
 * request badges — no new colour is introduced.
 */
const TRADE_BADGES: Record<PscVerificationStatus, { label: string; className: string }> = {
  NOT_REQUIRED: {
    label: 'Aucune vérification requise',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  VERIFIED: {
    label: 'Licence vérifiée',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  PENDING: {
    label: 'Vérification en attente',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  REJECTED: {
    label: 'Vérification refusée',
    className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  },
};

const PAUSED_BADGE = {
  label: 'En pause',
  className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

/** One declared trade: its name (joined from the catalog) and its real status. */
function TradeRow({ trade, label }: { trade: ProviderCategory; label: string }) {
  const badge = trade.isActive ? TRADE_BADGES[trade.verificationStatus] : PAUSED_BADGE;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* UUID on hover, same affordance as the request cards above. */}
      <span
        className="font-medium text-zinc-900 dark:text-zinc-50"
        title={trade.serviceCategoryId}
      >
        {label}
      </span>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
      >
        {badge.label}
      </span>
    </li>
  );
}

/** « Plomberie · Déboucher un évier » — item-less tenders show the trade alone. */
function tradeLine(item: ProviderServiceRequestItem): string {
  const trade = pickTranslation(item.serviceCategoryNameTranslations);
  const service = item.serviceItemNameTranslations
    ? pickTranslation(item.serviceItemNameTranslations)
    : null;
  return service ? `${trade} · ${service}` : trade;
}

/**
 * One notification → the flat, fully-resolved shape the client island renders.
 * Everything that needs i18n, formatting or a status badge is decided HERE, so
 * the island carries no second status map: the badge is resolved against
 * {@link STATUS_BADGES}, which therefore stays a NON-exported local const (the
 * tracked « shared status helper » debt is neither widened nor paid).
 */
function toNotificationView(item: NotificationItem): NotificationView {
  // A soft-deleted request is still LISTED (the API keeps it and flags it —
  // hiding it would leave the recipient with nothing), but it must not link
  // anywhere: `/dashboard/requests/{id}` would be a dead end.
  const linkable = item.serviceRequestId !== null && !item.serviceRequestDeleted;

  return {
    id: item.id,
    unread: item.readAtUtc === null,
    // The joined title is the sense-carrier. It is null only when the row points
    // at no request at all — a sober stand-in, never a fabricated explanation,
    // and never the `data` snapshot (identifiers and labels live in columns).
    title: item.serviceRequestTitle ?? 'Demande indisponible',
    tradeLabel: item.serviceCategoryNameTranslations
      ? pickTranslation(item.serviceCategoryNameTranslations)
      : null,
    // The request's CURRENT status, as the API insists — a request cancelled or
    // expired since the notification was written reports what it really is.
    badge: item.serviceRequestStatus ? STATUS_BADGES[item.serviceRequestStatus] : null,
    timeLabel: formatRelative(item.createdAtUtc),
    timeTitle: formatDateTime(item.createdAtUtc),
    href: linkable ? `/dashboard/requests/${item.serviceRequestId}` : null,
  };
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

/**
 * Empty state for a signed-in user with NO provider profile — the entry point to
 * « devenir prestataire ». This screen is where the post-signup bounce lands, so
 * it carries the CTA rather than a dead end. Same shell as {@link StateCard} (kept
 * untouched for the `failed` branch), plus the app's primary-button link style.
 */
function BecomeProviderCard() {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Vous n’avez pas encore de profil prestataire
      </h2>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Créez-en un pour offrir vos services et recevoir des demandes.
      </p>
      <div className="mt-6">
        <Link
          href="/providers/new"
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500"
        >
          Devenir prestataire
        </Link>
      </div>
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
      // The user never activated Pro mode → the « Devenir prestataire » entry
      // point below. This 404 IS the detection: no extra request is made.
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

  // « Mes métiers » — TWO reads, joined here: the declared claims carry only a
  // `serviceCategoryId`, and the catalog carries the labels + the regulation
  // level the form needs. Neither failure sets the page-wide `failed`: a catalog
  // outage must not blank the inbox, so both degrade inside their own section.
  let trades: ProviderCategory[] | null = null;
  let catalog: CategoryOption[] = [];

  if (provider) {
    try {
      const { data, error, response } = await client.GET(
        '/service-providers/{providerId}/categories',
        { params: { path: { providerId: provider.id } } },
      );
      // This operation ships no response schema (`content: never`), so `data` is
      // typed `never` — cast through the faithful mirror, as for `/auth/me`.
      // openapi-fetch still parses the JSON body at runtime regardless.
      if (!error && response.ok && Array.isArray(data)) {
        trades = data as unknown as ProviderCategory[];
      }
    } catch {
      trades = null;
    }

    try {
      const { data, error, response } = await client.GET('/service-categories');
      // Same contract gap, same minimal local mirror as `/recherche`.
      if (!error && response.ok && Array.isArray(data)) {
        catalog = data as unknown as CategoryOption[];
      }
    } catch {
      catalog = [];
    }
  }

  // « Notifications » — read exactly like every other section: Server Component
  // straight to the API, never a BFF GET (the BFF stays reserved for mutations;
  // the only relay this PR adds is the PATCH that marks one read).
  //
  // Fetched inside the `provider` branch on purpose: both writers of this table
  // address a PROVIDER profile today (tender broadcast, direct-booking notice),
  // so a user without one has nothing to read and is spared the round trip.
  //
  // Failure degrades to `null` in its own catch and NEVER touches the page-wide
  // `failed` — same rule as the trades/catalog reads above. `null` makes the
  // section vanish entirely (below): unlike « Mes métiers », which must keep its
  // form on screen, there is nothing here to act on, so an error card would be
  // noise the provider cannot answer.
  let notifications: NotificationList | null = null;

  if (provider) {
    try {
      const { data, error, response } = await client.GET('/notifications');
      // Envelope AND items are typed natively by the generated schema.
      if (!error && response.ok && data && Array.isArray(data.items)) {
        notifications = data;
      }
    } catch {
      notifications = null;
    }
  }

  /** Trade id → display label. The claims carry no name of their own. */
  const catalogLabels = new Map(
    catalog.map((category) => [category.id, pickTranslation(category.nameTranslations)]),
  );

  // Whole active catalog, ordered — REGULATED trades included and flagged, so
  // the form can present them without letting them be picked.
  const tradeOptions: TradeOption[] = [...catalog]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      id: category.id,
      label: pickTranslation(category.nameTranslations),
      regulated: category.regulationLevel === 'REGULATED',
    }));

  // The three provider sections, each built ONCE here and merely ORDERED below.
  // They carry stable keys because they are rendered from an array — and the
  // keys must stay stable across the flip described further down: without them
  // React would rebuild whatever sits at a given index instead of MOVING the
  // sections, remounting `AddCategoryForm` and wiping the confirmation the
  // provider just earned by declaring their first trade.
  const pendingSection = (
    // Inbox first and visually dominant: OPEN targeted bookings are
    // time-sensitive revenue opportunities.
    <section key="pending" aria-labelledby="pending-title">
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
  );

  const jobsSection = (
    <section key="jobs" aria-labelledby="jobs-title">
      <div className="mb-3 flex items-center gap-2">
        <h2 id="jobs-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
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
  );

  // Guarded on `provider` rather than assumed: the branch that renders this only
  // runs when the profile did load, but the narrowing has to be written down for
  // the id passed to the form to be sound.
  const tradesSection = provider && (
    <section key="trades" aria-labelledby="trades-title">
      <div className="mb-3 flex items-center gap-2">
        <h2
          id="trades-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Mes métiers
        </h2>
        {trades && trades.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-zinc-900 px-2.5 py-0.5 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
            {trades.length}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {trades === null ? (
          <StateCard title="Chargement impossible">
            Vos métiers n’ont pas pu être récupérés. Veuillez réessayer plus tard.
          </StateCard>
        ) : trades.length === 0 ? (
          <EmptyHint>
            Vous n’avez déclaré aucun métier. Sans métier déclaré, vous n’apparaissez
            dans aucune recherche&nbsp;: déclarez celui que vous exercez pour être
            trouvé par des clients.
          </EmptyHint>
        ) : (
          <ul className="space-y-3">
            {trades.map((trade) => (
              <TradeRow
                key={trade.id}
                trade={trade}
                label={catalogLabels.get(trade.serviceCategoryId) ?? '—'}
              />
            ))}
          </ul>
        )}

        {tradeOptions.length === 0 ? (
          <EmptyHint>
            La liste des métiers n’a pas pu être chargée. Veuillez réessayer plus tard.
          </EmptyHint>
        ) : (
          <AddCategoryForm providerId={provider.id} options={tradeOptions} />
        )}
      </div>
    </section>
  );

  /**
   * CONDITIONAL hoist — this is NOT a reversal of inbox-first.
   *
   * A provider with ZERO declared trades is invisible to every search, so the
   * two sections above him can only ever read « aucune demande » / « aucun job »:
   * the one thing that can change that is the section explaining it. For him,
   * and ONLY for him, « Mes métiers » leads.
   *
   * The moment a first trade is declared the list is non-empty and the locked
   * 3.12-front order resumes — an established provider never sees his inbox
   * demoted. Read from `trades`, already loaded above: no extra request.
   *
   * `trades === null` (the read failed) deliberately does NOT hoist: we do not
   * know whether he has trades, and pushing the inbox below an error card we
   * cannot act on would trade a certainty for a guess.
   */
  const hoistTrades = trades !== null && trades.length === 0;

  /**
   * Notifications sit LAST, in BOTH orders — a placement, not a new rule.
   *
   * It cannot go on top: above « En attente de réponse » it would demote the
   * inbox, which is exactly what the locked 3.12-front decision forbids; and in
   * the zero-trade case it would push « Mes métiers » off the lead, undoing the
   * hoist above. Appending is the only position that leaves BOTH invariants
   * untouched — `hoistTrades` is not read here and not modified.
   *
   * It also reads right: a notification about a targeted booking points at a
   * request the inbox is ALREADY showing, actionable, at the top. This section
   * is the log — including the tender matches the dashboard shows nowhere else
   * (Vision B lists only requests assigned to or targeted at this provider).
   *
   * Absent entirely when the read failed (`null`): nothing to act on here, so
   * the dashboard simply stands without it. `.filter(Boolean)` is not needed —
   * React skips a `false`/`null` child — but the `key` is, exactly like its
   * three siblings, and for the same reason: the array is re-ordered by the
   * hoist, and stable keys make React MOVE the sections instead of rebuilding
   * whatever sits at a given index (which would wipe this island's optimistic
   * read marks along with `AddCategoryForm`'s confirmation).
   */
  const notificationsSection = notifications && (
    <NotificationsSection
      key="notifications"
      items={notifications.items.map(toNotificationView)}
      unreadCount={notifications.unreadCount}
      total={notifications.total}
    />
  );

  const sections = hoistTrades
    ? [tradesSection, pendingSection, jobsSection, notificationsSection]
    : [pendingSection, jobsSection, tradesSection, notificationsSection];

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
          <BecomeProviderCard />
        ) : (
          // Order decided above; the sections themselves are built once. The
          // fragments-free array keeps them DIRECT children of this div, so
          // `space-y-8` still spaces them — no style change, only order.
          <div className="space-y-8">{sections}</div>
        )}
      </section>
    </main>
  );
}
