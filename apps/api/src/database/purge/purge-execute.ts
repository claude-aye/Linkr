/**
 * Purge e2e (mode A) — exécution : une seule transaction, puis les fichiers.
 *
 * Ordre : tables verrouillées et plan recalculé → phrase comparée → liste Stripe écrite
 * (fichier « .pending ») → suppressions dans l'ordre sûr → vérifications →
 * empreintes du catalogue → COMMIT. Au moindre écart : ROLLBACK, la liste
 * Stripe en attente est effacée, rien n'a changé. Après le COMMIT seulement :
 * la liste Stripe prend son nom final et les fichiers du volume sont supprimés.
 *
 * Aucun ordre de schéma, aucun vidage de table : seulement `DELETE … WHERE id
 * = ANY($1)`, sur les tables de la liste fermée, avec le nombre de lignes
 * attendu.
 */
import { chmodSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildPlan, isBlocked, PurgePlan, Queryable } from './purge-plan';
import {
  assertModifiable,
  assertProtected,
  confirmationPhrase,
  DELETE_ORDER,
  isSafeStorageKey,
  ModifiableTable,
  PROTECTED_TABLES,
  PurgeRefusal,
} from './purge-rules';

export interface TxClient extends Queryable {
  release?: () => void;
}

export type CatalogFingerprint = Record<string, { n: number; h: string }>;

/** Compte + md5 des lignes triées de chacune des cinq tables protégées. */
export async function catalogFingerprint(db: Queryable): Promise<CatalogFingerprint> {
  const out: CatalogFingerprint = {};
  for (const table of PROTECTED_TABLES) {
    assertProtected(table);
    const r = await db.query<{ n: number; h: string }>(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS h FROM ${table} t`,
    );
    out[table] = r.rows[0];
  }
  return out;
}

export function sameCatalog(a: CatalogFingerprint, b: CatalogFingerprint): boolean {
  return PROTECTED_TABLES.every((t) => a[t]?.n === b[t]?.n && a[t]?.h === b[t]?.h);
}

/**
 * Le rôle de connexion doit être linkr_purge (D9) : pas super-utilisateur,
 * aucun droit d'écriture sur une table protégée, droit de suppression sur
 * chaque table de la liste fermée.
 */
export async function assertPurgeRole(db: Queryable): Promise<void> {
  const r = await db.query<{ rolsuper: boolean }>(
    `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`,
  );
  if (r.rows[0]?.rolsuper) throw new PurgeRefusal('connexion en super-utilisateur refusée : utiliser le rôle linkr_purge');
  for (const table of PROTECTED_TABLES) {
    // Propriétaire = tous les droits, y compris ceux qui ne s'écrivent pas ici.
    // `has_table_privilege` avec une liste répond vrai si L'UN des droits est tenu.
    const p = await db.query<{ w: boolean }>(
      `SELECT has_table_privilege(current_user, $1, 'INSERT, UPDATE, DELETE')
           OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = $1::regclass
                        AND pg_get_userbyid(c.relowner) = current_user) AS w`,
      [table],
    );
    if (p.rows[0]?.w) throw new PurgeRefusal(`le rôle peut écrire dans la table protégée ${table} : refus`);
  }
  for (const table of DELETE_ORDER) {
    const p = await db.query<{ d: boolean }>(`SELECT has_table_privilege(current_user, $1, 'DELETE') AS d`, [table]);
    if (!p.rows[0]?.d) throw new PurgeRefusal(`le rôle n'a pas le droit DELETE sur ${table}`);
  }
}

/**
 * Verrouille les tables de la liste fermée pour la durée de la transaction.
 *
 * ⚠️ PAS `SELECT … FOR UPDATE` : PostgreSQL l'exige avec le droit UPDATE, que
 * le rôle linkr_purge n'a pas (D9 : SELECT et DELETE seulement — mesuré par la
 * sonde, « permission denied for table users »). `SHARE ROW EXCLUSIVE` se prend
 * avec le seul droit DELETE, et bloque toute insertion, modification ou
 * suppression concurrente sur ces tables jusqu'au COMMIT : le plan lu ensuite
 * ne peut plus changer. Les lectures ne sont pas bloquées. `lock_timeout`
 * borne l'attente : un verrou qui ne vient pas annule tout.
 */
