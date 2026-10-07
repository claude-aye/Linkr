// Tests des règles de pause, réactivation et retrait d'un métier
// (« Mes métiers » de l'Espace pro, Métiers — PR B).
//
// Même banc que les autres `*.test.mjs` : runner natif de Node, sans
// dépendance — `pnpm --filter @linkr/web test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_JOB_STATUSES,
  PENDING_BOOKING_STATUSES,
  QUOTES_LINE,
  RETIRE_UNVERIFIED_MESSAGE,
  TRADE_UNAVAILABLE_MESSAGE,
  assembleTradeToggleBody,
  canTogglePause,
  countForTrade,
  mergeSnapshots,
  pauseConfirmationLines,
  pauseNeedsConfirmation,
  retireBlockedReason,
  retireConfirmationLines,
  tradeActionMessageForStatus,
} from './trade-lifecycle.ts';

const COIFFURE = 'cat-coiffure';
const DECO = 'cat-deco';

// ---------------------------------------------------------------------------
// Ce qui est offert
// ---------------------------------------------------------------------------

test('pause : offerte sur NOT_REQUIRED et VERIFIED seulement', () => {
  assert.equal(canTogglePause('NOT_REQUIRED'), true);
  assert.equal(canTogglePause('VERIFIED'), true);
  assert.equal(canTogglePause('PENDING'), false);
  assert.equal(canTogglePause('REJECTED'), false);
});

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

const items = [
  { status: 'OPEN', serviceCategoryId: COIFFURE },
  { status: 'OPEN', serviceCategoryId: COIFFURE },
  { status: 'OPEN', serviceCategoryId: DECO },
  { status: 'ASSIGNED', serviceCategoryId: COIFFURE },
  { status: 'IN_PROGRESS', serviceCategoryId: COIFFURE },
  { status: 'COMPLETED', serviceCategoryId: COIFFURE },
  { status: 'PAID', serviceCategoryId: COIFFURE },
  { status: 'CANCELLED', serviceCategoryId: DECO },
];

test('compte : par métier et par statut, sur une liste complète', () => {
  const snap = { items, complete: true };
  assert.equal(countForTrade(snap, PENDING_BOOKING_STATUSES, COIFFURE), 2);
  assert.equal(countForTrade(snap, PENDING_BOOKING_STATUSES, DECO), 1);
  assert.equal(countForTrade(snap, ACTIVE_JOB_STATUSES, COIFFURE), 2);
  assert.equal(countForTrade(snap, ACTIVE_JOB_STATUSES, DECO), 0);
  assert.equal(countForTrade(snap, ACTIVE_JOB_STATUSES, 'cat-absent'), 0);
});

test('compte : COMPLETED ne compte pas comme job actif (décision rendue)', () => {
  const snap = { items: [{ status: 'COMPLETED', serviceCategoryId: COIFFURE }], complete: true };
  assert.equal(countForTrade(snap, ACTIVE_JOB_STATUSES, COIFFURE), 0);
});

test('compte : une liste TRONQUÉE donne un compte inconnu, jamais un compte trop bas', () => {
  const snap = { items, complete: false };
  assert.equal(countForTrade(snap, ACTIVE_JOB_STATUSES, COIFFURE), null);
  assert.equal(countForTrade(snap, PENDING_BOOKING_STATUSES, DECO), null);
});

test('compte : une lecture ratée donne un compte inconnu', () => {
  assert.equal(countForTrade(null, ACTIVE_JOB_STATUSES, COIFFURE), null);
});

