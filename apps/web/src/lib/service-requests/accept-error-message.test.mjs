// Tests du message d'erreur de l'acceptation d'une réservation directe
// (« Accepter » de l'Espace pro).
//
// Même banc que `price-display.test.mjs` : runner natif de Node, sans
// dépendance — `pnpm --filter @linkr/web test`.
//
// Les MESSAGES sont écrits en toutes lettres ici, copiés du composant AVANT
// l'extraction : ce sont eux que le prestataire lit, et un message qui bougerait
// sans que ce fichier le sache serait une régression invisible.
//
// L'adresse de support est FACTICE : le module la reçoit en paramètre, et le
// test prouve qu'il cite celle qu'on lui passe — pas une adresse écrite en dur.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { acceptErrorMessage } from './accept-error-message.ts';

const FAKE_SUPPORT = 'aide@exemple.test';

test('403 : le métier perdu, avec l\'adresse de support passée', () => {
  assert.equal(
    acceptErrorMessage(403, FAKE_SUPPORT),
    'Vous ne pouvez plus accepter cette demande : ce métier est en pause sur votre profil ' +
      'ou sa vérification n\'est plus valide. Écrivez-nous à aide@exemple.test pour le rétablir.',
  );
});

test('403 : l\'adresse vient du paramètre, jamais d\'une constante', () => {
  const other = acceptErrorMessage(403, 'autre@exemple.test');
  assert.ok(other.includes('autre@exemple.test'));
  assert.ok(!other.includes(FAKE_SUPPORT));
});

// Les statuts existants : identiques mot pour mot à avant l'extraction.
const UNCHANGED = [
  [
    409,
    "Cette demande n'est plus disponible ou un problème de paiement empêche l'acceptation. Veuillez rafraîchir la page et réessayer.",
  ],
  [422, "Cette demande n'a pas de montant estimé et ne peut être acceptée."],
  [404, "Cette demande n'est plus accessible."],
  [502, 'Le prélèvement du dépôt a échoué. Veuillez réessayer dans quelques instants.'],
  [500, 'Une erreur inattendue est survenue. Veuillez réessayer plus tard.'],
  [401, 'Une erreur inattendue est survenue. Veuillez réessayer plus tard.'],
];

for (const [status, expected] of UNCHANGED) {
  test(`${status} : message inchangé`, () => {
    assert.equal(acceptErrorMessage(status, FAKE_SUPPORT), expected);
  });
}
