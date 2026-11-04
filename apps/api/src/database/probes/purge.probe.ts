/**
 * Sonde de la purge e2e (mode A) — ce que seule une VRAIE base peut prouver.
 *
 * jest teste les règles pures et un plan sur une base factice. Il ne voit ni
 * les clés étrangères, ni les droits du rôle linkr_purge, ni les verrous
 * FOR UPDATE, ni la transaction. Cette sonde appelle le code LIVRÉ
 * (`buildPlan`, `executePurge`, `assertPurgeRole`, `retryLeftoverFiles`)
 * connecté avec le rôle créé par `roleGrantSql()` — jamais une copie du SQL.
 *
 * Scénarios :
 *   A. un vrai testeur a réservé le prestataire e2e → purge BLOQUÉE, rien supprimé ;
 *   B. ADMIN au format e2e → refus net ; catalogue qui pointe vers un compte
 *      visé (D6) → bloqué ; connexion en super-utilisateur → refus ;
 *   C. phrase fausse, puis base modifiée après la simulation → rien supprimé ;
 *   D. purge réelle : comptes fixes vidés de leurs transactions mais gardés
 *      (utilisateur, prestataire, métier, service, compte Connect), anciens
 *      comptes supprimés en entier avec leurs fichiers, liste Stripe exacte,
 *      catalogue identique, données réelles et adresses proches intactes ;
 *   E. second passage : rien à purger, et l'exécution sans phrase reprend quand
 *      même les fichiers restants (fichier sans ligne supprimé, fichier encore
 *      référencé gardé) ;
 * plus, depuis la relecture indépendante : adresses sosies (casse, signe
 * Kelvin, ancienne adresse en majuscules) et compte fixe au mauvais prénom
 * jamais visés, adresse fixe en double refusée (I1) ; colonnes de hachés
 * illisibles au rôle (M2) ; COMMIT incertain qui garde la liste Stripe (M1) ;
 * échec de l'étape fichiers après le COMMIT, rapport de base déjà émis (I3).
 *
 * Lancement (base JETABLE seulement — refus de tout nom sans « probe ») :
 *   PURGE_PROBE_ADMIN_URL=postgresql://<superuser>@…/linkr_purge_probe \
 *     npx ts-node src/database/probes/purge.probe.ts
 * Le rôle linkr_purge est créé avec un mot de passe aléatoire, puis supprimé.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

import {
  assertPurgeRole,
  catalogFingerprint,
  CommitUncertainError,
  CommittedReport,
  executePurge,
  lockModifiableTables,
  PostCommitError,
  sameCatalog,
} from '../purge/purge-execute';
import { buildPlan, isBlocked, PurgePlan } from '../purge/purge-plan';
import { DELETE_ORDER, planPhrase, PurgeRefusal, roleGrantSql } from '../purge/purge-rules';

let passed = 0;
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${a}`);
  }
}

async function refusal(label: string, fn: () => Promise<unknown>, fragment?: string): Promise<void> {
  try {
    await fn();
    check(`${label} (refus)`, 'aucun refus', 'PurgeRefusal');
  } catch (err) {
    const ok = err instanceof PurgeRefusal && (!fragment || err.message.includes(fragment));
    check(`${label} (refus)`, ok ? 'PurgeRefusal' : String(err), 'PurgeRefusal');
  }
}

const id = (n: number): string => `f0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

// Comptes
const U_FP = id(1); // fixe prestataire
const U_FC = id(2); // fixe client
const U_LP = id(3); // ancien prestataire
const U_LC = id(4); // ancien client
const U_REAL = id(5); // vrai testeur
const U_REALPRO = id(6); // vrai prestataire
const U_ADMIN = id(7); // administrateur
const U_NEAR = id(8); // adresse proche
const U_WRONGNAME = id(9); // bon format, mauvais prénom
const U_LOOK_CASE = id(10); // « E2E-Client@LinkrApp.com »
const U_LOOK_KELVIN = id(11); // signe Kelvin U+212A
const U_LOOK_LEGACY = id(12); // ancienne adresse en majuscules
const U_DUP = id(13); // doublon supprimé en douceur d'une adresse fixe
// Prestataires
const P_FIX = id(101);
const P_LEG = id(102);
const P_REAL = id(103);
// Catalogue
const CAT = id(201);
const ITEM = id(202);
const REQ_REG = id(203);
// Métiers et services
const PSC_FIX = id(301);
const PSC_LEG = id(302);
const PSC_REAL = id(303);
const PS_FIX = id(311);
const PS_LEG = id(312);
const ZONE_LEG = id(321);
const DOC_LEG = id(331);
const PORT_LEG = id(341);
const PORT_REAL = id(342);
// Connect, cartes
const CON_FIX = id(401);
const CON_LEG = id(402);
const PM_FC = id(411);
const PM_LC = id(412);
const PM_REAL = id(413);
const PM_LOOK = id(414);
// Demandes
const SR_FIX_DONE = id(501);
const SR_FIX_TENDER = id(502);
const SR_LEG = id(503);
const SR_REAL = id(504);
const SR_BLOCK = id(505); // vrai testeur → prestataire e2e
const SR_REAL_TENDER = id(506);
// Dépendants
const ASG_FIX = id(601);
const ATT_FIX = id(611);
const Q_FIX = id(621);
const Q_BLOCK = id(622); // devis e2e sur un vrai appel d'offres
const REV_FIX = id(631);
const N_FIX_1 = id(641);
const N_FIX_2 = id(642);
const N_LATE = id(643);
const PAY_DEP = id(651);
const PAY_BAL = id(652);
const PAY_LEG = id(653);
const REF_FIX = id(661);
const RESET_LEG = id(671);

const FIXED_EMAILS = ['e2e-prestataire@linkrapp.com', 'e2e-client@linkrapp.com'];
const LEGACY_PRO = 'e2e+prestataire-20261102-ab12cd34@gmail.com';
const LEGACY_CLIENT = 'e2e+client-20261102-0f0f0f0f@gmail.com';

const KEY_ATT = `service-request-attachments/${SR_FIX_DONE}/photo.webp`;
const KEY_DOC = `verifications/${PSC_LEG}/licence.pdf`;
const KEY_PORT_LEG = `portfolio/${P_LEG}/a.webp`;
const KEY_PORT_REAL = `portfolio/${P_REAL}/b.webp`;
const KEY_ORPHAN = `portfolio/${P_LEG}/orphelin.webp`;

const POINT = `ST_SetSRID(ST_MakePoint(-71.2, 46.8), 4326)`;

async function insertUser(db: Client, uid: string, email: string, first: string, extra: Record<string, unknown> = {}): Promise<void> {
  const cols = ['id', 'email', 'first_name', 'last_name', 'country_code', 'subdivision_code', 'preferred_currency', ...Object.keys(extra)];
  const vals = [uid, email, first, 'Sonde', 'CA', 'CA-QC', 'CAD', ...Object.values(extra)];
  await db.query(
    `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals,
  );
  await db.query(`INSERT INTO user_auth_providers (user_id, provider_type, password_hash) VALUES ($1, 'EMAIL_PASSWORD', 'x')`, [uid]);
}

async function insertProvider(db: Client, pid: string, uid: string): Promise<void> {
  await db.query(
    `INSERT INTO service_providers (id, provider_type, user_id, service_base_location, service_radius_km)
     VALUES ($1, 'INDIVIDUAL', $2, ${POINT}::geography, 25)`,
    [pid, uid],
  );
}

async function insertRequest(db: Client, rid: string, client: string, opts: { requested?: string; assigned?: string; type?: string; status?: string; title?: string }): Promise<void> {
  await db.query(
    `INSERT INTO service_requests (id, client_user_id, request_type, status, service_category_id,
       requested_service_provider_id, assigned_service_provider_id, title, description, service_address, service_location)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sonde', 'adresse', ${POINT})`,
    [rid, client, opts.type ?? 'DIRECT_BOOKING', opts.status ?? 'OPEN', CAT, opts.requested ?? null, opts.assigned ?? null, opts.title ?? 'sonde purge'],
  );
}

async function seed(db: Client, storage: string): Promise<void> {
  // Catalogue
  await db.query(
    `INSERT INTO service_categories (id, slug, name_translations, regulation_level) VALUES ($1, 'sonde-purge', '{"fr-CA":"Sonde"}', 'INFORMAL')`,
    [CAT],
  );
  await db.query(
    `INSERT INTO service_items (id, service_category_id, slug, name_translations, approval_status) VALUES ($1, $2, 'sonde-item', '{"fr-CA":"Item"}', 'APPROVED')`,
    [ITEM, CAT],
  );
  await db.query(
    `INSERT INTO regulatory_requirements (id, service_category_id, country_code, authority_code, authority_full_name_translations, required_document_type, input_type)
     VALUES ($1, $2, 'CA', 'SONDE', '{"fr-CA":"Sonde"}', 'LICENSE_NUMBER', 'FILE_UPLOAD')`,
    [REQ_REG, CAT],
  );

  // Comptes
  await insertUser(db, U_FP, FIXED_EMAILS[0], 'e2e');
  await insertUser(db, U_FC, FIXED_EMAILS[1], 'e2e', { stripe_customer_id: 'cus_sonde_fixe' });
  await insertUser(db, U_LP, LEGACY_PRO, 'e2e', { stripe_customer_id: 'cus_sonde_ancien' });
  await insertUser(db, U_LC, LEGACY_CLIENT, 'e2e');
  await insertUser(db, U_REAL, 'vrai-testeur@linkr.test', 'Carole', { stripe_customer_id: 'cus_sonde_reel' });
  await insertUser(db, U_REALPRO, 'vrai-pro@linkr.test', 'Paul');
  await insertUser(db, U_ADMIN, 'admin-sonde@linkr.test', 'Ada', { system_role: 'ADMIN' });
  await insertUser(db, U_NEAR, 'xe2e+client-20261102-ab12cd34@gmail.com', 'e2e');
  await insertUser(db, U_WRONGNAME, 'e2e+client-20261102-11111111@gmail.com', 'Carol');
  await insertUser(db, U_LOOK_CASE, 'E2E-Client@LinkrApp.com', 'e2e');
  await insertUser(db, U_LOOK_KELVIN, 'e2e-client@lin\u212Arapp.com', 'e2e');
  await insertUser(db, U_LOOK_LEGACY, 'E2E+client-20261102-ab12cd34@gmail.com', 'e2e');

  // Prestataires, métiers, services, Connect
  await insertProvider(db, P_FIX, U_FP);
  await insertProvider(db, P_LEG, U_LP);
  await insertProvider(db, P_REAL, U_REALPRO);
  for (const [psc, pid] of [[PSC_FIX, P_FIX], [PSC_LEG, P_LEG], [PSC_REAL, P_REAL]]) {
    await db.query(
      `INSERT INTO professional_service_categories (id, service_provider_id, service_category_id, verification_status, requested_at_utc)
       VALUES ($1, $2, $3, 'NOT_REQUIRED', now())`,
      [psc, pid, CAT],
    );
  }
  for (const [ps, psc] of [[PS_FIX, PSC_FIX], [PS_LEG, PSC_LEG]]) {
    await db.query(
      `INSERT INTO professional_services (id, professional_service_category_id, service_item_id, pricing_model, price_amount, price_currency)
       VALUES ($1, $2, $3, 'FLAT', 40, 'CAD')`,
      [ps, psc, ITEM],
    );
  }
  await db.query(
    `INSERT INTO professional_service_zones (id, service_provider_id, zone_polygon, zone_label)
     VALUES ($1, $2, ST_GeogFromText('SRID=4326;POLYGON((-71.3 46.7,-71.1 46.7,-71.1 46.9,-71.3 46.9,-71.3 46.7))'), 'Sonde')`,
    [ZONE_LEG, P_LEG],
  );
  await db.query(
    `INSERT INTO verification_documents (id, professional_service_category_id, regulatory_requirement_id, document_type, file_url, file_mime_type, file_size_bytes)
     VALUES ($1, $2, $3, 'LICENSE_NUMBER', $4, 'application/pdf', 10)`,
    [DOC_LEG, PSC_LEG, REQ_REG, KEY_DOC],
  );
  for (const [pi, pid, key] of [[PORT_LEG, P_LEG, KEY_PORT_LEG], [PORT_REAL, P_REAL, KEY_PORT_REAL]]) {
    await db.query(
      `INSERT INTO portfolio_items (id, service_provider_id, storage_key, position, content_type, width, height, byte_size)
       VALUES ($1, $2, $3, 0, 'image/webp', 10, 10, 10)`,
      [pi, pid, key],
    );
  }
  for (const [cid, pid, acct] of [[CON_FIX, P_FIX, 'acct_sonde_fixe'], [CON_LEG, P_LEG, 'acct_sonde_ancien']]) {
    await db.query(
      `INSERT INTO stripe_connect_accounts (id, service_provider_id, stripe_account_id, country_code, default_currency) VALUES ($1, $2, $3, 'CA', 'CAD')`,
      [cid, pid, acct],
    );
  }
  for (const [pm, owner, spm] of [[PM_FC, U_FC, 'pm_sonde_fixe'], [PM_LC, U_LC, 'pm_sonde_ancien'], [PM_REAL, U_REAL, 'pm_sonde_reel'], [PM_LOOK, U_LOOK_CASE, 'pm_sonde_sosie']]) {
    await db.query(
      `INSERT INTO payment_methods (id, owner_user_id, stripe_payment_method_id, type, last4, is_default) VALUES ($1, $2, $3, 'CARD', '4242', true)`,
      [pm, owner, spm],
    );
  }
  await db.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at_utc) VALUES ($1, $2, 'hash-sonde', now() + interval '1 hour')`,
    [RESET_LEG, U_LP],
  );

  // Transactions des comptes fixes
  await insertRequest(db, SR_FIX_DONE, U_FC, { requested: P_FIX, assigned: P_FIX, status: 'COMPLETED', title: 'e2e-paiement-20261102T1200Z' });
  await db.query(
    `INSERT INTO service_request_assignments (id, service_request_id, worker_user_id, assigned_by_user_id, status, assigned_at_utc)
     VALUES ($1, $2, $3, $3, 'COMPLETED', now())`,
    [ASG_FIX, SR_FIX_DONE, U_FP],
  );
  await db.query(
    `INSERT INTO service_request_attachments (id, service_request_id, attachment_kind, file_url, file_mime_type, file_size_bytes, uploaded_by_user_id)
     VALUES ($1, $2, 'CLIENT_PHOTO', $3, 'image/webp', 10, $4)`,
    [ATT_FIX, SR_FIX_DONE, KEY_ATT, U_FC],
  );
  await db.query(
    `INSERT INTO reviews (id, service_request_id, service_provider_id, author_user_id, rating) VALUES ($1, $2, $3, $4, 5)`,
    [REV_FIX, SR_FIX_DONE, P_FIX, U_FC],
  );
  await db.query(
    `INSERT INTO notifications (id, type, recipient_service_provider_id, service_request_id) VALUES ($1, 'NEW_DIRECT_BOOKING', $2, $3)`,
    [N_FIX_1, P_FIX, SR_FIX_DONE],
  );
  for (const [pay, type, req, payer, recipient, pm, amount] of [
    [PAY_DEP, 'DEPOSIT', SR_FIX_DONE, U_FC, P_FIX, PM_FC, 8],
    [PAY_BAL, 'BALANCE', SR_FIX_DONE, U_FC, P_FIX, PM_FC, 32],
  ] as const) {
    await db.query(
      `INSERT INTO payments (id, service_request_id, payment_type, payer_user_id, recipient_service_provider_id, payment_method_id, gross_amount, currency, provider_net_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'CAD', $7, 'SUCCEEDED')`,
      [pay, req, type, payer, recipient, pm, amount],
    );
  }
  await db.query(
    `INSERT INTO refunds (id, payment_id, amount, currency, reason, initiated_by_user_id) VALUES ($1, $2, 8, 'CAD', 'sonde', $3)`,
    [REF_FIX, PAY_DEP, U_ADMIN],
  );
  await insertRequest(db, SR_FIX_TENDER, U_FC, { type: 'PROJECT_TENDER' });
  await db.query(
    `INSERT INTO quotes (id, service_request_id, service_provider_id, amount, currency, estimated_duration_minutes, description, valid_until_utc)
     VALUES ($1, $2, $3, 50, 'CAD', 60, 'sonde', now() + interval '7 days')`,
    [Q_FIX, SR_FIX_TENDER, P_FIX],
  );
  await db.query(
    `INSERT INTO notifications (id, type, recipient_service_provider_id, service_request_id) VALUES ($1, 'NEW_TENDER_MATCH', $2, $3)`,
    [N_FIX_2, P_FIX, SR_FIX_TENDER],
  );

  // Transactions des anciens comptes
  await insertRequest(db, SR_LEG, U_LC, { requested: P_LEG, assigned: P_LEG, status: 'ASSIGNED' });
  await db.query(
    `INSERT INTO payments (id, service_request_id, payment_type, payer_user_id, recipient_service_provider_id, payment_method_id, gross_amount, currency, provider_net_amount)
     VALUES ($1, $2, 'DEPOSIT', $3, $4, $5, 8, 'CAD', 8)`,
    [PAY_LEG, SR_LEG, U_LC, P_LEG, PM_LC],
  );

  // Données réelles, hors liste
  await insertRequest(db, SR_REAL, U_REAL, { requested: P_REAL });
  await insertRequest(db, SR_REAL_TENDER, U_REAL, { type: 'PROJECT_TENDER' });

  // Fichiers du volume
  for (const key of [KEY_ATT, KEY_DOC, KEY_PORT_LEG, KEY_PORT_REAL, KEY_ORPHAN]) {
    const full = join(storage, key);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'x');
  }
}

async function counts(db: Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of DELETE_ORDER) {
    out[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  }
  return out;
}

async function asPurge(url: string, fn: (db: Client) => Promise<void>): Promise<void> {
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await fn(db);
  } finally {
    await db.end();
  }
}

async function simulate(db: Client): Promise<PurgePlan> {
  await db.query('BEGIN TRANSACTION READ ONLY');
  try {
    return await buildPlan(db);
  } finally {
    await db.query('ROLLBACK');
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.PURGE_PROBE_ADMIN_URL ?? '';
  const parsed = new URL(adminUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!dbName.includes('probe')) throw new Error(`Refus : « ${dbName} » n'est pas une base jetable (le nom doit contenir « probe »).`);

  const password = randomBytes(24).toString('hex');
  const purgeUrl = new URL(adminUrl);
  purgeUrl.username = 'linkr_purge';
  purgeUrl.password = password;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const work = mkdtempSync(join(tmpdir(), 'linkr-purge-probe-'));
  const storage = join(work, 'uploads');
  const outDir = join(work, 'purge-out');
  mkdirSync(storage);
  mkdirSync(outDir);

  try {
    // Rôle exact de la documentation, mot de passe aléatoire jamais écrit.
    const exists = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'linkr_purge'`);
    if (exists.rowCount) throw new Error('le rôle linkr_purge existe déjà dans ce cluster : arrêt (rien supprimé)');
    for (const stmt of roleGrantSql().split('\n')) {
      await admin.query(stmt.replace('<mot de passe généré>', password));
    }

    await seed(admin, storage);
    const catalogBefore = await catalogFingerprint(admin);
    const before = await counts(admin);

    console.log('A. Vrai testeur qui a réservé le prestataire e2e');
    await insertRequest(admin, SR_BLOCK, U_REAL, { requested: P_FIX });
    await admin.query(
      `INSERT INTO quotes (id, service_request_id, service_provider_id, amount, currency, estimated_duration_minutes, description, valid_until_utc)
       VALUES ($1, $2, $3, 50, 'CAD', 60, 'sonde', now() + interval '7 days')`,
      [Q_BLOCK, SR_REAL_TENDER, P_FIX],
    );
    await asPurge(purgeUrl.toString(), async (db) => {
      await assertPurgeRole(db);
      check('le rôle linkr_purge passe assertPurgeRole', true, true);
      const plan = await simulate(db);
      check('purge bloquée', isBlocked(plan), true);
      check('violations listées', plan.violations.map((v) => `${v.table}:${v.id}`).sort(), [`quotes:${Q_BLOCK}`, `service_requests:${SR_BLOCK}`]);
      check('la demande du vrai testeur n’est pas dans le plan', plan.rows.service_requests.includes(SR_BLOCK), false);
      await refusal(
        'exécution d’un plan bloqué',
        () => executePurge(db, { confirm: planPhrase(plan.accounts, plan.fingerprint), outDir, storageDir: storage }),
        'bloquée',
      );
    });
    check('rien supprimé après le blocage', await counts(admin), { ...before, service_requests: before.service_requests + 1, quotes: before.quotes + 1 });
    check('aucune liste Stripe écrite', readdirSync(outDir), []);
    await admin.query(`DELETE FROM quotes WHERE id = $1`, [Q_BLOCK]);
    await admin.query(`DELETE FROM service_requests WHERE id = $1`, [SR_BLOCK]);

    console.log('V. Verrou des tables sous le rôle linkr_purge (droit DELETE seul)');
    await asPurge(purgeUrl.toString(), async (db) => {
      await db.query('BEGIN');
      await lockModifiableTables(db);
      check('les 20 tables se verrouillent sans droit UPDATE', true, true);
      await admin.query(`SET lock_timeout = '1s'`);
      let blocked = 'non bloquée';
      try {
        await admin.query(
          `INSERT INTO notifications (type, recipient_service_provider_id, service_request_id) VALUES ('NEW_DIRECT_BOOKING', $1, $2)`,
          [P_FIX, SR_FIX_DONE],
        );
      } catch (err) {
        blocked = /lock timeout/i.test(String(err)) ? 'bloquée' : String(err);
      }
      check('une écriture concurrente attend la fin de la purge', blocked, 'bloquée');
      await admin.query(`SET lock_timeout = 0`);
      await db.query('ROLLBACK');
    });
    check('rien écrit pendant le verrou', await counts(admin), before);
    await asPurge(purgeUrl.toString(), async (db) => {
      let denied = 'accepté';
      try {
        await db.query(`SELECT id FROM users LIMIT 1 FOR UPDATE`);
      } catch (err) {
        denied = /permission denied/.test(String(err)) ? 'refusé' : String(err);
      }
      check('FOR UPDATE refusé au rôle (raison du LOCK TABLE)', denied, 'refusé');
      let write = 'accepté';
      try {
        await db.query(`UPDATE service_categories SET sort_order = sort_order WHERE id = $1`, [CAT]);
      } catch (err) {
        write = /permission denied/.test(String(err)) ? 'refusé' : String(err);
      }
      check('écriture dans le catalogue refusée au rôle', write, 'refusé');
      for (const [table, col] of [['user_auth_providers', 'password_hash'], ['password_reset_tokens', 'token_hash']]) {
        let read = 'accepté';
        try {
          await db.query(`SELECT ${col} FROM ${table} LIMIT 1`);
        } catch (err) {
          read = /permission denied/.test(String(err)) ? 'refusé' : String(err);
        }
        check(`M2 : lecture de ${table}.${col} refusée au rôle`, read, 'refusé');
      }
      const ids = await db.query(`SELECT id, user_id FROM user_auth_providers WHERE user_id = $1`, [U_LP]);
      check('M2 : id et user_id restent lisibles', ids.rowCount, 1);
    });
    await admin.query(`GRANT SELECT (password_hash) ON TABLE user_auth_providers TO linkr_purge`);
    await asPurge(purgeUrl.toString(), async (db) => {
      await refusal('M2 : rôle qui peut lire password_hash', () => assertPurgeRole(db), 'password_hash');
    });
    await admin.query(`REVOKE SELECT (password_hash) ON TABLE user_auth_providers FROM linkr_purge`);

    console.log('B. ADMIN, catalogue, super-utilisateur');
    await refusal('connexion en super-utilisateur', () => assertPurgeRole(admin), 'super-utilisateur');
    await admin.query(`UPDATE users SET system_role = 'ADMIN' WHERE id = $1`, [U_LC]);
    await asPurge(purgeUrl.toString(), async (db) => {
      await refusal('compte ADMIN au format e2e', () => simulate(db), 'ADMIN');
    });
    await admin.query(`UPDATE users SET system_role = 'USER' WHERE id = $1`, [U_LC]);
    await admin.query(`UPDATE service_items SET suggested_by_user_id = $1 WHERE id = $2`, [U_FC, ITEM]);
    await asPurge(purgeUrl.toString(), async (db) => {
      const plan = await simulate(db);
      check('D6 : catalogue qui pointe vers un compte visé → bloqué', plan.catalogBlockers.map((b) => b.id), [ITEM]);
    });
    await admin.query(`UPDATE service_items SET suggested_by_user_id = NULL WHERE id = $1`, [ITEM]);
    await insertUser(admin, U_DUP, FIXED_EMAILS[1], 'e2e', { deleted_at_utc: new Date() });
    await asPurge(purgeUrl.toString(), async (db) => {
      await refusal('I1 : adresse fixe en double (une ligne supprimée en douceur)', () => simulate(db), 'lignes');
    });
    await admin.query(`DELETE FROM user_auth_providers WHERE user_id = $1`, [U_DUP]);
    await admin.query(`DELETE FROM users WHERE id = $1`, [U_DUP]);
    await admin.query(`UPDATE users SET first_name = 'Carole' WHERE id = $1`, [U_FC]);
    await asPurge(purgeUrl.toString(), async (db) => {
      const plan = await simulate(db);
      check('I1 : compte fixe au mauvais prénom non visé', plan.accounts.some((a) => a.id === U_FC), false);
      check('I1 : ses demandes vers le prestataire e2e bloquent la purge', isBlocked(plan), true);
    });
    await admin.query(`UPDATE users SET first_name = 'e2e' WHERE id = $1`, [U_FC]);
    check('rien supprimé après les refus', await counts(admin), before);

    console.log('C. Phrase fausse, puis base modifiée après la simulation');
    let phrase = '';
    await asPurge(purgeUrl.toString(), async (db) => {
      const plan = await simulate(db);
      check('plan non bloqué', isBlocked(plan), false);
      check('comptes visés', plan.accounts.map((a) => `${a.id}:${a.mode}`).sort(), [
        `${U_FP}:TRANSACTIONS_ONLY`,
        `${U_FC}:TRANSACTIONS_ONLY`,
        `${U_LP}:FULL`,
        `${U_LC}:FULL`,
      ].sort());
      check('aucun libellé de compte ne contient une adresse', plan.accounts.some((a) => a.label.includes('@')), false);
      check(
        'I1 : sosies (casse, Kelvin, ancienne adresse en majuscules) jamais visés',
        plan.accounts.filter((a) => [U_LOOK_CASE, U_LOOK_KELVIN, U_LOOK_LEGACY].includes(a.id)).length,
        0,
      );
      check('I1 : carte du sosie hors du plan', plan.rows.payment_methods.includes(PM_LOOK), false);
      check('M5 : la phrase compte les comptes supprimés en entier (2), pas les 4 visés', planPhrase(plan.accounts, plan.fingerprint).startsWith('PURGER E2E 2 COMPTES '), true);
      check('signalement du titre e2e-paiement- absent (la demande est dans le plan)', plan.warnings.filter((w) => w.includes('e2e-paiement')), []);
      phrase = planPhrase(plan.accounts, plan.fingerprint);
      await refusal('phrase fausse', () => executePurge(db, { confirm: `${phrase}x`, outDir, storageDir: storage }), 'phrase');
    });
    check('rien supprimé après la phrase fausse', await counts(admin), before);
    await admin.query(
      `INSERT INTO notifications (id, type, recipient_service_provider_id, service_request_id) VALUES ($1, 'NEW_DIRECT_BOOKING', $2, $3)`,
      [N_LATE, P_FIX, SR_FIX_DONE],
    );
    await asPurge(purgeUrl.toString(), async (db) => {
      await refusal('base modifiée depuis la simulation', () => executePurge(db, { confirm: phrase, outDir, storageDir: storage }), 'phrase');
    });
    check('rien supprimé après le changement d’empreinte', await counts(admin), { ...before, notifications: before.notifications + 1 });
    check('aucune liste Stripe laissée après les refus', readdirSync(outDir), []);

    console.log('M1. COMMIT qui lève une erreur réseau');
    await asPurge(purgeUrl.toString(), async (db) => {
      const p = await simulate(db);
      let outcome = 'aucune erreur';
      try {
        await executePurge(db, {
          confirm: planPhrase(p.accounts, p.fingerprint),
          outDir,
          storageDir: storage,
          stamp: '20261104T000001Z',
          commit: async () => {
            throw new Error('Connection terminated unexpectedly');
          },
        });
      } catch (err) {
        outcome = err instanceof CommitUncertainError && err.message.startsWith('état du COMMIT incertain : vérifier la base, conserver ')
          ? 'incertain'
          : String(err);
      }
      check('M1 : erreur « état du COMMIT incertain »', outcome, 'incertain');
    });
    check('M1 : la liste Stripe .pending est GARDÉE', existsSync(join(outDir, '20261104T000001Z-stripe-ids.txt.pending')), true);
    check('M1 : rien supprimé (COMMIT non envoyé dans la sonde)', await counts(admin), { ...before, notifications: before.notifications + 1 });
    rmSync(join(outDir, '20261104T000001Z-stripe-ids.txt.pending'));

    console.log('D. Purge réelle, sous le rôle linkr_purge, avec échec de l’étape fichiers (I3)');
    // Une pièce jointe qui ne peut pas être supprimée (un dossier à sa place),
    // et une liste de fichiers restants qui ne peut pas être écrite.
    rmSync(join(storage, KEY_ATT));
    mkdirSync(join(storage, KEY_ATT));
    writeFileSync(join(storage, KEY_ATT, 'garde'), 'x');
    mkdirSync(join(outDir, '20261104T000000Z-files-remaining.txt'));
    let plan!: PurgePlan;
    await asPurge(purgeUrl.toString(), async (db) => {
      const p = await simulate(db);
      plan = p;
      const committedReports: CommittedReport[] = [];
      let failure: PostCommitError | null = null;
      try {
        await executePurge(db, {
          confirm: planPhrase(p.accounts, p.fingerprint),
          outDir,
          storageDir: storage,
          stamp: '20261104T000000Z',
          onCommitted: (r) => committedReports.push(r),
        });
      } catch (err) {
        if (err instanceof PostCommitError) failure = err;
        else throw err;
      }
      check('I3 : rapport de la base émis une fois, avant l’étape fichiers', committedReports.length, 1);
      check('I3 : PostCommitError levée', failure !== null, true);
      check('I3 : fichier non supprimé listé', failure?.notDeleted ?? null, [KEY_ATT]);
      const result = committedReports[0];
      check('lignes supprimées par table', result.deletedCounts, {
        refunds: 1,
        payments: 3,
        reviews: 1,
        notifications: 3,
        quotes: 1,
        service_request_attachments: 1,
        service_request_assignments: 1,
        service_requests: 3,
        payment_methods: 2,
        portfolio_items: 1,
        verification_documents: 1,
        professional_services: 1,
        professional_service_categories: 1,
        professional_service_zones: 1,
        stripe_connect_accounts: 1,
        service_providers: 1,
        password_reset_tokens: 1,
        user_auth_providers: 2,
        users: 2,
      });
      check('liste Stripe finale indiquée dans le rapport de la base', result.stripeFile, join(outDir, '20261104T000000Z-stripe-ids.txt'));
      check('fichiers des lignes supprimées effacés', [KEY_DOC, KEY_PORT_LEG].map((k) => existsSync(join(storage, k))), [false, false]);
    });
    rmSync(join(outDir, '20261104T000000Z-files-remaining.txt'), { recursive: true });
    rmSync(join(storage, KEY_ATT), { recursive: true });

    const stripeLines = readFileSync(join(outDir, '20261104T000000Z-stripe-ids.txt'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .sort();
    check('liste Stripe = seules entités supprimées', stripeLines, ['acct_sonde_ancien', 'cus_sonde_ancien', 'pm_sonde_ancien', 'pm_sonde_fixe']);
    check('aucun fichier .pending restant', readdirSync(outDir).filter((f) => f.endsWith('.pending')), []);

    const kept = await admin.query<{ k: string }>(
      `SELECT 'user:'||id AS k FROM users WHERE id = ANY($1::uuid[])
       UNION ALL SELECT 'provider:'||id FROM service_providers WHERE id = ANY($2::uuid[])
       UNION ALL SELECT 'psc:'||id FROM professional_service_categories WHERE id = ANY($3::uuid[])
       UNION ALL SELECT 'service:'||id FROM professional_services WHERE id = $4
       UNION ALL SELECT 'connect:'||id FROM stripe_connect_accounts WHERE id = $5
       UNION ALL SELECT 'auth:'||user_id FROM user_auth_providers WHERE user_id = ANY($1::uuid[])
       ORDER BY 1`,
      [[U_FP, U_FC], [P_FIX], [PSC_FIX], PS_FIX, CON_FIX],
    );
    check('comptes fixes gardés (utilisateur, auth, prestataire, métier, service, Connect)', kept.rows.map((r) => r.k), [
      `auth:${U_FP}`,
      `auth:${U_FC}`,
      `connect:${CON_FIX}`,
      `provider:${P_FIX}`,
      `psc:${PSC_FIX}`,
      `service:${PS_FIX}`,
      `user:${U_FP}`,
      `user:${U_FC}`,
    ]);
    const fc = await admin.query<{ s: string }>(`SELECT stripe_customer_id AS s FROM users WHERE id = $1`, [U_FC]);
    check('client fixe : identifiant client Stripe gardé', fc.rows[0].s, 'cus_sonde_fixe');

    const real = await admin.query<{ k: string }>(
      `SELECT 'user:'||id AS k FROM users WHERE id = ANY($1::uuid[])
       UNION ALL SELECT 'request:'||id FROM service_requests WHERE id = ANY($2::uuid[])
       UNION ALL SELECT 'portfolio:'||id FROM portfolio_items WHERE id = $3
       UNION ALL SELECT 'pm:'||id FROM payment_methods WHERE id = ANY($4::uuid[])
       ORDER BY 1`,
      [
        [U_REAL, U_REALPRO, U_ADMIN, U_NEAR, U_WRONGNAME, U_LOOK_CASE, U_LOOK_KELVIN, U_LOOK_LEGACY],
        [SR_REAL, SR_REAL_TENDER],
        PORT_REAL,
        [PM_REAL, PM_LOOK],
      ],
    );
    check('données réelles, ADMIN, adresses proches et sosies intacts (8 comptes, 2 demandes, 1 photo, 2 cartes)', real.rows.length, 13);
    check('fichier d’un vrai prestataire gardé', existsSync(join(storage, KEY_PORT_REAL)), true);
    check('catalogue identique (compte et md5)', sameCatalog(catalogBefore, await catalogFingerprint(admin)), true);

    const left = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT id FROM service_requests WHERE id = ANY($1::uuid[])
         UNION ALL SELECT id FROM payments WHERE id = ANY($2::uuid[])
         UNION ALL SELECT id FROM users WHERE id = ANY($3::uuid[])) x`,
      [plan.rows.service_requests, plan.rows.payments, plan.rows.users],
    );
    check('zéro ligne restante parmi les identifiants purgés', left.rows[0].n, 0);

    console.log('E. Second passage et fichiers restants');
    await asPurge(purgeUrl.toString(), async (db) => {
      const again = await simulate(db);
      check('second passage : rien à purger', DELETE_ORDER.every((t) => again.rows[t].length === 0), true);
      check('second passage : comptes fixes toujours visés', again.accounts.length, 2);
      writeFileSync(join(outDir, '20261103T000000Z-files-remaining.txt'), `${KEY_ORPHAN}\n${KEY_PORT_REAL}\n`);
      const before2 = await counts(admin);
      const r = await executePurge(db, { confirm: '', outDir, storageDir: storage, stamp: '20261104T000002Z' });
      check('I2 : plan vide, exécution sans phrase, aucune transaction validée', r.committed, false);
      check('I2 : fichier sans ligne supprimé', r.leftovers.deleted, [KEY_ORPHAN]);
      check('I2 : fichier encore référencé gardé', r.leftovers.remaining, [KEY_PORT_REAL]);
      check('I2 : rien écrit en base', await counts(admin), before2);
    });
    check('fichier référencé toujours sur le disque', existsSync(join(storage, KEY_PORT_REAL)), true);
  } finally {
    await admin.query(`DROP OWNED BY linkr_purge`).catch(() => undefined);
    await admin.query(`DROP ROLE IF EXISTS linkr_purge`).catch(() => undefined);
    await admin.end();
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n${passed} vérification(s) réussie(s), ${failures.length} échec(s).`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
