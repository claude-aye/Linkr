/**
 * Portfolio probe (P1) — what only a REAL database and a REAL storage can prove.
 *
 * jest mocks the repository, so it cannot see the two properties this feature
 * stands on:
 *
 *   1. THE CEILING HOLDS UNDER CONCURRENCY. Two (or five) uploads racing at 11
 *      (or 8) photos must never leave 13. Only the `SELECT … FOR UPDATE` on the
 *      provider row inside `insertUnderCap` makes that true — a count is not a
 *      lock. Remove the `FOR UPDATE` and section A goes red.
 *   2. THE REORDER ACCEPTS EXACTLY THE LIVE SET — none missing, none extra, none
 *      twice, none deleted, none someone else's — and writes NOTHING otherwise.
 *
 * Plus the end-to-end delete through the real service, the real image processor
 * and the real local-disk storage: after a delete, the row is gone from the
 * lists, the image read is a 404, and the FILE no longer exists on disk.
 *
 * It calls the SHIPPED repository and service, never a copy of their SQL.
 *
 * Run (scratch database only — it refuses any name without "probe"):
 *   DATABASE_URL=postgresql://…/linkr_portfolio_probe \
 *     npx ts-node -r tsconfig-paths/register src/database/probes/portfolio.probe.ts
 */
import 'dotenv/config';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import sharp = require('sharp');

import { LocalDiskStorageAdapter } from '../../common/storage/local-disk-storage.adapter';
import { PortfolioItem } from '../../modules/portfolio/entities/portfolio-item.entity';
import { PortfolioImageProcessor } from '../../modules/portfolio/portfolio-image.processor';
import { PortfolioService } from '../../modules/portfolio/portfolio.service';
import { PortfolioItemRepository } from '../../modules/portfolio/repositories/portfolio-item.repository';
import { ServiceProvider } from '../../modules/service-providers/entities/service-provider.entity';
import { ServiceProviderRepository } from '../../modules/service-providers/repositories/service-provider.repository';

