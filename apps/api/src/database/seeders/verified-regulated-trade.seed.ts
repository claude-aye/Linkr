/**
 * Fixture: a provider VERIFIED on a REGULATED trade.
 *
 * Why this exists
 * ---------------
 * `professional_service_categories` has never held a single `VERIFIED` row. The
 * transition code is correct, but no row had ever travelled the path, so the three
 * REGULATED categories of the catalog could never return a result in `discover` —
 * the *empty* state of a regulated trade was proven, the *full* state never was.
 *
 * What it does NOT do
 * -------------------
 * It never writes `verification_status` directly. A direct `UPDATE` would prove the
 * display and not the transition, which is precisely the untested part. The claim is
 * declared, documents are uploaded, and an ADMIN approves them through the same
 * endpoints the console calls — the promotion cascade does the rest.
 *
 * The only direct database writes are:
 *   - the ADMIN role grant, because no route grants it (see `ensureAdminRole`);
 *   - nothing else. Everything else is read-only assertions.
 *
 * Keys are natural (email, category slug, authority code); no UUID is hard-coded, so
 * re-running against another database resolves different ids without editing.
 *
 * Assumes `quebec-catalog.seed.ts` has run, and the API is reachable.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/database/seeders/verified-regulated-trade.seed.ts
 */

import 'dotenv/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// ── Configuration — every value overridable from the environment ────────────

const API = process.env.FIXTURE_API_URL ?? 'http://localhost:5000';
/** REGULATED trade to verify. `electricite` needs RBQ + CMEQ, both required. */
const CATEGORY_SLUG = process.env.FIXTURE_CATEGORY_SLUG ?? 'electricite';
const PROVIDER_EMAIL = process.env.FIXTURE_PROVIDER_EMAIL ?? 'bob@linkr.test';
const ADMIN_EMAIL = process.env.FIXTURE_ADMIN_EMAIL ?? 'alice@linkr.test';
const PASSWORD = process.env.FIXTURE_PASSWORD ?? 'Password123!';

/**
 * Fictional licence numbers. NEVER put a real RBQ number here: the registry is
 * public and so is this repository — seeding a real contractor's identifier would
 * republish it outside the context where it was given. `0000-0000-00` is
 * well-formed and obviously not anybody's.
 */
const FIXTURE_LICENCE_NUMBER: Record<string, string> = {
  RBQ: 'RBQ-0000-0000-00',
  CMEQ: 'CMEQ-FIXTURE-0000',
  CMMTQ: 'CMMTQ-FIXTURE-0000',
  CCQ: 'CCQ-FIXTURE-0000',
  ASP_CONSTRUCTION: 'ASP-FIXTURE-0000',
};

