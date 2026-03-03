import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreUnassignedMatch } from '../src/modules/students/students.service.js';
import { unassignedSearchQuerySchema } from '../src/modules/students/students.schemas.js';

test('unassigned score prioriza dni exacto', () => {
  const score = scoreUnassignedMatch({
    qNormalized: '77889911',
    dni: '77889911',
    names: 'Ana',
    lastNames: 'Pérez',
    internalCode: 'COD_A9999',
  });

  assert.equal(score, 300);
});

test('unassigned schema exige q >= 2', () => {
  const parsed = unassignedSearchQuerySchema.parse({ q: '  he ', limit: '20' });
  assert.equal(parsed.q, 'he');
  assert.equal(parsed.limit, 20);

  assert.throws(() => unassignedSearchQuerySchema.parse({ q: 'x' }));
});