export async function lockModifiableTables(db: Queryable): Promise<void> {
  for (const table of DELETE_ORDER) {
    assertModifiable(table);
    await db.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
  }
}

/** Arêtes de clés étrangères vers les entités supprimables (vérification après). */
const REFERENCE_EDGES: Array<[child: string, column: string, parent: ModifiableTable]> = [
  ['refunds', 'payment_id', 'payments'],
  ['payments', 'service_request_id', 'service_requests'],
  ['payments', 'payment_method_id', 'payment_methods'],
  ['payments', 'payer_user_id', 'users'],
  ['payments', 'recipient_service_provider_id', 'service_providers'],
  ['refunds', 'initiated_by_user_id', 'users'],
  ['reviews', 'service_request_id', 'service_requests'],
  ['reviews', 'author_user_id', 'users'],
  ['reviews', 'service_provider_id', 'service_providers'],
  ['notifications', 'service_request_id', 'service_requests'],
  ['notifications', 'recipient_user_id', 'users'],
  ['notifications', 'recipient_service_provider_id', 'service_providers'],
  ['quotes', 'service_request_id', 'service_requests'],
  ['quotes', 'service_provider_id', 'service_providers'],
  ['service_request_attachments', 'service_request_id', 'service_requests'],
  ['service_request_attachments', 'uploaded_by_user_id', 'users'],
  ['service_request_assignments', 'service_request_id', 'service_requests'],
  ['service_request_assignments', 'worker_user_id', 'users'],
  ['service_request_assignments', 'assigned_by_user_id', 'users'],
  ['service_requests', 'client_user_id', 'users'],
  ['service_requests', 'cancelled_by_user_id', 'users'],
  ['service_requests', 'requested_service_provider_id', 'service_providers'],
  ['service_requests', 'assigned_service_provider_id', 'service_providers'],
  ['payment_methods', 'owner_user_id', 'users'],
  ['portfolio_items', 'service_provider_id', 'service_providers'],
  ['verification_documents', 'professional_service_category_id', 'professional_service_categories'],
  ['verification_documents', 'reviewed_by_user_id', 'users'],
  ['professional_services', 'professional_service_category_id', 'professional_service_categories'],
  ['professional_service_categories', 'service_provider_id', 'service_providers'],
  ['professional_service_zones', 'service_provider_id', 'service_providers'],
  ['stripe_connect_accounts', 'service_provider_id', 'service_providers'],
  ['service_providers', 'user_id', 'users'],
  ['organization_memberships', 'user_id', 'users'],
  ['password_reset_tokens', 'user_id', 'users'],
  ['user_auth_providers', 'user_id', 'users'],
  ['service_items', 'suggested_by_user_id', 'users'],
  ['service_items', 'approved_by_user_id', 'users'],
];

const COLUMN_NAME = /^[a-z_]+$/;

/** Zéro ligne restante qui pointe vers un identifiant supprimé. */
export async function danglingReferences(
  db: Queryable,
  deleted: Record<ModifiableTable, string[]>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const [child, column, parent] of REFERENCE_EDGES) {
    const ids = deleted[parent];
    if (ids.length === 0) continue;
    if (!COLUMN_NAME.test(child) || !COLUMN_NAME.test(column)) throw new PurgeRefusal('nom invalide');
    const r = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${child} WHERE ${column} = ANY($1::uuid[])`,
      [ids],
    );
    if (r.rows[0].n > 0) problems.push(`${child}.${column} → ${parent} : ${r.rows[0].n} ligne(s)`);
  }
  for (const table of DELETE_ORDER) {
    const ids = deleted[table];
    if (ids.length === 0) continue;
    const r = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
    if (r.rows[0].n > 0) problems.push(`${table} : ${r.rows[0].n} ligne(s) encore présente(s)`);
  }
  return problems;
}

export interface ExecuteOptions {
  confirm: string;
  outDir: string;
  storageDir: string;
  /** Horodatage UTC compact, injecté pour les tests. */
  stamp?: string;
}

export interface ExecuteResult {
  plan: PurgePlan;
  deletedCounts: Record<string, number>;
  stripeFile: string | null;
  files: FilesReport;
  leftovers: FilesReport;
  fixedCheck: string[];
}

export interface FilesReport {
  deleted: string[];
  absent: string[];
  remaining: string[];
  skipped: string[];
}

function stampNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function stripeFileContent(plan: PurgePlan, stamp: string): string | null {
  const ids = [...plan.stripe.customers, ...plan.stripe.accounts, ...plan.stripe.paymentMethods];
  if (ids.length === 0) return null;
  return [
    `# Purge e2e ${stamp} — identifiants Stripe (mode TEST) des seules entités supprimées.`,
    '# Bac à sable PARTAGÉ avec le développement : supprimer à la main uniquement ces identifiants.',
    '# Ne jamais utiliser « Supprimer toutes les données de test ». Détruire ce fichier après usage.',
    ...ids,
    '',
  ].join('\n');
}

