#!/usr/bin/env node
/**
 * Mirror guard — keeps a constant that exists in two apps from drifting.
 *
 * Why this exists
 * ---------------
 * The desired-window rules are enforced on both sides: the form refuses what
 * the API would refuse, so the client never offers a slot the server rejects.
 * That only holds while the numbers agree.
 *
 * They can only disagree in two ways, and both are bad in different registers:
 *
 *   - Loosening the server alone lets through what the form refuses.
 *     Inconsistent, but harmless — nobody can reach it through the UI.
 *   - Tightening the server alone makes the API reject a window the interface
 *     has just offered. And because the client maps errors BY HTTP STATUS ONLY
 *     (lock 3.12b), all the user sees is "Certains champs sont invalides…"
 *     with nothing on screen able to explain which one. That is the failure
 *     this guard exists for.
 *
 * These values are also interpolated into the visible copy ("Dans au moins 2
 * heures", "ne peut pas dépasser 24 heures"), so a drift is a lie on screen as
 * much as a mismatch in the rules.
 *
 * This is a tripwire, not a cure. The cure is a single shared source, which is
 * a monorepo-wide architectural decision and deliberately not taken here. The
 * guard catches a changed VALUE; it will not follow a constant that someone
 * moves to another file — such a move must update MIRRORS below.
 *
 * Run: node scripts/check-mirrored-constants.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const API_CONSTANTS = 'apps/api/src/modules/service-requests/constants.ts';
const REQUEST_FORM = 'apps/web/src/app/(app)/requests/new/create-request-form.tsx';

/**
 * Every constant that must hold the same value in more than one place.
 *
 * Not listed on purpose: RESPONSE_WINDOW_HOURS (server-only, derives the
 * deadline) and DEFAULT_WINDOW_HOURS (client-only, prefills the end bound).
 * Neither is mirrored, and listing them would make this guard fail on a
 * difference that is correct.
 */
const MIRRORS = [
  {
    name: 'MIN_LEAD_TIME_HOURS',
    why: 'D5c — the floor the form offers must be the floor the API accepts',
    files: [API_CONSTANTS, REQUEST_FORM],
  },
  {
    name: 'MAX_WINDOW_HOURS',
    why: 'D5d — width ceiling, strict `>` comparator on both sides',
    files: [API_CONSTANTS, REQUEST_FORM],
  },
];

/** `export const NAME = 24;` and `const NAME: number = 24;` both count. */
function declarationsOf(name, source) {
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${name}\\s*(?::\\s*number\\s*)?=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`,
    'g',
  );
  return [...source.matchAll(re)].map((m) => m[1]);
}

function main() {
  const problems = [];
  const cache = new Map();

  const read = (rel) => {
    if (!cache.has(rel)) {
      const abs = resolve(REPO_ROOT, rel);
      cache.set(rel, existsSync(abs) ? readFileSync(abs, 'utf8') : null);
    }
    return cache.get(rel);
  };

  for (const mirror of MIRRORS) {
    const found = [];

    for (const rel of mirror.files) {
      const source = read(rel);

      if (source === null) {
        problems.push(`${mirror.name}: file not found — ${rel}`);
        continue;
      }

      const values = declarationsOf(mirror.name, source);

      if (values.length === 0) {
        problems.push(
          `${mirror.name}: no numeric declaration found in ${rel} — moved, renamed, or no longer a literal`,
        );
        continue;
      }
      if (values.length > 1) {
        problems.push(
          `${mirror.name}: ${values.length} declarations in ${rel} — ambiguous, cannot compare`,
        );
        continue;
      }

      found.push({ rel, value: values[0] });
    }

    if (found.length !== mirror.files.length) continue;

    const distinct = new Set(found.map((f) => f.value));
    if (distinct.size > 1) {
      problems.push(
        `${mirror.name}: values disagree — ` +
          found.map((f) => `${f.value} in ${f.rel}`).join(' vs '),
      );
    }
  }

  if (problems.length === 0) {
    console.log(
      `Mirror guard: ${MIRRORS.length} mirrored constant(s) checked, all in agreement.`,
    );
    return;
  }

  console.error('Mirror guard: mirrored constants are out of sync.\n');
  for (const p of problems) console.error(`  ${p}`);

  console.error(
    [
      '',
      'These values are enforced on both sides so the form never offers a slot',
      'the API refuses. Tightening the server alone produces a 400 the interface',
      'cannot explain — errors are mapped by HTTP status only (lock 3.12b).',
      '',
      'Change both, or drop the mirror from MIRRORS in this script and say why.',
      '',
    ].join('\n'),
  );

  process.exit(1);
}

main();
