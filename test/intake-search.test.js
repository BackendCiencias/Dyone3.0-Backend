import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchScore } from '../src/modules/enrollments/enrollments.service.js';
import { intakeSearchQuerySchema } from '../src/modules/enrollments/enrollments.schemas.js';

test('intake score prioriza dni exacto', () => {
  const score = buildSearchScore({
    normalizedQ: '12345678',
    dni: '12345678',
    names: 'Juan',
    lastNames: 'Heredia',
    internalCode: 'COD_A0001',
  });

  assert.equal(score, 300);
});

test('intake score reconoce prefijo por apellido', () => {
  const score = buildSearchScore({
    normalizedQ: 'her',
    dni: null,
    names: 'Juan',
    lastNames: 'Heredia',
    internalCode: 'COD_A0001',
  });

  assert.equal(score, 200);
});

test('intake schema valida campusScope y q', () => {
  const parsed = intakeSearchQuerySchema.parse({ q: '  heredia ', campusScope: 'CIENCIAS' });
  assert.equal(parsed.q, 'heredia');

  assert.throws(() => intakeSearchQuerySchema.parse({ q: 'h', campusScope: 'CIENCIAS' }));
});
