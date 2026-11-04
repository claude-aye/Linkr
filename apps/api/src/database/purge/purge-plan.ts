/**
 * Purge e2e (mode A) — construction du plan : qui est visé, quelles lignes
 * partent, et ce qui l'interdit.
 *
 * Lecture seule. En exécution, le même calcul tourne DANS la transaction, APRÈS
 * le verrouillage des tables de la liste fermée (`lockModifiableTables`) : une
 * écriture concurrente sur l'une d'elles attend la fin de la purge, donc le
 * plan ne peut pas changer entre sa lecture et les suppressions.
 *
 * Contrôle de fermeture : une ligne n'est supprimée que si elle appartient
 * entièrement à des comptes visés. Toute ligne d'un compte HORS liste qui
 * pointe vers une entité e2e (demande d'un vrai testeur vers le prestataire
 * e2e, devis, avis, notification, adhésion…) est une VIOLATION : la purge
 * s'arrête et la liste. Elle ne modifie jamais une donnée tierce.
 *
 * Les demandes sont choisies par PROPRIÉTAIRE. Le préfixe de titre
 * « e2e-paiement- » ne sert qu'au signalement (cohérence), jamais à la sélection.
 */
import {
  assertNoAdmin,
  assertSingleFixedRow,
  classifyAccount,
  FIXED_E2E_EMAILS,
  LEGACY_E2E_EMAIL_SQL_PATTERN,
  ModifiableTable,
  planFingerprint,
  RetainedAccount,
} from './purge-rules';

