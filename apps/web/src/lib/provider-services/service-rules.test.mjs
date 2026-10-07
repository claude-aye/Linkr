// Tests des règles « Mes services » (PR A) — prix, durée, messages, corps des
// relais.
//
// Même banc que les autres : runner natif de Node, sans dépendance —
// `pnpm --filter @linkr/web test`. Les MESSAGES sont écrits en toutes lettres :
// ce sont eux que le prestataire lit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_SERVICE_PRICE,
  PRICE_BELOW_MINIMUM_MESSAGE,
  assembleCreateServiceBody,
  assembleUpdateServiceBody,
  durationToFields,
  formatDuration,
  formatServicePrice,
  isValidPriceAmount,
  itemsNotYetOffered,
  normalizeDescription,
  parseDuration,
  parsePrice,
  serviceMessageForStatus,
} from './service-rules.ts';

// ---------------------------------------------------------------------------
// Prix — plancher de 5 $
// ---------------------------------------------------------------------------

test('le plancher vaut 5 $', () => {
  assert.equal(MIN_SERVICE_PRICE, 5);
});

test('4,99 $ est refusé avec le message du plancher', () => {
  assert.deepEqual(parsePrice('4,99'), { kind: 'invalid', message: 'Le prix doit être d’au moins 5 $.' });
  assert.equal(PRICE_BELOW_MINIMUM_MESSAGE, 'Le prix doit être d’au moins 5 $.');
});

test('5 $ pile passe (borne inclusive)', () => {
  assert.deepEqual(parsePrice('5'), { kind: 'ok', amount: 5 });
  assert.deepEqual(parsePrice('5,00'), { kind: 'ok', amount: 5 });
});

test('virgule québécoise, point et espaces insécables', () => {
  assert.deepEqual(parsePrice('40,50'), { kind: 'ok', amount: 40.5 });
  assert.deepEqual(parsePrice('40.5'), { kind: 'ok', amount: 40.5 });
  assert.deepEqual(parsePrice('1 250,00'), { kind: 'ok', amount: 1250 });
  assert.deepEqual(parsePrice(' 1 250 '), { kind: 'ok', amount: 1250 });
});

test('prix vide, malformé ou à trois décimales : refusé', () => {
  assert.equal(parsePrice('').kind, 'invalid');
  assert.equal(parsePrice('   ').kind, 'invalid');
  assert.equal(parsePrice('abc').kind, 'invalid');
  assert.equal(parsePrice('-10').kind, 'invalid');
  assert.equal(parsePrice('10,999').kind, 'invalid');
  assert.equal(parsePrice('0').kind, 'invalid');
});

test('prix au-delà de la colonne decimal(10,2) : refusé', () => {
  assert.equal(parsePrice('99999999,99').kind, 'ok');
  assert.equal(parsePrice('100000000').kind, 'invalid');
});

test('isValidPriceAmount : le plancher vu par les relais', () => {
  assert.equal(isValidPriceAmount(5), true);
  assert.equal(isValidPriceAmount(40.5), true);
  assert.equal(isValidPriceAmount(99999999.99), true);
  assert.equal(isValidPriceAmount(4.99), false);
  assert.equal(isValidPriceAmount(0), false);
  assert.equal(isValidPriceAmount(10.999), false);
  assert.equal(isValidPriceAmount('40'), false);
  assert.equal(isValidPriceAmount(null), false);
  assert.equal(isValidPriceAmount(Number.NaN), false);
});

// ---------------------------------------------------------------------------
// Durée — heures + minutes → minutes entières
// ---------------------------------------------------------------------------

test('0 h 45 → 45 minutes', () => {
  assert.deepEqual(parseDuration('0', '45'), { kind: 'ok', minutes: 45 });
});

test('1 h 30 → 90 minutes ; un champ vide compte pour 0', () => {
  assert.deepEqual(parseDuration('1', '30'), { kind: 'ok', minutes: 90 });
  assert.deepEqual(parseDuration('2', ''), { kind: 'ok', minutes: 120 });
  assert.deepEqual(parseDuration('', '15'), { kind: 'ok', minutes: 15 });
});

test('les deux champs vides → aucune durée (clé omise)', () => {
  assert.deepEqual(parseDuration('', ''), { kind: 'empty' });
  assert.deepEqual(parseDuration('  ', ' '), { kind: 'empty' });
});

test('0 h 0 min, minutes > 59, décimales, négatifs : refusés', () => {
  assert.equal(parseDuration('0', '0').kind, 'invalid');
  assert.equal(parseDuration('1', '60').kind, 'invalid');
  assert.equal(parseDuration('1,5', '').kind, 'invalid');
  assert.equal(parseDuration('-1', '').kind, 'invalid');
  assert.equal(parseDuration('', 'abc').kind, 'invalid');
});

