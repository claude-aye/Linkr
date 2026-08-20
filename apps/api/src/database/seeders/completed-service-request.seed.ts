/**
 * Fixture: service requests driven up to COMPLETED.
 *
 * Why this exists
 * ---------------
 * No service request had ever reached COMPLETED in this project. Since session 4
 * the chain was blocked at OPEN→ASSIGNED by `assertPayable`, which 409s *before*
 * Stripe is ever contacted, because `stripe_connect_accounts` held zero rows.
 * Chantier D (reviews) is gated on COMPLETED — a review may only be written by
 * the client of a COMPLETED request — so without a way to reach that state the
 * whole chantier would be unexerciseable, exactly like the regulated segment we
 * just closed. A review nobody can write proves nothing.
 *
 * What it does NOT do
 * -------------------
 * It does not touch `assertPayable`, the capture, the commission split, the
 * refunds or the webhooks — not one line of payment logic is modified. The guard
 * stays exactly as strict as it was: a provider WITHOUT a Connect row still gets
 * its 409. This fixture unblocks ONE provider by supplying the data the guard
 * asks for. That is the whole difference between a fixture and a regression.
 *
 * ⚠️ THE DEPOSIT LANDS `FAILED`, BY DESIGN — THAT IS NOT A BUG TO CHASE
 * --------------------------------------------------------------------
 * `assertPayable` is a pure data check (no network). But `captureDeposit` runs
 * AFTER the assignment transaction commits and makes a REAL synchronous call to
 * api.stripe.com. With the placeholder identifiers below — the default — Stripe
 * rejects them in ANY environment; in a sandbox with no route to Stripe the SDK
 * cannot connect at all. Either way: HTTP 502, the DEPOSIT row is marked FAILED,
 * and the request is ASSIGNED regardless, because the transaction had already
 * committed. The state machine advances; the money does not.
 *
 * To get a SUCCEEDED deposit you need three REAL test-mode Stripe objects (a
 * connected account with charges_enabled, a customer, and a payment method
 * attached to it). Only the real Connect onboarding flow produces them, and that
 * is a separate, unplanned chantier. If you already have them, pass them in:
 *
 *   FIXTURE_STRIPE_ACCOUNT_ID=acct_...  \
 *   FIXTURE_STRIPE_CUSTOMER_ID=cus_...  \
 *   FIXTURE_STRIPE_PAYMENT_METHOD_ID=pm_...  \
 *   npx ts-node -r tsconfig-paths/register src/database/seeders/completed-service-request.seed.ts
 *
 * The placeholders are deliberately NOT well-formed Stripe ids (`acct_fixture_…`
 * rather than `acct_1ABC…`), for the same reason session 4 seeds `RBQ-0000-0000-00`
 * rather than a real licence number: a fabricated id must be unmistakably
 * fabricated. It also means this fixture cannot move real money even if pointed
 * at live keys — Stripe simply rejects an id that does not exist.
 *
 * What it leaves behind
 * ---------------------
 * Three requests, one per pipeline state, so the provider dashboard shows all of
 * them at once (`JobPipelineAction` renders "Démarrer" on ASSIGNED, "Compléter"
 * on IN_PROGRESS, and nothing at all on COMPLETED — driving everything to
 * COMPLETED would have left that component with nothing to render, which is the
 * very debt this unblocks).
 *
 * Keys are natural (email, category slug, request title); no UUID is hard-coded,
 * so a re-run against another database resolves different ids without editing.
 * Re-running is a no-op: every step prints `=` instead of `+`.
 *
 * Assumes `quebec-catalog.seed.ts` has run, and the API is reachable.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/database/seeders/completed-service-request.seed.ts
 */

import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// ── Configuration — every value overridable from the environment ────────────

const API = process.env.FIXTURE_API_URL ?? 'http://localhost:5000';
const PROVIDER_EMAIL = process.env.FIXTURE_PROVIDER_EMAIL ?? 'bob@linkr.test';
const CLIENT_EMAIL = process.env.FIXTURE_CLIENT_EMAIL ?? 'carol@linkr.test';
const PASSWORD = process.env.FIXTURE_PASSWORD ?? 'Password123!';

/**
 * INFORMAL trade on purpose: it lands NOT_REQUIRED and is immediately eligible,
 * with no admin in the loop. A REGULATED one would sit at PENDING forever.
 */
