import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidAmountCents, nextInvoiceNumber, canDelete, canTransition, shouldAssignNumber } from '../src/domain/invoicing';

test('montant : entier strictement positif requis', () => {
  assert.equal(isValidAmountCents(100), true);
  assert.equal(isValidAmountCents(0), false);
  assert.equal(isValidAmountCents(-50), false);
  assert.equal(isValidAmountCents(1.5), false);
  assert.equal(isValidAmountCents('100' as unknown), false);
});

test('numérotation monotone, jamais réutilisée', () => {
  assert.deepEqual(nextInvoiceNumber(0, 2026), { seq: 1, number: 'F-2026-000001' });
  assert.deepEqual(nextInvoiceNumber(41, 2026), { seq: 42, number: 'F-2026-000042' });
});

test('suppression : seulement un brouillon', () => {
  assert.equal(canDelete('draft'), true);
  assert.equal(canDelete('issued'), false);
  assert.equal(canDelete('paid'), false);
  assert.equal(canDelete('cancelled'), false);
});

test('transitions de statut', () => {
  assert.equal(canTransition('draft', 'issued'), true);
  assert.equal(canTransition('draft', 'paid'), false);
  assert.equal(canTransition('issued', 'paid'), true);
  assert.equal(canTransition('paid', 'issued'), false);
  assert.equal(canTransition('cancelled', 'issued'), false);
});

test('numéro attribué uniquement à l’émission', () => {
  assert.equal(shouldAssignNumber('draft', 'issued'), true);
  assert.equal(shouldAssignNumber('issued', 'paid'), false);
});