export interface Queryable {
  query<R = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Violation {
  table: string;
  id: string;
  reason: string;
}

export interface PurgePlan {
  accounts: RetainedAccount[];
  ignored: Array<{ id: string; reason: string }>;
  rows: Record<ModifiableTable, string[]>;
  violations: Violation[];
  /** D6 : catalogue qui pointe vers un compte visé → arrêt. */
  catalogBlockers: Violation[];
  /** Signalements de cohérence (préfixe de titre), sans effet. */
  warnings: string[];
  fileKeys: string[];
  stripe: { customers: string[]; accounts: string[]; paymentMethods: string[] };
  fingerprint: string;
}

const TITLE_MARK = 'e2e-paiement-';

function emptyRows(): Record<ModifiableTable, string[]> {
  return {
    refunds: [],
    payments: [],
    reviews: [],
    notifications: [],
    quotes: [],
    service_request_attachments: [],
    service_request_assignments: [],
    service_requests: [],
    payment_methods: [],
    portfolio_items: [],
    verification_documents: [],
    professional_services: [],
    professional_service_categories: [],
    professional_service_zones: [],
    stripe_connect_accounts: [],
    service_providers: [],
    organization_memberships: [],
    password_reset_tokens: [],
    user_auth_providers: [],
    users: [],
  };
}

const uniq = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

export async function buildPlan(db: Queryable): Promise<PurgePlan> {
  const rows = emptyRows();
  const violations: Violation[] = [];
  const warnings: string[] = [];

  // 1. Comptes : égalité exacte OU regex ancrée, sur l'adresse BRUTE (aucun
  //    passage en minuscules : voir purge-rules.ts). `~` est sensible à la casse.
  const candidates = await db.query<{
    id: string;
    email: string;
    first_name: string;
    system_role: string;
    deleted_at_utc: Date | null;
  }>(
    `SELECT id, email, first_name, system_role, deleted_at_utc
       FROM users
      WHERE email = ANY($1::text[]) OR email ~ $2
      ORDER BY id`,
    [FIXED_E2E_EMAILS, LEGACY_E2E_EMAIL_SQL_PATTERN],
  );

  const accounts: RetainedAccount[] = [];
  const ignored: Array<{ id: string; reason: string }> = [];
  for (const c of candidates.rows) {
    const decision = classifyAccount({
      id: c.id,
      email: c.email,
      firstName: c.first_name,
      systemRole: c.system_role,
      deletedAtUtc: c.deleted_at_utc,
    });
    if (decision.kind === 'retained') accounts.push(decision.account);
    else ignored.push({ id: decision.id, reason: decision.reason });
  }
  assertSingleFixedRow(candidates.rows.map((c) => c.email));
  assertNoAdmin(accounts);

  const T = accounts.map((a) => a.id);
  const TF = accounts.filter((a) => a.mode === 'FULL').map((a) => a.id);
  const inT = new Set(T);
  const inTF = new Set(TF);

  // 2. Prestataires des comptes visés (supprimés en douceur compris).
  const providers = await db.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM service_providers WHERE user_id = ANY($1::uuid[]) ORDER BY id`,
    [T],
  );
  const TP = providers.rows.map((p) => p.id);
  const TPF = providers.rows.filter((p) => inTF.has(p.user_id)).map((p) => p.id);
  const inTP = new Set(TP);

  // 3. Demandes : supprimables seulement si TOUTES leurs parties sont visées.
  const requests = await db.query<{
    id: string;
    client_user_id: string;
    requested_service_provider_id: string | null;
    assigned_service_provider_id: string | null;
    cancelled_by_user_id: string | null;
  }>(
    `SELECT id, client_user_id, requested_service_provider_id, assigned_service_provider_id,
            cancelled_by_user_id
       FROM service_requests
      WHERE client_user_id = ANY($1::uuid[])
         OR requested_service_provider_id = ANY($2::uuid[])
         OR assigned_service_provider_id = ANY($2::uuid[])
         OR cancelled_by_user_id = ANY($3::uuid[])
      ORDER BY id`,
    [T, TP, TF],
  );
  const R: string[] = [];
  for (const r of requests.rows) {
    const purgeable =
      inT.has(r.client_user_id) &&
      (r.requested_service_provider_id === null || inTP.has(r.requested_service_provider_id)) &&
      (r.assigned_service_provider_id === null || inTP.has(r.assigned_service_provider_id));
    if (purgeable) R.push(r.id);
    else violations.push({ table: 'service_requests', id: r.id, reason: 'demande avec une partie hors liste e2e' });
  }
  rows.service_requests = uniq(R);
  const inR = new Set(R);

  // 4. Dépendants des demandes, et lignes des comptes visés hors de ces demandes.
  const quotes = await db.query<{ id: string; service_request_id: string; service_provider_id: string }>(
    `SELECT id, service_request_id, service_provider_id FROM quotes
      WHERE service_request_id = ANY($1::uuid[]) OR service_provider_id = ANY($2::uuid[])`,
    [R, TP],
  );
  for (const q of quotes.rows) {
    if (inR.has(q.service_request_id) && inTP.has(q.service_provider_id)) rows.quotes.push(q.id);
    else violations.push({ table: 'quotes', id: q.id, reason: 'devis qui relie une demande et un prestataire de part et d’autre de la liste' });
  }

  const notifications = await db.query<{
    id: string;
    service_request_id: string | null;
    recipient_user_id: string | null;
    recipient_service_provider_id: string | null;
  }>(
    `SELECT id, service_request_id, recipient_user_id, recipient_service_provider_id FROM notifications
      WHERE service_request_id = ANY($1::uuid[])
         OR recipient_user_id = ANY($2::uuid[])
         OR recipient_service_provider_id = ANY($3::uuid[])`,
    [R, T, TP],
  );
  for (const n of notifications.rows) {
    const recipientIsTarget =
      (n.recipient_user_id !== null && inT.has(n.recipient_user_id)) ||
      (n.recipient_service_provider_id !== null && inTP.has(n.recipient_service_provider_id));
    if (recipientIsTarget) rows.notifications.push(n.id);
    else violations.push({ table: 'notifications', id: n.id, reason: 'notification d’un compte hors liste sur une demande e2e' });
  }

  const assignments = await db.query<{
    id: string;
    service_request_id: string;
    worker_user_id: string;
    assigned_by_user_id: string;
  }>(
    `SELECT id, service_request_id, worker_user_id, assigned_by_user_id FROM service_request_assignments
      WHERE service_request_id = ANY($1::uuid[])
         OR worker_user_id = ANY($2::uuid[]) OR assigned_by_user_id = ANY($2::uuid[])`,
    [R, T],
  );
  for (const a of assignments.rows) {
    if (inR.has(a.service_request_id) && inT.has(a.worker_user_id) && inT.has(a.assigned_by_user_id)) {
      rows.service_request_assignments.push(a.id);
    } else {
      violations.push({ table: 'service_request_assignments', id: a.id, reason: 'affectation avec une partie hors liste e2e' });
    }
  }

  const attachments = await db.query<{
    id: string;
    service_request_id: string;
    uploaded_by_user_id: string;
    file_url: string;
  }>(
    `SELECT id, service_request_id, uploaded_by_user_id, file_url FROM service_request_attachments
      WHERE service_request_id = ANY($1::uuid[]) OR uploaded_by_user_id = ANY($2::uuid[])`,
    [R, T],
  );
  const fileKeys: string[] = [];
  for (const a of attachments.rows) {
    if (inR.has(a.service_request_id) && inT.has(a.uploaded_by_user_id)) {
      rows.service_request_attachments.push(a.id);
      fileKeys.push(a.file_url);
    } else {
      violations.push({ table: 'service_request_attachments', id: a.id, reason: 'pièce jointe avec une partie hors liste e2e' });
    }
  }

  const reviews = await db.query<{
    id: string;
    service_request_id: string;
    author_user_id: string;
    service_provider_id: string;
  }>(
    `SELECT id, service_request_id, author_user_id, service_provider_id FROM reviews
      WHERE service_request_id = ANY($1::uuid[])
         OR author_user_id = ANY($2::uuid[]) OR service_provider_id = ANY($3::uuid[])`,
    [R, T, TP],
  );
  for (const v of reviews.rows) {
    if (inR.has(v.service_request_id) && inT.has(v.author_user_id) && inTP.has(v.service_provider_id)) {
      rows.reviews.push(v.id);
    } else {
      violations.push({ table: 'reviews', id: v.id, reason: 'avis avec une partie hors liste e2e' });
    }
  }

  const methods = await db.query<{ id: string; stripe_payment_method_id: string }>(
    `SELECT id, stripe_payment_method_id FROM payment_methods WHERE owner_user_id = ANY($1::uuid[])`,
    [T],
  );
  rows.payment_methods = methods.rows.map((m) => m.id);
  const PM = rows.payment_methods;
  const inPM = new Set(PM);

  const payments = await db.query<{
    id: string;
    service_request_id: string;
    payer_user_id: string;
    payer_organization_id: string | null;
    recipient_service_provider_id: string;
    payment_method_id: string;
  }>(
    `SELECT id, service_request_id, payer_user_id, payer_organization_id,
            recipient_service_provider_id, payment_method_id
       FROM payments
      WHERE service_request_id = ANY($1::uuid[])
         OR payer_user_id = ANY($2::uuid[])
         OR recipient_service_provider_id = ANY($3::uuid[])
         OR payment_method_id = ANY($4::uuid[])`,
    [R, T, TP, PM],
  );
  for (const p of payments.rows) {
    const ok =
      inR.has(p.service_request_id) &&
      inT.has(p.payer_user_id) &&
      p.payer_organization_id === null &&
      inTP.has(p.recipient_service_provider_id) &&
      inPM.has(p.payment_method_id);
    if (ok) rows.payments.push(p.id);
    else violations.push({ table: 'payments', id: p.id, reason: 'paiement avec une partie hors liste e2e' });
  }
  const inPAY = new Set(rows.payments);

  const refunds = await db.query<{ id: string; payment_id: string }>(
    `SELECT id, payment_id FROM refunds WHERE payment_id = ANY($1::uuid[]) OR initiated_by_user_id = ANY($2::uuid[])`,
    [rows.payments, TF],
  );
  for (const r of refunds.rows) {
    if (inPAY.has(r.payment_id)) rows.refunds.push(r.id);
    else violations.push({ table: 'refunds', id: r.id, reason: 'remboursement hors des paiements e2e' });
  }

  // 5. Comptes supprimés en entier : tout ce qui leur est rattaché.
  const memberships = await db.query<{ id: string }>(
    `SELECT id FROM organization_memberships WHERE user_id = ANY($1::uuid[])`,
    [TF],
  );
  for (const m of memberships.rows) {
    violations.push({ table: 'organization_memberships', id: m.id, reason: 'adhésion à une organisation (donnée d’organisation)' });
  }

  const pscs = await db.query<{ id: string }>(
    `SELECT id FROM professional_service_categories WHERE service_provider_id = ANY($1::uuid[])`,
    [TPF],
  );
  rows.professional_service_categories = pscs.rows.map((r) => r.id);
  const inPSC = new Set(rows.professional_service_categories);

  const services = await db.query<{ id: string }>(
    `SELECT id FROM professional_services WHERE professional_service_category_id = ANY($1::uuid[])`,
    [rows.professional_service_categories],
  );
  rows.professional_services = services.rows.map((r) => r.id);

  const docs = await db.query<{ id: string; professional_service_category_id: string; file_url: string }>(
    `SELECT id, professional_service_category_id, file_url FROM verification_documents
      WHERE professional_service_category_id = ANY($1::uuid[]) OR reviewed_by_user_id = ANY($2::uuid[])`,
    [rows.professional_service_categories, TF],
  );
  for (const d of docs.rows) {
    if (inPSC.has(d.professional_service_category_id)) {
      rows.verification_documents.push(d.id);
      fileKeys.push(d.file_url);
    } else {
      violations.push({ table: 'verification_documents', id: d.id, reason: 'document revu par un compte e2e hors de ses métiers' });
    }
  }

  const zones = await db.query<{ id: string }>(
    `SELECT id FROM professional_service_zones WHERE service_provider_id = ANY($1::uuid[])`,
    [TPF],
  );
  rows.professional_service_zones = zones.rows.map((r) => r.id);

  const portfolio = await db.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM portfolio_items WHERE service_provider_id = ANY($1::uuid[])`,
    [TPF],
  );
  rows.portfolio_items = portfolio.rows.map((r) => r.id);
  fileKeys.push(...portfolio.rows.map((r) => r.storage_key));

