import test from 'node:test';
import assert from 'node:assert/strict';
import { studentPrintCardsSchema } from '../src/modules/students/students.schemas.js';

test('studentPrintCardsSchema acepta filtros vacíos y studentIds vacíos', () => {
  const payload = studentPrintCardsSchema.parse({
    studentIds: [],
    filters: { q: '', campus: 'CIENCIAS_APLICADAS', level: '', grade: '2', section: '' },
  });

  assert.deepEqual(payload.studentIds, []);
  assert.equal(payload.filters.campus, 'CIENCIAS_APLICADAS');
  assert.equal(payload.filters.grade, '2');
});

test('studentPrintCardsSchema acepta grade numérico y omite filtros opcionales', () => {
  const payload = studentPrintCardsSchema.parse({
    studentIds: ['69a9cf5044a26fb88b9e4666'],
    filters: { grade: 3 },
  });

  assert.equal(payload.studentIds.length, 1);
  assert.equal(payload.filters.grade, 3);
});
