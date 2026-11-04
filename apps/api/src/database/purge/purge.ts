/**
 * Purge des comptes e2e (mode A). Point d'entrée.
 *
 * ⚠️ Lancé À LA MAIN sur le VPS, jamais par une tâche planifiée ni par un agent :
 *   ./purge.sh             simulation (par défaut) : rien n'est écrit
 *   ./purge.sh --execute   verrou, sauvegarde, témoin, plan, phrase tapée, transaction
 * Mode d'emploi : docs/deploy/purge.md.
 *
 * Variables (aucune clé Stripe, aucun accès Internet : réseau backend seul) :
 *   PURGE_DATABASE_URL  connexion du rôle linkr_purge — refus si absente
 *   PURGE_STORAGE_DIR   racine du volume uploads
 *   PURGE_OUT_DIR       dossier des listes et du témoin de sauvegarde, exécution
 *   PURGE_CONFIRM       phrase tapée par l'opérateur (vide : plan vide seulement)
 *
 * Codes de sortie :
 *   0 terminé · 1 erreur, aucune transaction validée · 2 refus (config, témoin,
 *   phrase, rôle, ADMIN) · 3 purge bloquée (fermeture ou catalogue) ·
 *   4 BASE PURGÉE mais étape fichiers incomplète · 5 état du COMMIT incertain.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { buildPlan, isBlocked, isEmpty, PurgePlan } from './purge-plan';
import {
  assertPurgeRole,
  CommitUncertainError,
  CommittedReport,
  countStorageFiles,
  executePurge,
  ExecuteResult,
  FilesReport,
  leftoverLists,
  PostCommitError,
} from './purge-execute';
import {
  accountCounts,
  assertClosedLists,
  assertFreshBackupWitness,
  BACKUP_WITNESS_FILE,
  DELETE_ORDER,
  planPhrase,
  PurgeRefusal,
  roleGrantSql,
  STRIPE_SHARED_SANDBOX_WARNING,
} from './purge-rules';

const EXIT = { ok: 0, error: 1, refusal: 2, blocked: 3, postCommit: 4, commitUncertain: 5 } as const;

const out = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new PurgeRefusal(`${name} est absente : refus de démarrer`);
  return value;
}

function readWitness(outDir: string): string | null {
  try {
    return readFileSync(join(outDir, BACKUP_WITNESS_FILE), 'utf8');
  } catch {
    return null;
  }
}

function printPlan(plan: PurgePlan, storageDir: string, outDir: string | undefined): void {
  const { full, kept } = accountCounts(plan.accounts);
  out('Comptes visés :');
  if (plan.accounts.length === 0) out('  (aucun)');
  for (const a of plan.accounts) {
    out(`  ${a.id}  ${a.mode === 'FULL' ? 'suppression complète  ' : 'transactions seulement'}  ${a.label}`);
  }
  out(`Comptes supprimés en entier : ${full}`);
  out(`Comptes fixes gardés : ${kept}`);
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

function printCommitted(r: CommittedReport): void {
  out('TRANSACTION VALIDÉE. Lignes supprimées :');
  for (const [table, n] of Object.entries(r.deletedCounts)) out(`  ${table.padEnd(32)} ${n}`);
  out(`Comptes fixes après purge : ${r.fixedCheck || '(aucun)'}`);
  out('Catalogue : empreintes identiques avant et après.');
  if (r.stripeFile) {
    out(`Liste Stripe : ${r.stripeFile}`);
    out(STRIPE_SHARED_SANDBOX_WARNING);
  } else {
    out('Liste Stripe : aucun identifiant à supprimer.');
  }
}

function printFiles(label: string, f: FilesReport): void {
  out(`${label} : ${f.deleted.length} supprimé(s), ${f.absent.length} déjà absent(s), ${f.remaining.length} NON supprimé(s), ${f.skipped.length} clé(s) refusée(s)`);
  for (const k of f.remaining) out(`  non supprimé : ${k}`);
  for (const k of f.skipped) out(`  clé refusée : ${k}`);
}

function printResult(r: ExecuteResult): void {
  if (r.committed) {
    printFiles('Fichiers', r.files);
    if (r.refusedList) out(`Clés refusées consignées dans : ${r.refusedList} (à examiner à la main)`);
  } else {
    out('Rien à purger en base : aucune transaction, seulement la reprise des fichiers restants.');
  }
  printFiles('Fichiers restants d’un passage précédent', r.leftovers);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--print-role-sql')) {
    out(roleGrantSql());
    return EXIT.ok;
  }
  const unknown = args.filter((a) => a !== '--execute');
  if (unknown.length > 0) throw new PurgeRefusal(`argument inconnu : ${unknown.join(' ')}`);
  const execute = args.includes('--execute');

  assertClosedLists();
  const url = requireEnv('PURGE_DATABASE_URL');
  const storageDir = requireEnv('PURGE_STORAGE_DIR');
  const outDir = execute ? requireEnv('PURGE_OUT_DIR') : process.env.PURGE_OUT_DIR?.trim() || undefined;
  if (execute) {
    // I4 : garde-fou contre l'erreur d'usage (conteneur lancé sans purge.sh),
    // PAS contre la malveillance. Voir assertFreshBackupWitness.
    const w = assertFreshBackupWitness(readWitness(outDir as string), new Date());
    out(`Sauvegarde préalable : ${w.backup} (${w.at})`);
  }
  const confirm = execute ? (process.env.PURGE_CONFIRM?.trim() ?? '') : '';

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
      if (isBlocked(plan)) return EXIT.blocked;
      if (isEmpty(plan)) {
        out('Rien à purger en base. « ./purge.sh --execute » reprend quand même les fichiers restants, sans phrase.');
        return EXIT.ok;
      }
      out();
      out('Pour exécuter, taper exactement :');
      out(`PURGE_PHRASE=${planPhrase(plan.accounts, plan.fingerprint)}`);
      return EXIT.ok;
    }

    out('=== EXÉCUTION ===');
    let result: ExecuteResult;
    let committed = false;
    try {
      result = await executePurge(db, {
        confirm,
        outDir: outDir as string,
        storageDir,
        onCommitted: (r) => {
          committed = true;
          printCommitted(r);
        },
      });
    } catch (err) {
      if (err instanceof PostCommitError) {
        out(`BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE : ${err.message}`);
        if (err.notDeleted.length === 0) out('  (aucun fichier de cette purge en attente)');
        for (const k of err.notDeleted) out(`  non supprimé : ${k}`);
        return EXIT.postCommit;
      }
      if (err instanceof CommitUncertainError) {
        out(err.message);
        return EXIT.commitUncertain;
      }
      throw err;
    }
    try {
      printResult(result);
    } catch (err) {
      if (!committed) throw err;
      out(`BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE : rapport non affiché (${err instanceof Error ? err.message : String(err)})`);
      return EXIT.postCommit;
    }
    return EXIT.ok;
  } finally {
    await db.end().catch(() => undefined);
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof PurgeRefusal) {
      process.stderr.write(`REFUS : ${err.message}\n`);
      process.exit(EXIT.refusal);
    }
    // Jamais l'URL de connexion ni un secret : seulement le message.
    process.stderr.write(`ERREUR (aucune transaction validée) : ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(EXIT.error);
  });