test('durationToFields : préremplissage de l’édition', () => {
  assert.deepEqual(durationToFields(45), { hours: '', minutes: '45' });
  assert.deepEqual(durationToFields(105), { hours: '1', minutes: '45' });
  assert.deepEqual(durationToFields(120), { hours: '2', minutes: '' });
  assert.deepEqual(durationToFields(null), { hours: '', minutes: '' });
});

test('aller-retour durée : champs → minutes → champs', () => {
  for (const minutes of [1, 45, 59, 60, 61, 105, 600]) {
    const fields = durationToFields(minutes);
    assert.deepEqual(parseDuration(fields.hours, fields.minutes), { kind: 'ok', minutes });
  }
});

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

test('formatServicePrice : FLAT, HOURLY, QUOTE_ONLY', () => {
  // fr-CA place le symbole après le montant, séparé par une espace insécable.
  assert.equal(formatServicePrice(40, 'CAD', 'FLAT').replace(/\s/g, ' '), '40,00 $');
  assert.equal(formatServicePrice(40, 'CAD', 'HOURLY').replace(/\s/g, ' '), '40,00 $ / h');
  assert.equal(formatServicePrice(null, 'CAD', 'QUOTE_ONLY'), 'Sur devis');
  assert.equal(formatServicePrice(null, 'CAD', 'FLAT'), 'Sur devis');
});

test('formatDuration', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(60), '1 h');
  assert.equal(formatDuration(90), '1 h 30');
  assert.equal(formatDuration(65), '1 h 05');
  assert.equal(formatDuration(null), null);
});

test('normalizeDescription : vide → null, jamais ""', () => {
  assert.equal(normalizeDescription(''), null);
  assert.equal(normalizeDescription('   '), null);
  assert.equal(normalizeDescription('  Avec shampoing  '), 'Avec shampoing');
});

// ---------------------------------------------------------------------------
// Messages — par code HTTP seul
// ---------------------------------------------------------------------------

test('409 : déjà offert, et quoi faire s’il est désactivé', () => {
  assert.equal(
    serviceMessageForStatus(409),
    'Ce service est déjà offert pour ce métier. S’il est désactivé, réactivez-le dans la liste.',
  );
});

test('422 : sorti du catalogue', () => {
  assert.equal(
    serviceMessageForStatus(422),
    'Ce service n’est plus offert dans le catalogue. Veuillez actualiser la page.',
  );
});

test('les autres statuts', () => {
  assert.equal(
    serviceMessageForStatus(404),
    'Ce service ou ce métier n’existe plus. Veuillez actualiser la page.',
  );
  assert.equal(
    serviceMessageForStatus(403),
    'Vous n’êtes pas autorisé à modifier ce profil prestataire.',
  );
  assert.equal(
    serviceMessageForStatus(400),
    'Certaines informations sont invalides. Veuillez vérifier votre saisie.',
  );
  assert.equal(
    serviceMessageForStatus(401),
    'Votre session a expiré. Veuillez vous reconnecter.',
  );
  for (const status of [500, 502, 503, 0]) {
    assert.equal(
      serviceMessageForStatus(status),
      'Service momentanément indisponible. Veuillez réessayer.',
    );
  }
});

// ---------------------------------------------------------------------------
// Corps du POST — champ par champ, jamais étalé
// ---------------------------------------------------------------------------

const ITEM = '8d0719f4-f3dc-47ca-8dcc-0ea9aef928b9';

test('POST : FLAT et CAD sont FIGÉS, quoi que demande le navigateur', () => {
  const result = assembleCreateServiceBody({
    serviceItemId: ITEM,
    priceAmount: 40,
    pricingModel: 'HOURLY',
    priceCurrency: 'EUR',
  });
  assert.deepEqual(result, {
    ok: true,
    body: { serviceItemId: ITEM, pricingModel: 'FLAT', priceAmount: 40, priceCurrency: 'CAD' },
  });
});

test('POST : une clé parasite ne passe pas', () => {
  const result = assembleCreateServiceBody({
    serviceItemId: ITEM,
    priceAmount: 40,
    estimatedDurationMinutes: 45,
    descriptionOverride: 'Avec shampoing',
    isActive: false,
    professionalServiceCategoryId: 'x',
    junk: 'HACKED',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.body).sort(), [
    'descriptionOverride',
    'estimatedDurationMinutes',
    'priceAmount',
    'priceCurrency',
    'pricingModel',
    'serviceItemId',
  ]);
});

test('POST : durée et description absentes → clés omises', () => {
  const result = assembleCreateServiceBody({
    serviceItemId: ITEM,
    priceAmount: 40,
    descriptionOverride: '   ',
  });
  assert.equal(result.ok, true);
  assert.equal('estimatedDurationMinutes' in result.body, false);
  assert.equal('descriptionOverride' in result.body, false);
});

