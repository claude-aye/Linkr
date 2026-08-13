import type { components } from '@linkr/api-client';
import {
  LOCATION_PRECISION_NOTICE_CLASS,
  clientLocationPrecisionNotice,
} from '@/lib/service-requests/location-precision';

/**
 * Thin client-facing card for one of the user's own service requests (Phase
 * 3.13-B). Every displayed field comes straight from the list item — NO joined
 * i18n labels and NO provider name are available on this DTO, so trade/service
 * names and the targeted-provider name are DELIBERATELY omitted (that
 * enrichment is deferred; cf. CLAUDE.md 3.13-B). The client-written `title` is
 * the sense-carrier here.
 */

/**
 * Element type of the typed `GET /service-requests` list envelope
 * (`ServiceRequestListDto.items`). Consumed natively — the envelope no longer
 * lies (PR A / #42). Only two of its fields still degrade (see below).
 */
export type ClientRequest = components['schemas']['ServiceRequestResponseDto'];

type Status = ClientRequest['status'];

/**
 * Status → { CLIENT label, badge color }.
 *
 * COLORS mirror the provider dashboard's `STATUS_BADGES` (visual coherence
 * between the two request views). LABELS are CLIENT-centric — « Acceptée » (not
 * the provider-centric « Assignée »), « En attente » (not « Ouverte »), etc.
 *
 * DRY: the dashboard's map is a NON-exported local const, so per the PR-B rule
 * we do NOT touch that file and mirror its colors here instead. Tracked debt —
 * extract a shared status helper for both views (chore), cf. CLAUDE.md 3.13-B.
 */
const STATUS_BADGES: Record<Status, { label: string; className: string }> = {
  DRAFT: {
    // Defensive — a DRAFT should not surface in the client list.
    label: 'Brouillon',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
  OPEN: {
    label: 'En attente',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  ASSIGNED: {
    label: 'Acceptée',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  IN_PROGRESS: {
    label: 'En cours de réalisation',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  COMPLETED: {
    label: 'Complétée',
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

const dateFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long' });

/** `createdAtUtc` is always present — date only, fr-CA. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

/**
 * fr-CA currency formatting — same OUTPUT as the create form's `priceLabel` for
 * a valid amount, plus « — » when the estimate is null. `estimatedAmount` is a
 * decimal STRING (e.g. "150.00"). NEVER a deposit, NEVER a rate (business rule).
 */
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

export function RequestCard({ request }: { request: ClientRequest }) {
  const badge = STATUS_BADGES[request.status];

  // `estimatedAmount` / `estimatedCurrency` are nullable decimals, but the
  // generated `ServiceRequestResponseDto` degrades every nullable to
  // `Record<string, never>` (JSONB/nullable debt, CLAUDE.md §6 — PR A typed only
  // the list ENVELOPE, not the item's nullables). These TWO fields alone force a
  // cast to their real `string | null` runtime shape; every other field on the
  // item (title, serviceAddress, status, createdAtUtc) is read NATIVELY.
  const estimatedAmount = request.estimatedAmount as unknown as string | null;
  const estimatedCurrency = request.estimatedCurrency as unknown as string | null;

  // Exception marker: `null` on GEOCODED, so a precise request shows nothing.
  // Read NATIVELY — the field is a required string union on the DTO, no cast.
  const locationNotice = clientLocationPrecisionNotice(request.serviceLocationPrecision);

  return (
    <li className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatDate(request.createdAtUtc)}
        </span>
      </div>

      <h3 className="mt-2 font-semibold text-zinc-900 dark:text-zinc-50">{request.title}</h3>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Detail label="Montant estimé">
          {formatMoney(estimatedAmount, estimatedCurrency)}
        </Detail>
        <Detail label="Adresse" wide>
          {request.serviceAddress}
          {/* Discreet mention under the address. Plain text — NO `role="alert"`
              and no `aria-live`: nothing happens, this is a displayed state, and
              the repo reserves `role="alert"` for action errors. */}
          {locationNotice && (
            <span className={`mt-1 block ${LOCATION_PRECISION_NOTICE_CLASS}`}>
              {locationNotice}
            </span>
          )}
        </Detail>
      </dl>
    </li>
  );
}