test('réunion de deux lectures filtrées', () => {
  const assigned = { items: [{ status: 'ASSIGNED', serviceCategoryId: COIFFURE }], complete: true };
  const inProgress = {
    items: [{ status: 'IN_PROGRESS', serviceCategoryId: COIFFURE }],
    complete: true,
  };
  const merged = mergeSnapshots(assigned, inProgress);
  assert.equal(countForTrade(merged, ACTIVE_JOB_STATUSES, COIFFURE), 2);

  assert.equal(mergeSnapshots(assigned, null), null);
  assert.equal(mergeSnapshots(null, inProgress), null);
  // Une moitié tronquée rend le tout inconnu.
  const truncated = mergeSnapshots(assigned, { ...inProgress, complete: false });
  assert.equal(countForTrade(truncated, ACTIVE_JOB_STATUSES, COIFFURE), null);
});

// ---------------------------------------------------------------------------
// Retrait bloqué
// ---------------------------------------------------------------------------

test('retrait : permis sans job actif', () => {
  assert.equal(retireBlockedReason(0, true), null);
  assert.equal(retireBlockedReason(0, false), null);
});

test('retrait : bloqué avec le message des jobs en cours', () => {
  assert.equal(
    retireBlockedReason(2, true),
    'Vous avez 2 jobs en cours sur ce métier. Terminez-les avant de retirer le métier, ou mettez-le en pause.',
  );
  assert.equal(
    retireBlockedReason(1, true),
    'Vous avez 1 job en cours sur ce métier. Terminez-le avant de retirer le métier, ou mettez-le en pause.',
  );
});

test('retrait : pas de suggestion de pause là où elle n\'est pas offerte', () => {
  assert.equal(
    retireBlockedReason(1, false),
    'Vous avez 1 job en cours sur ce métier. Terminez-le avant de retirer le métier.',
  );
});

test('retrait : bloqué quand le compte est inconnu', () => {
  assert.equal(retireBlockedReason(null, true), RETIRE_UNVERIFIED_MESSAGE);
  assert.equal(
    RETIRE_UNVERIFIED_MESSAGE,
    'Nous n’avons pas pu vérifier vos jobs en cours. Veuillez réessayer plus tard.',
  );
});

// ---------------------------------------------------------------------------
// Confirmation de pause
// ---------------------------------------------------------------------------

test('pause : immédiate sans demande en attente, confirmée sinon', () => {
  assert.equal(pauseNeedsConfirmation(0), false);
  assert.equal(pauseNeedsConfirmation(1), true);
  assert.equal(pauseNeedsConfirmation(null), true);
});

test('pause : la confirmation annonce le nombre et invite à refuser', () => {
  const lines = pauseConfirmationLines(3);
  assert.ok(lines.some((l) => l.startsWith('Vous avez 3 demandes en attente sur ce métier.')));
  assert.ok(lines.some((l) => l.includes('Refusez-les d’abord')));
  assert.ok(lines.includes(QUOTES_LINE));
});

test('pause : singulier', () => {
  const lines = pauseConfirmationLines(1);
  assert.ok(lines.some((l) => l.startsWith('Vous avez 1 demande en attente sur ce métier.')));
  assert.ok(lines.some((l) => l.includes('Refusez-la d’abord')));
});

test('pause : compte inconnu → phrase sans nombre', () => {
  const lines = pauseConfirmationLines(null);
  assert.ok(lines.every((l) => !/\d/.test(l)));
  assert.ok(lines.some((l) => l.startsWith('Les demandes en attente sur ce métier')));
  assert.ok(lines.includes(QUOTES_LINE));
});

test('ligne des devis : texte exact, sans nombre', () => {
  assert.equal(
    QUOTES_LINE,
    'Vos devis déjà envoyés pour ce métier ne pourront plus être acceptés par les clients.',
  );
});

// ---------------------------------------------------------------------------
// Confirmation de retrait
// ---------------------------------------------------------------------------

const base = { serviceCount: 2, pendingBookings: 0, status: 'NOT_REQUIRED', isActive: true };

test('retrait : les quatre lignes, dans l\'ordre', () => {
  assert.deepEqual(retireConfirmationLines({ ...base, pendingBookings: 2 }), [
    'Vous n’apparaîtrez plus dans les résultats de recherche pour ce métier.',
    'Vos 2 services seront perdus et ne reviendront pas si vous redéclarez ce métier.',
    'Vos 2 demandes en attente ne pourront plus être acceptées.',
    QUOTES_LINE,
    'Pour une absence temporaire, préférez la pause.',
  ]);
});