test('POST : le plancher de 5 $ est tenu par le relais aussi', () => {
  assert.deepEqual(assembleCreateServiceBody({ serviceItemId: ITEM, priceAmount: 4.99 }), {
    ok: false,
  });
  assert.deepEqual(assembleCreateServiceBody({ serviceItemId: ITEM }), { ok: false });
});

test('POST : formes invalides refusées', () => {
  assert.deepEqual(assembleCreateServiceBody(null), { ok: false });
  assert.deepEqual(assembleCreateServiceBody([]), { ok: false });
  assert.deepEqual(assembleCreateServiceBody({ serviceItemId: '', priceAmount: 40 }), { ok: false });
  assert.deepEqual(
    assembleCreateServiceBody({ serviceItemId: ITEM, priceAmount: 40, estimatedDurationMinutes: 0 }),
    { ok: false },
  );
  assert.deepEqual(
    assembleCreateServiceBody({ serviceItemId: ITEM, priceAmount: 40, estimatedDurationMinutes: 1.5 }),
    { ok: false },
  );
  assert.deepEqual(
    assembleCreateServiceBody({ serviceItemId: ITEM, priceAmount: 40, descriptionOverride: 7 }),
    { ok: false },
  );
});

// ---------------------------------------------------------------------------
// Corps du PATCH
// ---------------------------------------------------------------------------

test('PATCH : une clé parasite ne passe pas, le modèle et la devise non plus', () => {
  const result = assembleUpdateServiceBody({
    priceAmount: 45,
    pricingModel: 'QUOTE_ONLY',
    priceCurrency: 'EUR',
    serviceItemId: ITEM,
    junk: 'HACKED',
  });
  assert.deepEqual(result, { ok: true, body: { priceAmount: 45 } });
});

test('PATCH : priceAmount null n’est JAMAIS relayé', () => {
  assert.deepEqual(assembleUpdateServiceBody({ priceAmount: null }), { ok: false });
  assert.deepEqual(
    assembleUpdateServiceBody({ priceAmount: null, isActive: true }),
    { ok: false },
  );
});

test('PATCH : le plancher de 5 $ s’applique aussi à l’édition du prix', () => {
  assert.deepEqual(assembleUpdateServiceBody({ priceAmount: 4.99 }), { ok: false });
  assert.deepEqual(assembleUpdateServiceBody({ priceAmount: 5 }), { ok: true, body: { priceAmount: 5 } });
});

test('PATCH : description vidée → null, jamais ""', () => {
  assert.deepEqual(assembleUpdateServiceBody({ descriptionOverride: '' }), {
    ok: true,
    body: { descriptionOverride: null },
  });
  assert.deepEqual(assembleUpdateServiceBody({ descriptionOverride: '   ' }), {
    ok: true,
    body: { descriptionOverride: null },
  });
  assert.deepEqual(assembleUpdateServiceBody({ descriptionOverride: null }), {
    ok: true,
    body: { descriptionOverride: null },
  });
});

test('PATCH : durée null efface la colonne, durée invalide refusée', () => {
  assert.deepEqual(assembleUpdateServiceBody({ estimatedDurationMinutes: null }), {
    ok: true,
    body: { estimatedDurationMinutes: null },
  });
  assert.deepEqual(assembleUpdateServiceBody({ estimatedDurationMinutes: 0 }), { ok: false });
  assert.deepEqual(assembleUpdateServiceBody({ estimatedDurationMinutes: '45' }), { ok: false });
});

test('PATCH : interrupteur actif', () => {
  assert.deepEqual(assembleUpdateServiceBody({ isActive: false }), {
    ok: true,
    body: { isActive: false },
  });
  assert.deepEqual(assembleUpdateServiceBody({ isActive: 'false' }), { ok: false });
});

test('PATCH : un corps vide (ou fait seulement de clés parasites) est refusé', () => {
  assert.deepEqual(assembleUpdateServiceBody({}), { ok: false });
  assert.deepEqual(assembleUpdateServiceBody({ junk: 1 }), { ok: false });
  assert.deepEqual(assembleUpdateServiceBody(null), { ok: false });
});

// ---------------------------------------------------------------------------
// Menu d'ajout — services pas encore offerts
// ---------------------------------------------------------------------------

test('le menu exclut tout service non supprimé, désactivé compris', () => {
  const catalogue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const offered = [
    { serviceItemId: 'a', isActive: true },
    // Désactivé : `existsActive` le compte aussi, donc le réajouter ferait 409.
    { serviceItemId: 'c', isActive: false },
  ];
  assert.deepEqual(itemsNotYetOffered(catalogue, offered), [{ id: 'b' }]);
  assert.deepEqual(itemsNotYetOffered(catalogue, []), catalogue);
});
