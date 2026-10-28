import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCurrentPage, isInSection, isMenuOpen } from './nav-active.ts';

test('aria-current : égalité stricte du chemin', () => {
  assert.equal(isCurrentPage('/requests', '/requests'), true);
  assert.equal(isCurrentPage('/requests/abc/devis', '/requests'), false);
  assert.equal(isCurrentPage('/recherche', '/requests'), false);
  assert.equal(isCurrentPage(null, '/requests'), false);
});

test('style actif : la page elle-même et ses sous-routes', () => {
  assert.equal(isInSection('/dashboard', '/dashboard'), true);
  assert.equal(isInSection('/dashboard/paiements', '/dashboard'), true);
  assert.equal(isInSection('/dashboard/paiements/retour', '/dashboard'), true);
  assert.equal(isInSection('/account/payment-methods', '/account/payment-methods'), true);
});

test('style actif : un préfixe sans barre oblique ne compte pas', () => {
  assert.equal(isInSection('/requestsx', '/requests'), false);
  assert.equal(isInSection('/request', '/requests'), false);
  assert.equal(isInSection('/', '/requests'), false);
  assert.equal(isInSection(null, '/requests'), false);
});

test('panneau : ouvert seulement sur le chemin où il a été ouvert', () => {
  assert.equal(isMenuOpen(null, '/recherche'), false);
  assert.equal(isMenuOpen('/recherche', '/recherche'), true);
  // Changement de route : le panneau se ferme sans action.
  assert.equal(isMenuOpen('/recherche', '/requests'), false);
  assert.equal(isMenuOpen('/recherche', null), false);
});
