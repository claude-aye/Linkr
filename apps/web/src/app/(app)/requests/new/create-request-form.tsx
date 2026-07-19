'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import type { components } from '@linkr/api-client';

/**
 * Client service-request creation form (Phase 3.13-3-front) — the piece that
 * CLOSES the client transactional loop: a human creates a real OPEN request,
 * no SQL, no PowerShell.
 *
 * MINIMAL client island: only the three entered fields (title / description /
 * serviceAddress) are interactive. Everything else — requestType, the targeted
 * provider, the service/category ids, the amount/currency and the fixed Québec
 * point — is DERIVED or CONSTANT (props from the Server Component's re-read),
 * never entered nor URL-borne. The price NEVER travels through the URL because
 * `estimatedAmount` is free-form on the backend (a tampered URL could book at
 * $1); the parent page re-reads the API to derive it.
 *
 * Posts to the BFF `POST /api/service-requests` (transparent relay, 3.13-3a),
 * NOT a Server Action — consistent with every other mutation in the app.
 */

type CreateServiceRequestBody = components['schemas']['CreateServiceRequestDto'];

/**
 * Fixed Québec City point, GeoJSON order [lng, lat] (lng negative). Assumed
 * placeholder — there is no geocoding yet (tracked debt, resolved in 3.14).
 */
const QUEBEC_SERVICE_LOCATION = { type: 'Point', coordinates: [-71.21, 46.81] };

const TITLE_MAX = 200;
const ADDRESS_MAX = 500;

/** Frozen FR fallback for a BFF 502, a network failure, and any unmapped code. */
const UNAVAILABLE_MESSAGE = 'Service momentanément indisponible. Veuillez réessayer.';

/**
 * Maps a relayed BFF/API status to FROZEN French copy. Decision is locked (same
 * convention as the dashboard actions): mapping is by HTTP status ALONE — the
 * response body is never parsed to pick a message. Vouvoiement throughout.
 */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Certains champs sont invalides. Veuillez les vérifier.';
    case 401:
      return 'Votre session a expiré. Veuillez vous reconnecter.';
    case 409:
      return "Cette demande n'est plus disponible.";
    default:
      // 502 (BFF transport failure) and anything else fall through to the
      // generic "unavailable" bucket — we never map a code that cannot occur.
      return UNAVAILABLE_MESSAGE;
  }
}

/** fr-CA currency formatting; degrades to the raw pair on an unknown ISO code. */
function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </dt>
      <dd className="font-medium text-zinc-800 sm:text-right dark:text-zinc-200">
        {children}
      </dd>
    </div>
  );
}

const fieldClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-zinc-800';
const labelClass = 'block text-sm font-medium text-zinc-700 dark:text-zinc-300';

export interface CreateRequestFormProps {
  /** Targeted provider id (from the URL) — DIRECT_BOOKING recipient. */
  providerId: string;
  /** Resolved provider name (already falls back to « ce prestataire »). */
  businessName: string;
  /** Derived from the server re-read — never entered, never URL-borne. */
  serviceItemId: string;
  serviceCategoryId: string;
  tradeLabel: string;
  serviceLabel: string;
  priceAmount: number;
  priceCurrency: string;
}

export function CreateRequestForm({
  providerId,
  businessName,
  serviceItemId,
  serviceCategoryId,
  tradeLabel,
  serviceLabel,
  priceAmount,
  priceCurrency,
}: CreateRequestFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const priceLabel = formatMoney(priceAmount, priceCurrency);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // Light client validation — the API is the real judge; this only spares an
    // obviously-doomed round-trip. No network call on failure.
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const trimmedAddress = serviceAddress.trim();
    if (!trimmedTitle || !trimmedDescription || !trimmedAddress) {
      setError('Veuillez remplir tous les champs.');
      return;
    }
    if (trimmedTitle.length > TITLE_MAX || trimmedAddress.length > ADDRESS_MAX) {
      setError('Certains champs dépassent la longueur autorisée.');
      return;
    }

    // Derived/constant fields are assembled HERE, never entered nor URL-borne:
    // requestType, the targeted provider (URL), the service/category ids +
    // amount/currency (server re-read), and the fixed Québec point.
    const payload: CreateServiceRequestBody = {
      requestType: 'DIRECT_BOOKING',
      requestedServiceProviderId: providerId,
      serviceCategoryId,
      serviceItemId,
      title: trimmedTitle,
      description: trimmedDescription,
      serviceAddress: trimmedAddress,
      estimatedAmount: priceAmount,
      estimatedCurrency: priceCurrency,
      // The generated type degrades GeoJSON to `Record<string, never>` (JSONB
      // quirk, CLAUDE.md §6) — cast the real Point through `unknown`.
      serviceLocation:
        QUEBEC_SERVICE_LOCATION as unknown as CreateServiceRequestBody['serviceLocation'],
    };

    setPending(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/service-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Network/transport failure → the generic "unavailable" bucket.
      setError(UNAVAILABLE_MESSAGE);
      setPending(false);
      return;
    }

    if (!response.ok) {
      // Status-only mapping (locked). The user can correct and re-submit.
      setError(messageForStatus(response.status));
      setPending(false);
      return;
    }

    // 201 — the request was created OPEN and targeted at the provider. Swap the
    // form for an in-place confirmation (no redirect, no router.refresh): the
    // « Mes demandes » destination is still a stub (task 4).
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <section className="w-full max-w-xl">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 shadow-sm dark:border-emerald-900 dark:bg-zinc-900">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Demande envoyée
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            Votre demande a été envoyée à {businessName}.
          </p>

          <dl className="mt-6 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
            <Row label="Service">
              {tradeLabel} · {serviceLabel}
            </Row>
            <Row label="Montant estimé">{priceLabel}</Row>
            <Row label="Adresse">{serviceAddress.trim()}</Row>
          </dl>

          <div className="mt-6">
            <Link
              href="/"
              className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
            >
              ← Retour à l’accueil
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Demande à {businessName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {tradeLabel} · {serviceLabel}
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        {/* Read-only context — NOT inputs. The price is derived server-side. */}
        <dl className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
          <Row label="Service">
            {tradeLabel} · {serviceLabel}
          </Row>
          <Row label="Montant estimé">{priceLabel}</Row>
        </dl>

        <div>
          <label htmlFor="title" className={labelClass}>
            Titre
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="serviceAddress" className={labelClass}>
            Adresse du service
          </label>
          <input
            id="serviceAddress"
            name="serviceAddress"
            type="text"
            required
            maxLength={ADDRESS_MAX}
            value={serviceAddress}
            onChange={(e) => setServiceAddress(e.target.value)}
            className={fieldClass}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Envoi…' : 'Envoyer la demande'}
        </button>
      </form>
    </section>
  );
}
