/**
 * Purge e2e — codes de sortie après le COMMIT (I-b) et liste des fichiers à
 * supprimer écrite AVANT les `unlink` (M-e). Aucune base, aucun réseau.
 */
import fs = require('node:fs');
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommittedReport, deletePlanFiles, ExecuteResult, PostCommitError } from './purge-execute';
import { runExecution } from './purge';

const report: CommittedReport = { deletedCounts: { users: 1 }, fixedCheck: 'comptes=2 prestataires=1 connect=1', stripeFile: null };
const emptyFiles = { deleted: [], absent: [], remaining: [], skipped: [] };
const result = {
  committed: true,
  deletedCounts: { users: 1 },
  stripeFile: null,
  files: emptyFiles,
  leftovers: emptyFiles,
  fixedCheck: [],
  refusedList: null,
} as unknown as ExecuteResult;

describe('purge e2e — code de sortie après le COMMIT (I-b)', () => {
  let write: jest.SpyInstance;
  beforeEach(() => {
    write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => write.mockRestore());

  it('une erreur levée PAR onCommitted (rapport illisible) sort en 4, jamais en 1', async () => {
    write.mockImplementation((chunk: string | Uint8Array) => {
      if (String(chunk).startsWith('TRANSACTION VALIDÉE')) throw new Error('stdout fermé');
      return true;
    });
    const code = await runExecution(async (onCommitted) => {
      onCommitted(report);
      return result;
    });
    expect(code).toBe(4);
  });

  it('une erreur quelconque levée après onCommitted sort en 4', async () => {
    const code = await runExecution(async (onCommitted) => {
      onCommitted(report);
      throw new TypeError('imprévu après le COMMIT');
    });
    expect(code).toBe(4);
    expect(write.mock.calls.map((c) => String(c[0])).join('')).toContain('BASE PURGÉE');
  });

  it('une erreur AVANT le COMMIT est relancée (code 1 au niveau du processus)', async () => {
    await expect(
      runExecution(async () => {
        throw new Error('ROLLBACK');
      }),
    ).rejects.toThrow('ROLLBACK');
  });

  it('PostCommitError sort en 4 ; succès sort en 0', async () => {
    expect(await runExecution(async () => Promise.reject(new PostCommitError('fichiers', ['portfolio/a.webp'])))).toBe(4);
    expect(await runExecution(async (onCommitted) => (onCommitted(report), result))).toBe(0);
  });
});

describe('purge e2e — liste des fichiers écrite avant les unlink (M-e)', () => {
  let storage: string;
  let out: string;
  const stamp = '20261104T120000Z';
  const keys = ['portfolio/p/1.webp', 'portfolio/p/2.webp', 'verifications/d/3.pdf'];
  const list = (): string => join(out, `${stamp}-files-remaining.txt`);

  beforeEach(() => {
    storage = mkdtempSync(join(tmpdir(), 'purge-st-'));
    out = mkdtempSync(join(tmpdir(), 'purge-out-'));
    for (const k of keys) {
      mkdirSync(join(storage, k, '..'), { recursive: true });
      writeFileSync(join(storage, k), 'x');
    }
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(storage, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('à chaque unlink, la liste sur le disque contient TOUTES les clés (processus tué = liste complète)', () => {
    const seen: string[][] = [];
    const real = fs.unlinkSync;
    jest.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      seen.push(readFileSync(list(), 'utf8').split('\n').filter(Boolean));
      real(p);
    });
    const { files, listError } = deletePlanFiles(storage, out, stamp, keys);
    expect(seen).toHaveLength(3);
    for (const snapshot of seen) expect(snapshot).toEqual(keys);
    expect(files.deleted).toEqual(keys);
    expect(listError).toBeNull();
    expect(existsSync(list())).toBe(false); // tout est parti : liste effacée
  });

  it('après la suppression, la liste ne garde que ce qui reste', () => {
    const real = fs.unlinkSync;
    jest.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      if (String(p).endsWith('2.webp')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      real(p);
    });
    const { files, listError } = deletePlanFiles(storage, out, stamp, keys);
    expect(files.remaining).toEqual(['portfolio/p/2.webp']);
    expect(listError).toBeNull();
    expect(readFileSync(list(), 'utf8')).toBe('portfolio/p/2.webp\n');
  });

  it('une clé refusée n’entre jamais dans la liste', () => {
    const { files } = deletePlanFiles(storage, out, stamp, ['../hors-volume', keys[0]]);
    expect(files.skipped).toEqual(['../hors-volume']);
    expect(existsSync(list())).toBe(false);
  });

  it('dossier des listes inutilisable : suppression faite quand même, erreur remontée si un fichier reste', () => {
    mkdirSync(list()); // un dossier à la place de la liste
    const real = fs.unlinkSync;
    jest.spyOn(fs, 'unlinkSync').mockImplementation((p) => {
      if (String(p).endsWith('3.pdf')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      real(p);
    });
    const { files, listError } = deletePlanFiles(storage, out, stamp, keys);
    expect(files.deleted).toEqual(keys.slice(0, 2));
    expect(files.remaining).toEqual(['verifications/d/3.pdf']);
    expect(listError).not.toBeNull();
  });
});