const U_A = 'aaaaaaa9-0000-4000-8000-000000000001';
const U_B = 'aaaaaaa9-0000-4000-8000-000000000002';
const P_A = 'ccccccc9-0000-4000-8000-000000000001';
const P_B = 'ccccccc9-0000-4000-8000-000000000002';

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
    console.log(`  ✗ ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

function assertScratchDatabase(url: string | undefined): void {
  const name = (url ?? '').split('/').pop() ?? '';
  if (!name.includes('probe')) {
    throw new Error(`Refusing to run on "${name}": use a scratch database whose name contains "probe".`);
  }
}

async function wipe(ds: DataSource): Promise<void> {
  // Hard deletes of THIS probe's own fixtures in a scratch database — the
  // soft-delete rule (§13) is about user data, not probe scaffolding.
  await ds.query(`DELETE FROM portfolio_items WHERE service_provider_id = ANY($1::uuid[])`, [[P_A, P_B]]);
  await ds.query(`DELETE FROM service_providers WHERE id = ANY($1::uuid[])`, [[P_A, P_B]]);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[U_A, U_B]]);
}

async function seed(ds: DataSource): Promise<void> {
  for (const [id, email] of [
    [U_A, 'probe-portfolio-a@linkr.test'],
    [U_B, 'probe-portfolio-b@linkr.test'],
  ]) {
    await ds.query(
      `INSERT INTO users (id, email, first_name, last_name, language_preference,
                          country_code, subdivision_code, preferred_currency)
       VALUES ($1, $2, 'Probe', 'Portfolio', 'fr-CA', 'CA', 'CA-QC', 'CAD')`,
      [id, email],
    );
  }
  for (const [id, user] of [
    [P_A, U_A],
    [P_B, U_B],
  ]) {
    await ds.query(
      `INSERT INTO service_providers
         (id, provider_type, user_id, business_name, headline, bio,
          service_base_location, service_radius_km, is_active, activated_at_utc)
       VALUES ($1, 'INDIVIDUAL', $2, 'Probe', '', '',
               ST_SetSRID(ST_MakePoint(-71.21, 46.81), 4326)::geography, 25, true, now())`,
      [id, user],
    );
  }
}

let keySeq = 0;
const fakeItem = (providerId: string) => ({
  serviceProviderId: providerId,
  storageKey: `probe/${providerId}/${(keySeq += 1)}-${Date.now()}.webp`,
  caption: null,
  contentType: 'image/webp',
  width: 10,
  height: 10,
  byteSize: 10,
});

async function fill(repo: PortfolioItemRepository, providerId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const r = await repo.insertUnderCap(fakeItem(providerId));
    if (!r.inserted) throw new Error(`fill refused at ${i}`);
  }
}

async function main(): Promise<void> {
  assertScratchDatabase(process.env.DATABASE_URL);
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [__dirname + '/../../modules/**/*.entity.{ts,js}'],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: ['error'],
  });
  await ds.initialize();
  const repo = new PortfolioItemRepository(ds.getRepository(PortfolioItem));
  const storageDir = mkdtempSync(join(tmpdir(), 'linkr-portfolio-probe-'));

  try {
    // ── A. The ceiling under concurrency ──────────────────────────────────
    console.log('A. ceiling under concurrency');
    for (let round = 1; round <= 5; round += 1) {
      await wipe(ds);
      await seed(ds);
      await fill(repo, P_A, 11);
      const results = await Promise.all([
        repo.insertUnderCap(fakeItem(P_A)),
        repo.insertUnderCap(fakeItem(P_A)),
      ]);
      const ok = results.filter((r) => r.inserted).length;
      const live = await repo.countLive(P_A);
      check(`round ${round}: two racing uploads at 11 → exactly one succeeds`, ok, 1);
      check(`round ${round}: live count is 12, never 13`, live, 12);
    }

    await wipe(ds);
    await seed(ds);
    await fill(repo, P_A, 8);
    const five = await Promise.all(Array.from({ length: 5 }, () => repo.insertUnderCap(fakeItem(P_A))));
    check('five racing uploads at 8 → exactly four succeed', five.filter((r) => r.inserted).length, 4);
    check('… and the refused one says LIMIT_REACHED', five.filter((r) => !r.inserted).map((r) => (r as { reason: string }).reason), ['LIMIT_REACHED']);
    const positions = (await repo.findLiveByProvider(P_A)).map((i) => i.position);
    check('positions are 0..11, distinct, in order', positions, Array.from({ length: 12 }, (_, i) => i));

    // ── B. Reorder: exactly the live set, or nothing ─────────────────────
    console.log('B. reorder');
    await wipe(ds);
    await seed(ds);
    await fill(repo, P_A, 4);
    await fill(repo, P_B, 1);
    const ids = (await repo.findLiveByProvider(P_A)).map((i) => i.id);
    const other = (await repo.findLiveByProvider(P_B))[0].id;
    const before = (await repo.findLiveByProvider(P_A)).map((i) => [i.id, i.position]);

    const reversed = [...ids].reverse();
    check('exact set, reversed → accepted', await repo.reorder(P_A, reversed), true);
    check('positions rewritten to 0..n-1 in the new order', (await repo.findLiveByProvider(P_A)).map((i) => i.id), reversed);
    // Back to the original order for the refusals below.
    await repo.reorder(P_A, ids);

    check('an id missing → refused', await repo.reorder(P_A, ids.slice(1)), false);
    check('an id extra (someone else’s) → refused', await repo.reorder(P_A, [...ids, other]), false);
    check('an id twice (same length) → refused', await repo.reorder(P_A, [ids[0], ids[0], ids[2], ids[3]]), false);
    check('someone else’s id in place of one of mine → refused', await repo.reorder(P_A, [other, ids[1], ids[2], ids[3]]), false);
    const deleted = await repo.softDelete(ids[3], P_A);
    check('soft-delete of my photo returns it', deleted?.id, ids[3]);
    check('a deleted id in the list → refused', await repo.reorder(P_A, ids), false);
    check(
      'refusals wrote NOTHING (positions unchanged)',
      (await repo.findLiveByProvider(P_A)).map((i) => [i.id, i.position]),
      before.slice(0, 3),
    );
    check('an empty list while a photo exists → refused', await repo.reorder(P_B, []), false);

    // ── C. Ownership in the WHERE ────────────────────────────────────────
    console.log('C. ownership');
    check('caption on someone else’s photo → null (404)', await repo.updateCaption(other, P_A, 'x'), null);
    check('delete of someone else’s photo → null (404)', await repo.softDelete(other, P_A), null);
    check('their photo is still live', (await repo.findLiveById(other))?.id, other);
    check('a second delete of the same photo → null', await repo.softDelete(ids[3], P_A), null);

    // ── D. Column CHECKs ─────────────────────────────────────────────────
    console.log('D. CHECKs');
    const rejects = async (sql: string, params: unknown[]): Promise<boolean> => {
      try {
        await ds.query(sql, params);
        return false;
      } catch {
        return true;
      }
    };
    const ins = `INSERT INTO portfolio_items (service_provider_id, storage_key, caption, position,
                   content_type, width, height, byte_size)
                 VALUES ($1, $2, $3, $4, 'image/webp', 1, 1, 1)`;
    check('caption of 141 chars refused', await rejects(ins, [P_B, 'chk-1', 'a'.repeat(141), 0]), true);
    check('empty caption refused (NULL is the empty caption)', await rejects(ins, [P_B, 'chk-2', '', 0]), true);
    check('negative position refused', await rejects(ins, [P_B, 'chk-3', null, -1]), true);
    check('duplicate storage_key refused', await rejects(ins, [P_B, (await repo.findLiveById(other))!.storageKey, null, 0]), true);

    // ── E. End to end through the real service and storage ───────────────
    console.log('E. delete removes the file');
    await wipe(ds);
    await seed(ds);
    const config = { get: (_k: string, d?: string) => (_k === 'STORAGE_LOCAL_DIR' ? storageDir : d) } as unknown as ConfigService;
    const storage = new LocalDiskStorageAdapter(config);
    const service = new PortfolioService(
      repo,
      new ServiceProviderRepository(ds.getRepository(ServiceProvider)),
      new PortfolioImageProcessor(),
      storage,
    );
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const created = await service.upload(U_A, { buffer: jpeg, size: jpeg.length }, '  Ma photo  ');
    check('upload → portrait 600×800', [created.width, created.height], [600, 800]);
    check('caption trimmed by the DTO is stored as given', created.caption, '  Ma photo  ');
    check('imageUrl is relative', created.imageUrl, `/media/portfolio/${created.id}`);
    const row = await repo.findLiveById(created.id);
    const file = join(storageDir, row!.storageKey);
    check('the file exists on disk after upload', existsSync(file), true);
    // From a BUFFER, never `sharp(path)`: libvips caches the open file handle,
    // and on Windows that handle alone makes the delete below fail (EBUSY).
    const stored = await sharp(readFileSync(file)).metadata();
    check('the stored file is WebP with no EXIF', [stored.format, stored.exif === undefined], ['webp', true]);

    const img = await service.getPublicImage(created.id);
    // Read the stream TO THE END and wait for it to CLOSE, like a served
    // response does. On Windows a file still open cannot be unlinked (EPERM):
    // a half-read stream here once made the delete below fail — which is how
    // the local adapter's silent-delete defect was found.
    for await (const _chunk of img.stream) void _chunk;
    await new Promise((resolve) => (img.stream.closed ? resolve(null) : img.stream.once('close', resolve)));
    check('public image readable before delete', img.byteSize, row!.byteSize);

    await service.deleteMine(U_A, created.id);
    check('after delete: gone from the owner list', (await service.listMine(U_A)).items.length, 0);
    check('after delete: gone from the public list', (await service.listPublic(P_A)).items.length, 0);
    let image404 = false;
    try {
      await service.getPublicImage(created.id);
    } catch (e) {
      image404 = e instanceof NotFoundException;
    }
    check('after delete: the image is a 404', image404, true);
    check('after delete: THE FILE NO LONGER EXISTS', existsSync(file), false);

    let otherDelete404 = false;
    const second = await service.upload(U_A, { buffer: jpeg, size: jpeg.length }, null);
    try {
      await service.deleteMine(U_B, second.id);
    } catch (e) {
      otherDelete404 = e instanceof NotFoundException;
    }
    check('another provider deleting my photo → 404', otherDelete404, true);
    check('… and my file is untouched', existsSync(join(storageDir, (await repo.findLiveById(second.id))!.storageKey)), true);

    await ds.query(`UPDATE service_providers SET deleted_at_utc = now() WHERE id = $1`, [P_A]);
    let hidden404 = 0;
    for (const call of [() => service.listPublic(P_A), () => service.getPublicImage(second.id)]) {
      try {
        await call();
      } catch (e) {
        if (e instanceof NotFoundException) hidden404 += 1;
      }
    }
    check('provider soft-deleted → public list AND image are 404', hidden404, 2);
  } finally {
    await wipe(ds).catch(() => undefined);
    await ds.destroy();
    rmSync(storageDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
