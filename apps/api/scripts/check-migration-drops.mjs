#!/usr/bin/env node
/**
 * Migration guard — refuses an unmarked `DROP INDEX` inside a migration's `up()`.
 *
 * Why this exists
 * ---------------
 * Most indexes in this repo were created with raw SQL and have no matching
 * `@Index` / `@Unique` decorator on the entity. TypeORM therefore sees them as
 * orphans and `migration:generate` proposes dozens of `DROP INDEX` statements,
 * including UNIQUE ones that carry real business invariants (`ux_users_email`,
 * `uq_pm_default_user`, `ux_psc_provider_category_active`…).
 *
 * Dropping one of those does not destroy data — it removes the *guarantee* and
 * lets duplicates in afterwards. The realistic failure is a generated migration
 * applied locally and committed without anyone reading the diff. This guard is
 * the tripwire for exactly that.
 *
 * What it checks
 * --------------
 * For every migration file, only the body of `up()` is inspected (a `DROP INDEX`
 * in `down()` is the normal way to reverse a `CREATE INDEX` and is always fine).
 * A `DROP INDEX` in `up()` is reported unless either:
 *
 *   1. the same `up()` also creates an index with that exact name (rename or
 *      deliberate recreation), or
 *   2. it carries an explicit marker on the same line or one of the three lines
 *      above it:
 *
 *        // @intentional-drop: superseded by ux_users_email_ci (case-insensitive)
 *        await queryRunner.query(`DROP INDEX "ux_users_email"`);
 *
 *      The reason after the colon is mandatory. A bare marker is still a failure.
 *
 * What it is NOT
 * --------------
 * A text scanner, not a TypeScript analyser. A query assembled from variables or
 * split across concatenated strings will slip past it. That is acceptable: what
 * it must catch is `migration:generate` output, which is well-formed literal SQL.
 *
 * Run: node apps/api/scripts/check-migration-drops.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const MIGRATIONS_DIR = resolve(HERE, '..', 'src', 'database', 'migrations');

const MARKER = '@intentional-drop:';
const MARKER_LOOKBEHIND_LINES = 3;

/** `public async up(` and `async up(` both occur in this repo. */
const UP_DECL = /(?:public\s+)?async\s+up\s*\(/;
const DOWN_DECL = /(?:public\s+)?async\s+down\s*\(/;

/**
 * `migration:generate` qualifies its drops by schema — `DROP INDEX
 * "public"."ux_users_email"` — so the optional qualifier must be consumed
 * before the name is captured, or the name reads as "public".
 */
const DROP_INDEX =
  /DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(?:"?[A-Za-z0-9_$]+"?\s*\.\s*)?"?([A-Za-z0-9_$]+)"?/gi;

const createIndexNamed = (name) =>
  new RegExp(
    `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:CONCURRENTLY\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?[A-Za-z0-9_$]+"?\\s*\\.\\s*)?"?${name}"?`,
    'i',
  );

/** Body of `up()`, or null when the file declares no `up()`. */
function extractUpBody(source) {
  const up = source.match(UP_DECL);
  if (!up) return null;

  const start = up.index;
  const after = source.slice(start);
  const down = after.match(DOWN_DECL);
  const end = down ? start + down.index : source.length;

  return { text: source.slice(start, end), offset: start };
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/**
 * The marker must sit on the statement's own line or just above it, and must
 * carry a non-empty reason. Returns 'ok' | 'missing' | 'no-reason'.
 */
function markerState(source, dropLine) {
  const lines = source.split('\n');
  const from = Math.max(0, dropLine - 1 - MARKER_LOOKBEHIND_LINES);
  const window = lines.slice(from, dropLine).join('\n');

  const at = window.lastIndexOf(MARKER);
  if (at === -1) return 'missing';

  const rest = window.slice(at + MARKER.length);
  const reason = rest.split('\n')[0].trim();
  return reason.length > 0 ? 'ok' : 'no-reason';
}

function inspect(file) {
  const source = readFileSync(file, 'utf8');
  const up = extractUpBody(source);
  if (!up) return [];

  const findings = [];

  for (const match of up.text.matchAll(DROP_INDEX)) {
    const name = match[1];

    // Rename or deliberate recreation inside the same up() — legitimate.
    if (createIndexNamed(name).test(up.text)) continue;

    const line = lineNumberAt(source, up.offset + match.index);
    const state = markerState(source, line);
    if (state === 'ok') continue;

    findings.push({ name, line, state });
  }

  return findings;
}

function main() {
  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.ts'))
      .sort()
      .map((f) => join(MIGRATIONS_DIR, f));
  } catch (err) {
    console.error(`Cannot read ${MIGRATIONS_DIR}: ${err.message}`);
    process.exit(2);
  }

  const violations = [];
  for (const file of files) {
    for (const finding of inspect(file)) violations.push({ file, ...finding });
  }

  if (violations.length === 0) {
    console.log(
      `Migration guard: ${files.length} migration(s) scanned, no unmarked DROP INDEX in up().`,
    );
    return;
  }

  console.error('Migration guard: unmarked DROP INDEX found in up().\n');
  for (const v of violations) {
    const where = `${relative(REPO_ROOT, v.file).replace(/\\/g, '/')}:${v.line}`;
    const why =
      v.state === 'no-reason'
        ? `marker present but no reason given after "${MARKER}"`
        : 'no marker';
    console.error(`  ${where}  DROP INDEX "${v.name}"  — ${why}`);
  }

  console.error(
    [
      '',
      'An index dropped by accident does not delete rows — it removes the guarantee,',
      'and duplicates start getting in afterwards. Most of these statements come from',
      '`migration:generate`, which proposes dropping every index this repo created in',
      'raw SQL without a matching decorator.',
      '',
      'If the drop is NOT intended: remove it from up().',
      'If it IS intended: state why, on the line above it.',
      '',
      `    // ${MARKER} <reason>`,
      '    await queryRunner.query(`DROP INDEX "..."`);',
      '',
    ].join('\n'),
  );

  process.exit(1);
}

main();