async function fixedAccountsSnapshot(db: Queryable, plan: PurgePlan): Promise<string> {
  const fixed = plan.accounts.filter((a) => a.mode === 'TRANSACTIONS_ONLY').map((a) => a.id);
  const r = await db.query<{ u: number; p: number; c: number }>(
    `SELECT (SELECT count(*)::int FROM users WHERE id = ANY($1::uuid[]) AND deleted_at_utc IS NULL) AS u,
            (SELECT count(*)::int FROM service_providers WHERE user_id = ANY($1::uuid[])) AS p,
            (SELECT count(*)::int FROM stripe_connect_accounts sca JOIN service_providers sp
                ON sp.id = sca.service_provider_id WHERE sp.user_id = ANY($1::uuid[])) AS c`,
    [fixed],
  );
  const { u, p, c } = r.rows[0];
  return `comptes=${u} prestataires=${p} connect=${c}`;
}

/**
 * Exécute la purge. Le client doit être une connexion dédiée (pas un pool
 * partagé) : BEGIN/COMMIT y sont posés.
 */
export async function executePurge(db: TxClient, opts: ExecuteOptions): Promise<ExecuteResult> {
  const stamp = opts.stamp ?? stampNow();
  const pending = join(opts.outDir, `${stamp}-stripe-ids.txt.pending`);
  const finalStripe = join(opts.outDir, `${stamp}-stripe-ids.txt`);
  let wrotePending = false;
  const deletedCounts: Record<string, number> = {};

  await db.query('BEGIN');
  let plan: PurgePlan;
  let fixedCheck: string[] = [];
  try {
    await db.query(`SET LOCAL lock_timeout = '5s'`);
    await lockModifiableTables(db);
    const catalogBefore = await catalogFingerprint(db);
    plan = await buildPlan(db);

    if (isBlocked(plan)) throw new PurgeRefusal('contrôle de fermeture ou catalogue : purge bloquée (voir la simulation)');
    const expected = confirmationPhrase(plan.accounts.length, plan.fingerprint);
    if (opts.confirm !== expected) {
      throw new PurgeRefusal(`la phrase ne correspond pas au plan actuel (attendu : « ${expected} ») : la base a changé ou la phrase est fausse`);
    }

    const fixedBefore = await fixedAccountsSnapshot(db, plan);

    const content = stripeFileContent(plan, stamp);
    if (content) {
      writeFileSync(pending, content, { mode: 0o600 });
      chmodSync(pending, 0o600);
      wrotePending = true;
    }

    for (const table of DELETE_ORDER) {
      assertModifiable(table);
      const ids = plan.rows[table];
      if (ids.length === 0) continue;
      const r = await db.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
      if (r.rowCount !== ids.length) {
        throw new PurgeRefusal(`${table} : ${r.rowCount} ligne(s) supprimée(s) au lieu de ${ids.length}`);
      }
      deletedCounts[table] = ids.length;
    }

    const dangling = await danglingReferences(db, plan.rows);
    if (dangling.length > 0) throw new PurgeRefusal(`références restantes : ${dangling.join(' ; ')}`);

    const fixedAfter = await fixedAccountsSnapshot(db, plan);
    if (fixedAfter !== fixedBefore) {
      throw new PurgeRefusal(`comptes fixes modifiés (${fixedBefore} → ${fixedAfter})`);
    }
    fixedCheck = [fixedAfter];

    const catalogAfter = await catalogFingerprint(db);
    if (!sameCatalog(catalogBefore, catalogAfter)) throw new PurgeRefusal('empreinte du catalogue modifiée');

    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    if (wrotePending) rmSync(pending, { force: true });
    throw err;
  }

  const stripeFile = wrotePending ? finalStripe : null;
  if (wrotePending) renameSync(pending, finalStripe);

  const files = deleteFiles(opts.storageDir, plan.fileKeys);
  if (files.remaining.length > 0) {
    const list = join(opts.outDir, `${stamp}-files-remaining.txt`);
    writeFileSync(list, `${files.remaining.join('\n')}\n`, { mode: 0o600 });
  }
  const leftovers = await retryLeftoverFiles(db, opts.outDir, opts.storageDir, stamp);

  return { plan, deletedCounts, stripeFile, files, leftovers, fixedCheck };
}

