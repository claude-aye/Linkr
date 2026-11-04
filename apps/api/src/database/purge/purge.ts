/**
 * Purge des comptes e2e (mode A). Point d'entrée.
 *
 * ⚠️ Lancé À LA MAIN sur le VPS, jamais par une tâche planifiée ni par un agent :
 *   ./purge.sh             simulation (par défaut) : rien n'est écrit
 *   ./purge.sh --execute   verrou, sauvegarde, plan, phrase tapée, transaction
 * Mode d'emploi : docs/deploy/purge.md.
 *
 * Variables (aucune clé Stripe, aucun accès Internet : réseau backend seul) :
 *   PURGE_DATABASE_URL  connexion du rôle linkr_purge — refus si absente
 *   PURGE_STORAGE_DIR   racine du volume uploads
 *   PURGE_OUT_DIR       dossier des listes (Stripe, fichiers restants), exécution
 *   PURGE_CONFIRM       phrase tapée par l'opérateur, exécution
 *
 * Codes de sortie : 0 terminé · 2 refus (config, phrase, rôle, ADMIN) ·
 * 3 purge bloquée (contrôle de fermeture ou catalogue) · 1 erreur imprévue.
 */
import { Client } from 'pg';
import { buildPlan, isBlocked, PurgePlan } from './purge-plan';
import {
  assertPurgeRole,
  countStorageFiles,
  executePurge,
  leftoverLists,
} from './purge-execute';
import {
  assertClosedLists,
  confirmationPhrase,
  DELETE_ORDER,
  PurgeRefusal,
  roleGrantSql,
  STRIPE_SHARED_SANDBOX_WARNING,
} from './purge-rules';

const out = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new PurgeRefusal(`${name} est absente : refus de démarrer`);
  return value;
}

function printPlan(plan: PurgePlan, storageDir: string, outDir: string | undefined): void {
  out('Comptes visés :');
  if (plan.accounts.length === 0) out('  (aucun)');
  for (const a of plan.accounts) {
    out(`  ${a.id}  ${a.mode === 'FULL' ? 'suppression complète  ' : 'transactions seulement'}  ${a.label}`);
  }
  out();
  out('Lignes à supprimer, dans l’ordre :');
  for (const table of DELETE_ORDER) {
    const n = plan.rows[table].length;
    if (n > 0) out(`  ${table.padEnd(32)} ${n}`);
  }
  const total = DELETE_ORDER.reduce((s, t) => s + plan.rows[t].length, 0);
  out(`  ${'total'.padEnd(32)} ${total}`);
  out();
  const files = countStorageFiles(storageDir, plan.fileKeys);
  out(`Fichiers du volume uploads : ${files.present} à supprimer, ${files.absent} déjà absent(s), ${files.unsafe} clé(s) refusée(s)`);
  if (outDir) out(`Listes de fichiers restants d’un passage précédent : ${leftoverLists(outDir).length}`);
  const s = plan.stripe;
  out(`Identifiants Stripe à exporter : ${s.customers.length} cus_, ${s.accounts.length} acct_, ${s.paymentMethods.length} pm_ (aucun appel Stripe)`);
  if (plan.warnings.length > 0) {
    out();
    out('Signalements (sans effet) :');
    for (const w of plan.warnings) out(`  - ${w}`);
  }
  if (plan.violations.length > 0 || plan.catalogBlockers.length > 0) {
    out();
    out('PURGE BLOQUÉE — lignes hors liste qui pointent vers une entité e2e (aucune donnée tierce n’est modifiée) :');
    for (const v of [...plan.catalogBlockers, ...plan.violations]) out(`  ${v.table}  ${v.id}  ${v.reason}`);
  }
  out();
  out(`Empreinte : ${plan.fingerprint}`);
}

function isEmpty(plan: PurgePlan): boolean {
  return DELETE_ORDER.every((t) => plan.rows[t].length === 0);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--print-role-sql')) {
    out(roleGrantSql());
    return 0;
  }
  const unknown = args.filter((a) => a !== '--execute');
  if (unknown.length > 0) throw new PurgeRefusal(`argument inconnu : ${unknown.join(' ')}`);
  const execute = args.includes('--execute');

  assertClosedLists();
  const url = requireEnv('PURGE_DATABASE_URL');
  const storageDir = requireEnv('PURGE_STORAGE_DIR');
  const outDir = execute ? requireEnv('PURGE_OUT_DIR') : process.env.PURGE_OUT_DIR?.trim() || undefined;
  const confirm = execute ? requireEnv('PURGE_CONFIRM') : '';

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await assertPurgeRole(db);

    if (!execute) {
      // Simulation : transaction en lecture seule, annulée. Rien ne peut s'écrire.
      await db.query('BEGIN TRANSACTION READ ONLY');
      let plan: PurgePlan;
      try {
        plan = await buildPlan(db);
      } finally {
        await db.query('ROLLBACK');
      }
      out('=== SIMULATION — rien n’est écrit ===');
      printPlan(plan, storageDir, outDir);
      if (isBlocked(plan)) return 3;
      if (isEmpty(plan)) {
        out('Rien à purger.');
        return 0;
      }
      out();
      out('Pour exécuter, taper exactement :');
      out(`PURGE_PHRASE=${confirmationPhrase(plan.accounts.length, plan.fingerprint)}`);
      return 0;
    }

    out('=== EXÉCUTION ===');
    const result = await executePurge(db, { confirm, outDir: outDir as string, storageDir });
    out('Transaction validée. Lignes supprimées :');
    for (const [table, n] of Object.entries(result.deletedCounts)) out(`  ${table.padEnd(32)} ${n}`);
    out(`Comptes fixes après purge : ${result.fixedCheck.join(' ; ') || '(aucun)'}`);
    out('Catalogue : empreintes identiques avant et après.');
    out(`Fichiers : ${result.files.deleted.length} supprimé(s), ${result.files.absent.length} déjà absent(s), ${result.files.remaining.length} NON supprimé(s), ${result.files.skipped.length} clé(s) refusée(s)`);
    for (const k of [...result.files.remaining, ...result.files.skipped]) out(`  non supprimé : ${k}`);
    if (result.leftovers.deleted.length + result.leftovers.remaining.length > 0) {
      out(`Fichiers restants d’un passage précédent : ${result.leftovers.deleted.length} supprimé(s), ${result.leftovers.remaining.length} encore là`);
    }
    if (result.stripeFile) {
      out(`Liste Stripe : ${result.stripeFile}`);
      out(STRIPE_SHARED_SANDBOX_WARNING);
    } else {
      out('Liste Stripe : aucun identifiant à supprimer.');
    }
    return 0;
  } finally {
    await db.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof PurgeRefusal) {
      process.stderr.write(`REFUS : ${err.message}\n`);
      process.exit(2);
    }
    // Jamais l'URL de connexion ni un secret : seulement le message.
    process.stderr.write(`ERREUR : ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