/** Quebec City. The provider's base, and the point `discover` is probed from. */
const BASE_LOCATION = { type: 'Point' as const, coordinates: [-71.21, 46.81] };
const SERVICE_RADIUS_KM = 50;

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
  opts: { token?: string; body?: unknown; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let payload: BodyInit | undefined;
  if (opts.form) {
    payload = opts.form;
  } else if (opts.body !== undefined) {
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

// ── Steps ──────────────────────────────────────────────────────────────────

/** Logs in; signs the account up first if it does not exist yet. */
async function ensureAccount(
  email: string,
  firstName: string,
  lastName: string,
): Promise<{ token: string; userId: string }> {
  let res = await api<any>('POST', '/auth/login', {
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

/**
 * Grants ADMIN. This is the one state this fixture writes in SQL, because no
 * route grants a system role — it is a role grant, not the transition under test.
 */
async function ensureAdminRole(email: string): Promise<void> {
  const rows = await ds.query(
    `UPDATE users SET system_role = 'ADMIN', updated_at_utc = now()
      WHERE email = $1 AND system_role <> 'ADMIN'
      RETURNING id`,
    [email],
  );
  // `UPDATE ... RETURNING` on the postgres driver yields [rows, affected].
  const affected = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0].length : 0;
  console.log(
    affected > 0 ? `  + ${email} promoted to ADMIN` : `  = ${email} already ADMIN`,
  );
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
      businessName: 'Bob Services',
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

interface CategoryRow {
  id: string;
  regulation_level: string;
}

async function resolveCategory(): Promise<CategoryRow> {
  const [row] = await ds.query(
    `SELECT id, regulation_level FROM service_categories
      WHERE slug = $1 AND deleted_at_utc IS NULL`,
    [CATEGORY_SLUG],
  );
  if (!row) fail(`category "${CATEGORY_SLUG}" not found — run quebec-catalog.seed.ts first`);
  if (row.regulation_level !== 'REGULATED') {
    fail(`category "${CATEGORY_SLUG}" is ${row.regulation_level}, not REGULATED`);
  }
  return row;
}

/**
 * Declares the trade, or reuses the existing claim.
 *
 * The unique index `ux_psc_provider_category_active` covers
 * `(service_provider_id, service_category_id) WHERE deleted_at_utc IS NULL` and
 * does NOT include `verification_status` — so ANY live row occupies the slot,
 * `REJECTED` included. Rather than crash on a 409, we report what occupies it.
 */
async function ensureClaim(
  token: string,
  providerId: string,
  categoryId: string,
): Promise<{ pscId: string; status: string }> {
  const [existing] = await ds.query(
    `SELECT id, verification_status FROM professional_service_categories
      WHERE service_provider_id = $1 AND service_category_id = $2
        AND deleted_at_utc IS NULL`,
    [providerId, categoryId],
  );

  if (existing) {
    if (['PENDING', 'VERIFIED'].includes(existing.verification_status)) {
      console.log(
        `  = claim exists: ${existing.id} (${existing.verification_status})`,
      );
      return { pscId: existing.id, status: existing.verification_status };
    }
    fail(
      `the (provider, ${CATEGORY_SLUG}) couple is already taken by a ` +
        `${existing.verification_status} claim (${existing.id}).\n` +
        `  The unique index ignores verification_status, so this slot cannot be ` +
        `re-claimed while the row is live.\n` +
        `  Pick another trade: FIXTURE_CATEGORY_SLUG=plomberie|menuiserie`,
    );
  }

  const res = await api<any>('POST', `/service-providers/${providerId}/categories`, {
    token,
    body: { serviceCategoryId: categoryId },
  });
  if (res.status !== 201) {
    fail(`declare category → ${res.status} ${JSON.stringify(res.body)}`);
  }
  console.log(`  + claim declared: ${res.body.id} (${res.body.verificationStatus})`);
  return { pscId: res.body.id, status: res.body.verificationStatus };
}

interface RequirementRow {
  id: string;
  authority_code: string;
  required_document_type: string;
}

/** The required requirements of the provider's own jurisdiction. */
async function resolveRequirements(
  categoryId: string,
  countryCode: string,
  subdivisionCode: string,
): Promise<RequirementRow[]> {
  const rows: RequirementRow[] = await ds.query(
    `SELECT id, authority_code, required_document_type
       FROM regulatory_requirements
      WHERE service_category_id = $1
        AND country_code = $2
        AND (subdivision_code = $3 OR subdivision_code IS NULL)
        AND is_required = true
      ORDER BY authority_code`,
    [categoryId, countryCode, subdivisionCode],
  );
  if (rows.length === 0) {
    fail(`no required requirement for ${CATEGORY_SLUG} in ${countryCode}/${subdivisionCode}`);
  }
  return rows;
}

async function uploadDocument(
  token: string,
  providerId: string,
  pscId: string,
  req: RequirementRow,
): Promise<void> {
  const [already] = await ds.query(
    `SELECT id, review_status FROM verification_documents
      WHERE professional_service_category_id = $1
        AND regulatory_requirement_id = $2
        AND deleted_at_utc IS NULL
        AND review_status IN ('PENDING', 'APPROVED')`,
    [pscId, req.id],
  );
  if (already) {
    console.log(`  = document exists for ${req.authority_code} (${already.review_status})`);
    return;
  }

  // Any file exercises the plumbing; the content is not what is under test.
  const pdf = Buffer.from(
    '%PDF-1.4\n% Linkr fixture — fictional document, not a real licence\n%%EOF\n',
  );
  const form = new FormData();
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), `${req.authority_code}-fixture.pdf`);
  form.append('regulatoryRequirementId', req.id);
  form.append('documentType', req.required_document_type);
  form.append('documentNumber', FIXTURE_LICENCE_NUMBER[req.authority_code] ?? 'FIXTURE-0000');

  const res = await api<any>(
    'POST',
    `/service-providers/${providerId}/categories/${pscId}/documents`,
    { token, form },
  );
  if (res.status !== 201) {
    fail(`upload ${req.authority_code} → ${res.status} ${JSON.stringify(res.body)}`);
  }
  console.log(`  + document uploaded for ${req.authority_code}: ${res.body.id}`);
}

/** Approves through the same endpoint the admin console calls. */
async function approvePendingDocuments(adminToken: string, pscId: string): Promise<number> {
  const pending: Array<{ id: string }> = await ds.query(
    `SELECT id FROM verification_documents
      WHERE professional_service_category_id = $1
        AND review_status = 'PENDING'
        AND deleted_at_utc IS NULL
      ORDER BY created_at_utc`,
    [pscId],
  );

  for (const doc of pending) {
    const res = await api<any>(
      'POST',
      `/admin/verification-documents/${doc.id}/approve`,
      { token: adminToken },
    );
    if (res.status !== 201 && res.status !== 200) {
      fail(`approve ${doc.id} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    console.log(`  + approved document ${doc.id}`);
  }
  return pending.length;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    fail('refusing to run with NODE_ENV=production');
  }

  await ds.initialize();
  console.log(`\nFixture: VERIFIED provider on a REGULATED trade (${CATEGORY_SLUG})`);
  console.log(`API: ${API}\n`);

  console.log('Accounts');
  const provider = await ensureAccount(PROVIDER_EMAIL, 'Bob', 'Prestataire');
  await ensureAccount(ADMIN_EMAIL, 'Alice', 'Admin');
  await ensureAdminRole(ADMIN_EMAIL);
  // Re-login: the role is read from the database per request, but a fresh token
  // keeps the 15-minute window aligned with the slowest step.
  const admin = await ensureAccount(ADMIN_EMAIL, 'Alice', 'Admin');

  console.log('\nProvider profile');
  const providerId = await ensureProvider(provider.token);

  console.log('\nClaim');
  const category = await resolveCategory();
  const claim = await ensureClaim(provider.token, providerId, category.id);

  console.log('\nDocuments');
  const [owner] = await ds.query(
    `SELECT u.country_code, u.subdivision_code
       FROM service_providers sp JOIN users u ON u.id = sp.user_id
      WHERE sp.id = $1`,
    [providerId],
  );
  const requirements = await resolveRequirements(
    category.id,
    owner.country_code,
    owner.subdivision_code,
  );
  console.log(
    `  ${requirements.length} required requirement(s): ` +
      requirements.map((r) => r.authority_code).join(', '),
  );
  for (const req of requirements) {
    await uploadDocument(provider.token, providerId, claim.pscId, req);
  }

  console.log('\nAdmin review');
  const approved = await approvePendingDocuments(admin.token, claim.pscId);
  if (approved === 0) console.log('  = nothing pending');

  console.log('\nResult');
  const [final] = await ds.query(
    `SELECT verification_status, verified_at_utc
       FROM professional_service_categories WHERE id = $1`,
    [claim.pscId],
  );
  console.log(
    `  claim ${claim.pscId}: ${final.verification_status}` +
      ` (verified_at_utc=${final.verified_at_utc?.toISOString() ?? 'NULL'})`,
  );
  if (final.verification_status !== 'VERIFIED') {
    fail(
      `expected VERIFIED, got ${final.verification_status}. ` +
        `Every required requirement must be covered by an APPROVED, non-expired document.`,
    );
  }

  const [lng, lat] = BASE_LOCATION.coordinates;
  const discover = await api<any>(
    'GET',
    `/service-providers/discover?lat=${lat}&lng=${lng}&categoryId=${category.id}`,
    { token: provider.token },
  );
  const total = discover.body?.total ?? 0;
  console.log(`  discover(${CATEGORY_SLUG}) → total=${total}`);
  if (total < 1) fail('discover returned no provider for the verified trade');

  console.log('\n✓ Done.\n');
  await ds.destroy();
}

main().catch(async (err) => {
  console.error(err);
  await ds.destroy().catch(() => undefined);
  process.exit(1);
});