/** Résout une clé dans le volume, ou null si elle en sortirait. */
export function resolveInStorage(storageDir: string, key: string): string | null {
  if (!isSafeStorageKey(key)) return null;
  const root = resolve(storageDir);
  const full = resolve(root, key);
  return full.startsWith(root + sep) ? full : null;
}

export function deleteFiles(storageDir: string, keys: readonly string[]): FilesReport {
  const report: FilesReport = { deleted: [], absent: [], remaining: [], skipped: [] };
  for (const key of keys) {
    const full = resolveInStorage(storageDir, key);
    if (!full) {
      report.skipped.push(key);
      continue;
    }
    try {
      unlinkSync(full);
      report.deleted.push(key);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') report.absent.push(key);
      else report.remaining.push(key);
    }
  }
  return report;
}

/** Clés encore référencées en base (dans l'une des trois colonnes de fichier). */
async function keysStillReferenced(db: Queryable, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const r = await db.query<{ k: string }>(
    `SELECT storage_key AS k FROM portfolio_items WHERE storage_key = ANY($1::text[])
     UNION SELECT file_url FROM verification_documents WHERE file_url = ANY($1::text[])
     UNION SELECT file_url FROM service_request_attachments WHERE file_url = ANY($1::text[])`,
    [keys],
  );
  return new Set(r.rows.map((x) => x.k));
}

/** Listes « *-files-remaining.txt » laissées par un passage précédent. */
export function leftoverLists(outDir: string, exceptStamp?: string): string[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir)
    .filter((f) => f.endsWith('-files-remaining.txt'))
    .filter((f) => !exceptStamp || !f.startsWith(exceptStamp))
    .map((f) => join(outDir, f));
}

/**
 * Un nouveau passage ne supprime que des fichiers SANS ligne en base : une clé
 * encore référencée reste dans la liste, et la liste est réécrite.
 */
export async function retryLeftoverFiles(
  db: Queryable,
  outDir: string,
  storageDir: string,
  exceptStamp?: string,
): Promise<FilesReport> {
  const total: FilesReport = { deleted: [], absent: [], remaining: [], skipped: [] };
  for (const list of leftoverLists(outDir, exceptStamp)) {
    const keys = readFileSync(list, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    const referenced = await keysStillReferenced(db, keys);
    const free = keys.filter((k) => !referenced.has(k));
    const r = deleteFiles(storageDir, free);
    const keep = [...keys.filter((k) => referenced.has(k)), ...r.remaining, ...r.skipped];
    total.deleted.push(...r.deleted);
    total.absent.push(...r.absent);
    total.remaining.push(...keep);
    if (keep.length === 0) rmSync(list, { force: true });
    else writeFileSync(list, `${keep.join('\n')}\n`, { mode: 0o600 });
  }
  return total;
}

/** Simulation : combien de fichiers du volume seraient supprimés. */
export function countStorageFiles(storageDir: string, keys: readonly string[]): { present: number; absent: number; unsafe: number } {
  let present = 0;
  let absent = 0;
  let unsafe = 0;
  for (const key of keys) {
    const full = resolveInStorage(storageDir, key);
    if (!full) unsafe += 1;
    else if (existsSync(full)) present += 1;
    else absent += 1;
  }
  return { present, absent, unsafe };
}