  const connect = await db.query<{ id: string; stripe_account_id: string }>(
    `SELECT id, stripe_account_id FROM stripe_connect_accounts WHERE service_provider_id = ANY($1::uuid[])`,
    [TPF],
  );
  rows.stripe_connect_accounts = connect.rows.map((r) => r.id);
  rows.service_providers = [...TPF];

  const resetTokens = await db.query<{ id: string }>(
    `SELECT id FROM password_reset_tokens WHERE user_id = ANY($1::uuid[])`,
    [TF],
  );
  rows.password_reset_tokens = resetTokens.rows.map((r) => r.id);
  const authProviders = await db.query<{ id: string }>(
    `SELECT id FROM user_auth_providers WHERE user_id = ANY($1::uuid[])`,
    [TF],
  );
  rows.user_auth_providers = authProviders.rows.map((r) => r.id);

  const fullUsers = await db.query<{ id: string; stripe_customer_id: string | null }>(
    `SELECT id, stripe_customer_id FROM users WHERE id = ANY($1::uuid[])`,
    [TF],
  );
  rows.users = [...TF];

  // 6. D6 : le catalogue ne doit pointer vers aucun compte visé.
  const catalog = await db.query<{ id: string; suggested_by_user_id: string | null; approved_by_user_id: string | null }>(
    `SELECT id, suggested_by_user_id, approved_by_user_id FROM service_items
      WHERE suggested_by_user_id = ANY($1::uuid[]) OR approved_by_user_id = ANY($1::uuid[])`,
    [T],
  );
  const catalogBlockers: Violation[] = catalog.rows.map((s) => ({
    table: 'service_items',
    id: s.id,
    reason: 'service du catalogue proposé ou approuvé par un compte visé (D6)',
  }));