const CATEGORY_SLUG = process.env.FIXTURE_CATEGORY_SLUG ?? 'coiffure';

/** See the header: placeholders are fabricated on purpose and will fail capture. */
const STRIPE_ACCOUNT_ID = process.env.FIXTURE_STRIPE_ACCOUNT_ID ?? 'acct_fixture_linkr_dev';
const STRIPE_CUSTOMER_ID = process.env.FIXTURE_STRIPE_CUSTOMER_ID ?? 'cus_fixture_linkr_dev';
const STRIPE_PM_ID = process.env.FIXTURE_STRIPE_PAYMENT_METHOD_ID ?? 'pm_fixture_linkr_dev';
const USING_REAL_STRIPE = Boolean(process.env.FIXTURE_STRIPE_ACCOUNT_ID);

/** Quebec City — the provider's base and the service address of every request. */
const BASE_LOCATION = { type: 'Point' as const, coordinates: [-71.21, 46.81] };
const SERVICE_RADIUS_KM = 50;
const PRICE_AMOUNT = 150;
const CURRENCY = 'CAD';

type PipelineStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';

/** Title is the natural key of a fixture request — hence the stable prefix. */
const REQUESTS: { title: string; target: PipelineStatus }[] = [
  { title: '[fixture] Job a demarrer', target: 'ASSIGNED' },
  { title: '[fixture] Job en cours', target: 'IN_PROGRESS' },
  { title: '[fixture] Job complete', target: 'COMPLETED' },
];

const ds = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: ['error'],
});

// ── HTTP helpers ───────────────────────────────────────────────────────────

interface ApiResult<T> {
  status: number;
  body: T;
}

async function api<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ── Accounts and provider profile ──────────────────────────────────────────