test('retrait : la ligne des demandes n\'apparaît que si N > 0', () => {
  const lines = retireConfirmationLines(base);
  assert.ok(lines.every((l) => !l.includes('demande')));
});

test('retrait : singuliers', () => {
  const lines = retireConfirmationLines({ ...base, serviceCount: 1, pendingBookings: 1 });
  assert.ok(lines.includes('Votre service sera perdu et ne reviendra pas si vous redéclarez ce métier.'));
  assert.ok(lines.includes('Votre demande en attente ne pourra plus être acceptée.'));
});

test('retrait : aucun service → pas de ligne de services', () => {
  const lines = retireConfirmationLines({ ...base, serviceCount: 0 });
  assert.ok(lines.every((l) => !l.includes('service')));
});

test('retrait : services en nombre inconnu → phrase sans nombre', () => {
  const lines = retireConfirmationLines({ ...base, serviceCount: null });
  assert.ok(
    lines.includes(
      'Les services de ce métier seront perdus et ne reviendront pas si vous le redéclarez.',
    ),
  );
});

test('retrait : demandes en nombre inconnu → phrase sans nombre', () => {
  const lines = retireConfirmationLines({ ...base, pendingBookings: null });
  assert.ok(lines.includes('Les demandes en attente sur ce métier ne pourront plus être acceptées.'));
});

test('retrait : la pause n\'est suggérée que là où elle est offerte', () => {
  for (const status of ['PENDING', 'REJECTED']) {
    const lines = retireConfirmationLines({ ...base, status });
    assert.ok(lines.every((l) => !l.includes('pause')), status);
  }
  const paused = retireConfirmationLines({ ...base, isActive: false });
  assert.ok(paused.includes('Pour une absence temporaire, gardez plutôt ce métier en pause.'));
});

// ---------------------------------------------------------------------------
// Messages par code HTTP
// ---------------------------------------------------------------------------

test('messages : par code HTTP seul', () => {
  assert.equal(
    tradeActionMessageForStatus(404, 'retire'),
    'Ce métier a déjà été retiré de votre profil. Veuillez actualiser la page.',
  );
  assert.equal(
    tradeActionMessageForStatus(404, 'toggle'),
    'Ce métier n’existe plus sur votre profil. Veuillez actualiser la page.',
  );
  assert.equal(
    tradeActionMessageForStatus(403, 'toggle'),
    'Vous n’êtes pas autorisé à modifier ce profil prestataire.',
  );
  assert.equal(
    tradeActionMessageForStatus(401, 'retire'),
    'Votre session a expiré. Veuillez vous reconnecter.',
  );
  assert.equal(
    tradeActionMessageForStatus(400, 'toggle'),
    'La requête est invalide. Veuillez actualiser la page.',
  );
  for (const status of [500, 502, 409, 0]) {
    assert.equal(tradeActionMessageForStatus(status, 'retire'), TRADE_UNAVAILABLE_MESSAGE);
  }
});

// ---------------------------------------------------------------------------
// Corps relayé
// ---------------------------------------------------------------------------

test('corps : isActive booléen seulement, toute autre clé écartée', () => {
  assert.deepEqual(assembleTradeToggleBody({ isActive: false }), { isActive: false });
  assert.deepEqual(assembleTradeToggleBody({ isActive: true, junk: 1, verificationStatus: 'VERIFIED' }), {
    isActive: true,
  });
});

test('corps : refusé sans booléen (un PATCH {} ne doit jamais partir)', () => {
  for (const incoming of [{}, { isActive: 'false' }, { isActive: null }, { isActive: 0 }, null, [], 'x']) {
    assert.equal(assembleTradeToggleBody(incoming), null, JSON.stringify(incoming));
  }
});