  // 7. Signalement de cohérence : titre e2e-paiement- hors des demandes visées.
  const marked = await db.query<{ id: string }>(
    `SELECT id FROM service_requests WHERE left(title, $1) = $2 ORDER BY id`,
    [TITLE_MARK.length, TITLE_MARK],
  );
  for (const m of marked.rows) {
    if (!inR.has(m.id)) warnings.push(`demande ${m.id} titrée « ${TITLE_MARK}… » hors des demandes supprimables`);
  }
  for (const i of ignored) warnings.push(`compte ${i.id} non visé : ${i.reason}`);

  // 8. Identifiants Stripe des seules entités supprimées (aucun appel Stripe).
  const stripe = {
    customers: uniq(fullUsers.rows.map((u) => u.stripe_customer_id).filter((x): x is string => !!x)),
    accounts: uniq(connect.rows.map((c) => c.stripe_account_id)),
    paymentMethods: uniq(methods.rows.map((m) => m.stripe_payment_method_id)),
  };

  for (const table of Object.keys(rows) as ModifiableTable[]) rows[table] = uniq(rows[table]);

  return {
    accounts,
    ignored,
    rows,
    violations,
    catalogBlockers,
    warnings,
    fileKeys: uniq(fileKeys),
    stripe,
    fingerprint: planFingerprint(accounts, rows),
  };
}

export function isBlocked(plan: PurgePlan): boolean {
  return plan.violations.length > 0 || plan.catalogBlockers.length > 0;
}

/** Aucune ligne à supprimer (les comptes fixes peuvent être visés sans rien à purger). */
export function isEmpty(plan: PurgePlan): boolean {
  return (Object.keys(plan.rows) as ModifiableTable[]).every((t) => plan.rows[t].length === 0);
}