/** Logs in; signs the account up first if it does not exist yet. */
async function ensureAccount(
  email: string,
  firstName: string,
  lastName: string,
): Promise<{ token: string; userId: string }> {
  const res = await api<any>('POST', '/auth/login', {
    body: { email, password: PASSWORD },
  });

  if (res.status === 401) {
    const signup = await api<any>('POST', '/auth/signup', {
      body: {
        email,
        password: PASSWORD,
        firstName,
        lastName,
        countryCode: 'CA',
        subdivisionCode: 'CA-QC',
        preferredCurrency: 'CAD',
      },
    });
    if (!signup.body?.accessToken) {
      fail(`signup failed for ${email}: ${signup.status} ${JSON.stringify(signup.body)}`);
    }
    console.log(`  + account created: ${email}`);
    return { token: signup.body.accessToken, userId: signup.body.user.id };
  }

  if (!res.body?.accessToken) {
    fail(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  console.log(`  = account exists: ${email}`);
  return { token: res.body.accessToken, userId: res.body.user.id };
}

async function ensureProvider(token: string): Promise<string> {
  const me = await api<any>('GET', '/service-providers/me', { token });
  if (me.status === 200) {
    console.log(`  = provider exists: ${me.body.id}`);
    return me.body.id;
  }
  if (me.status !== 404) {
    fail(`GET /service-providers/me → ${me.status} ${JSON.stringify(me.body)}`);
  }
  const created = await api<any>('POST', '/service-providers', {
    token,
    body: {
      providerType: 'INDIVIDUAL',
      businessName: 'Fixture Pro',
      serviceBaseLocation: BASE_LOCATION,
      serviceRadiusKm: SERVICE_RADIUS_KM,
    },
  });
  if (created.status !== 201) {
    fail(`POST /service-providers → ${created.status} ${JSON.stringify(created.body)}`);
  }
  console.log(`  + provider created: ${created.body.id}`);
  return created.body.id;
}

interface Catalog {
  categoryId: string;
  itemId: string;
}

async function resolveCatalog(): Promise<Catalog> {
  const [category] = await ds.query(
    `SELECT id, regulation_level FROM service_categories
      WHERE slug = $1 AND deleted_at_utc IS NULL`,
    [CATEGORY_SLUG],
  );
  if (!category) {
    fail(`category "${CATEGORY_SLUG}" not found — run quebec-catalog.seed.ts first`);
  }
  if (category.regulation_level !== 'INFORMAL') {
    fail(
      `category "${CATEGORY_SLUG}" is ${category.regulation_level}. This fixture needs an ` +
        `INFORMAL trade: a REGULATED claim lands PENDING and stays there without an ` +
        `approved licence, so the provider would never become eligible.`,
    );
  }
  const [item] = await ds.query(
    `SELECT id FROM service_items
      WHERE service_category_id = $1 AND is_active AND deleted_at_utc IS NULL
      ORDER BY sort_order ASC LIMIT 1`,
    [category.id],
  );
  if (!item) fail(`no active service item under "${CATEGORY_SLUG}"`);
  return { categoryId: category.id, itemId: item.id };
}

/** Declares the trade (idempotent: a 409 means it is already declared). */
async function ensureTrade(
  token: string,
  providerId: string,
  categoryId: string,
): Promise<string> {
  const existing = await api<any[]>('GET', `/service-providers/${providerId}/categories`, {
    token,
  });
  if (existing.status === 200 && Array.isArray(existing.body)) {
    const match = existing.body.find((c: any) => c.serviceCategoryId === categoryId);
    if (match) {
      console.log(`  = trade declared: ${match.id} (${match.verificationStatus})`);
      return match.id;
    }
  }
  const created = await api<any>('POST', `/service-providers/${providerId}/categories`, {
    token,
    body: { serviceCategoryId: categoryId },
  });
  if (created.status !== 201) {
    fail(`POST categories → ${created.status} ${JSON.stringify(created.body)}`);
  }
  console.log(`  + trade declared: ${created.body.id} (${created.body.verificationStatus})`);
  return created.body.id;
}

/** One bookable offering, so the provider is a realistic one and not a shell. */
async function ensureOffering(
  token: string,
  providerId: string,
  pscId: string,
  itemId: string,
): Promise<void> {
  const existing = await api<any[]>('GET', `/service-providers/${providerId}/services`, {
    token,
  });
  if (
    existing.status === 200 &&
    Array.isArray(existing.body) &&
    existing.body.some((s: any) => s.serviceItemId === itemId)
  ) {
    console.log('  = offering exists');
    return;
  }
  const created = await api<any>(
    'POST',
    `/service-providers/${providerId}/categories/${pscId}/services`,
    {
      token,
      body: {
        serviceItemId: itemId,
        pricingModel: 'FLAT',
        priceAmount: PRICE_AMOUNT,
        priceCurrency: CURRENCY,
        estimatedDurationMinutes: 60,
      },
    },
  );
  if (created.status !== 201) {
    fail(`POST services → ${created.status} ${JSON.stringify(created.body)}`);
  }
  console.log(`  + offering created: ${created.body.id}`);
}

// ── The two direct writes ──────────────────────────────────────────────────
//
// These are the ONLY rows this fixture writes in SQL, and it writes them for the
// same reason session 4 granted ADMIN in SQL: no route produces them. The Connect
// row is created by Stripe's onboarding callback, the payment method by a Stripe
// customer + attach — both need the network and a real account. Everything else
// below goes through the real endpoints.

async function ensureConnectAccount(providerId: string): Promise<void> {
  const [existing] = await ds.query(
    `SELECT id, charges_enabled, stripe_account_id FROM stripe_connect_accounts
      WHERE service_provider_id = $1`,
    [providerId],
  );
  if (existing) {
    if (!existing.charges_enabled) {
      fail(
        `provider ${providerId} already has Connect account ${existing.stripe_account_id} ` +
          `with charges_enabled = false. Refusing to flip it: a real half-onboarded ` +
          `account is not this fixture's to repair. Point the fixture at another ` +
          `provider (FIXTURE_PROVIDER_EMAIL) or finish that account's onboarding.`,
      );
    }
    console.log(`  = connect account exists: ${existing.stripe_account_id} (charges enabled)`);
    return;
  }
  await ds.query(
    `INSERT INTO stripe_connect_accounts
       (service_provider_id, stripe_account_id, account_type, onboarding_status,
        charges_enabled, payouts_enabled, country_code, default_currency, onboarded_at_utc)
     VALUES ($1, $2, 'EXPRESS', 'VERIFIED', true, true, 'CA', $3, now())`,
    [providerId, STRIPE_ACCOUNT_ID, CURRENCY],
  );
  console.log(`  + connect account created: ${STRIPE_ACCOUNT_ID} (VERIFIED, charges enabled)`);
}

async function ensureClientPaymentMethod(clientUserId: string): Promise<void> {
  const [user] = await ds.query(`SELECT stripe_customer_id FROM users WHERE id = $1`, [
    clientUserId,
  ]);
  if (!user.stripe_customer_id) {
    await ds.query(
      `UPDATE users SET stripe_customer_id = $2, updated_at_utc = now() WHERE id = $1`,
      [clientUserId, STRIPE_CUSTOMER_ID],
    );
    console.log(`  + stripe customer set: ${STRIPE_CUSTOMER_ID}`);
  } else {
    console.log(`  = stripe customer exists: ${user.stripe_customer_id}`);
  }

  const [existing] = await ds.query(
    `SELECT id, stripe_payment_method_id FROM payment_methods
      WHERE owner_user_id = $1 AND is_default AND deleted_at_utc IS NULL`,
    [clientUserId],
  );
  if (existing) {
    console.log(`  = default payment method exists: ${existing.stripe_payment_method_id}`);
    return;
  }
  await ds.query(
    `INSERT INTO payment_methods
       (owner_user_id, stripe_payment_method_id, type, brand, last4, exp_month, exp_year, is_default)
     VALUES ($1, $2, 'CARD', 'VISA', '4242', 12, 2030, true)`,
    [clientUserId, STRIPE_PM_ID],
  );
  console.log(`  + default payment method created: ${STRIPE_PM_ID}`);
}

// ── The pipeline ───────────────────────────────────────────────────────────

const ORDER: Record<string, number> = {
  OPEN: 0,
  ASSIGNED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

interface RequestRow {
  id: string;
  status: string;
}

async function findRequestByTitle(
  clientUserId: string,
  providerId: string,
  title: string,
): Promise<RequestRow | null> {
  const [row] = await ds.query(
    `SELECT id, status FROM service_requests
      WHERE client_user_id = $1 AND requested_service_provider_id = $2
        AND title = $3 AND deleted_at_utc IS NULL
      ORDER BY created_at_utc DESC LIMIT 1`,
    [clientUserId, providerId, title],
  );
  return row ?? null;
}

async function createRequest(
  clientToken: string,
  providerId: string,
  catalog: Catalog,
  title: string,
): Promise<RequestRow> {
  const created = await api<any>('POST', '/service-requests', {
    token: clientToken,
    body: {
      requestType: 'DIRECT_BOOKING',
      serviceCategoryId: catalog.categoryId,
      serviceItemId: catalog.itemId,
      requestedServiceProviderId: providerId,
      title,
      description: 'Demande de fixture — pipeline de developpement.',
      serviceAddress: '1 rue de la Fixture, Quebec, QC',
      serviceLocation: BASE_LOCATION,
      serviceLocationPrecision: 'GEOCODED',
      estimatedAmount: PRICE_AMOUNT,
      estimatedCurrency: CURRENCY,
    },
  });
  if (created.status !== 201) {
    fail(`POST /service-requests → ${created.status} ${JSON.stringify(created.body)}`);
  }
  return { id: created.body.id, status: created.body.status };
}

/**
 * OPEN→ASSIGNED. The one step that touches Stripe — and it touches it AFTER the
 * transaction has committed, which is why a 502 here still leaves the request
 * ASSIGNED. We re-read the row rather than trusting the status code.
 */
async function accept(providerToken: string, requestId: string): Promise<void> {
  const res = await api<any>('POST', `/service-requests/${requestId}/accept`, {
    token: providerToken,
  });

  if (res.status === 200) {
    console.log('    → ASSIGNED (deposit captured)');
    return;
  }

  if (res.status === 409) {
    fail(
      `accept → 409 ${JSON.stringify(res.body)}\n` +
        `  The payability guard rejected this assignment, which means the fixture rows ` +
        `above did not take. This is the guard doing its job — do NOT relax it.`,
    );
  }

  if (res.status === 502) {
    const [row] = await ds.query(`SELECT status FROM service_requests WHERE id = $1`, [
      requestId,
    ]);
    if (row?.status !== 'ASSIGNED') {
      fail(`accept → 502 and the request is ${row?.status}, not ASSIGNED: ${JSON.stringify(res.body)}`);
    }
    const [payment] = await ds.query(
      `SELECT status, left(failure_reason, 120) AS reason FROM payments
        WHERE service_request_id = $1 AND payment_type = 'DEPOSIT'`,
      [requestId],
    );
    console.log('    → ASSIGNED, but the deposit FAILED (expected — see the file header)');
    console.log(`      deposit: ${payment?.status} · ${payment?.reason ?? 'no reason recorded'}`);
    if (USING_REAL_STRIPE) {
      console.log(
        '      ⚠️ You passed real Stripe ids and capture still failed — that is worth reading.',
      );
    }
    return;
  }

  fail(`accept → ${res.status} ${JSON.stringify(res.body)}`);
}

async function advance(
  providerToken: string,
  request: RequestRow,
  target: PipelineStatus,
): Promise<string> {
  let status = request.status;

  if (ORDER[status] === undefined) {
    fail(
      `request ${request.id} is ${status}, which is outside the OPEN→COMPLETED pipeline. ` +
        `Refusing to touch it.`,
    );
  }
  if (ORDER[status] > ORDER[target]) {
    console.log(`    = already ${status} (past the ${target} target) — left alone`);
    return status;
  }

  if (status === 'OPEN' && ORDER[target] >= ORDER.ASSIGNED) {
    await accept(providerToken, request.id);
    status = 'ASSIGNED';
  }
  if (status === 'ASSIGNED' && ORDER[target] >= ORDER.IN_PROGRESS) {
    const res = await api('POST', `/service-requests/${request.id}/start`, {
      token: providerToken,
    });
    if (res.status !== 200) fail(`start → ${res.status} ${JSON.stringify(res.body)}`);
    console.log('    → IN_PROGRESS');
    status = 'IN_PROGRESS';
  }
  if (status === 'IN_PROGRESS' && ORDER[target] >= ORDER.COMPLETED) {
    const res = await api('POST', `/service-requests/${request.id}/complete`, {
      token: providerToken,
    });
    if (res.status !== 200) fail(`complete → ${res.status} ${JSON.stringify(res.body)}`);
    console.log('    → COMPLETED');
    status = 'COMPLETED';
  }
  return status;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('refusing to run with NODE_ENV=production');
  }
  await ds.initialize();

  console.log('\nAccounts');
  const provider = await ensureAccount(PROVIDER_EMAIL, 'Bob', 'Prestataire');
  const client = await ensureAccount(CLIENT_EMAIL, 'Carol', 'Cliente');
  if (provider.userId === client.userId) {
    fail('the provider and the client must be two different accounts');
  }

  console.log('\nProvider profile');
  const providerId = await ensureProvider(provider.token);
  const catalog = await resolveCatalog();
  const pscId = await ensureTrade(provider.token, providerId, catalog.categoryId);
  await ensureOffering(provider.token, providerId, pscId, catalog.itemId);

  console.log('\nPayability data (the only direct SQL writes)');
  await ensureConnectAccount(providerId);
  await ensureClientPaymentMethod(client.userId);

  console.log('\nPipeline');
  const results: { title: string; id: string; status: string }[] = [];
  for (const spec of REQUESTS) {
    console.log(`  ${spec.title} → ${spec.target}`);
    let row = await findRequestByTitle(client.userId, providerId, spec.title);
    if (row) {
      console.log(`    = exists: ${row.id} (${row.status})`);
    } else {
      row = await createRequest(client.token, providerId, catalog, spec.title);
      console.log(`    + created: ${row.id} (${row.status})`);
    }
    const status = await advance(provider.token, row, spec.target);
    if (status !== spec.target) {
      fail(`expected ${spec.target}, got ${status} for "${spec.title}"`);
    }
    results.push({ title: spec.title, id: row.id, status });
  }

  console.log('\nResult');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(12)} ${r.id}  ${r.title}`);
  }
  const [{ count: completed }] = await ds.query(
    `SELECT count(*)::int AS count FROM service_requests
      WHERE status = 'COMPLETED' AND deleted_at_utc IS NULL`,
  );
  console.log(`\n  service_requests in COMPLETED (whole database): ${completed}`);
  console.log(`  provider: ${providerId} (${PROVIDER_EMAIL})`);
  console.log(`  client:   ${client.userId} (${CLIENT_EMAIL})`);

  if (!USING_REAL_STRIPE) {
    console.log(
      '\n  ⚠️ Placeholder Stripe ids were used, so every DEPOSIT is FAILED and the\n' +
        '     COMPLETED→PAID transition stays unreachable. That is by design; see the\n' +
        '     file header for what real test-mode ids would change.',
    );
  }

  console.log('\n✓ Done.\n');
  await ds.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await ds.destroy().catch(() => undefined);
  process.exit(1);
});
