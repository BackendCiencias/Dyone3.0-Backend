import test from 'node:test';
import assert from 'node:assert/strict';

import { buildClassroomBoardEnrollmentFilter } from '../src/modules/classrooms/classrooms.service.js';

test('el tablero no filtra por campus del encabezado de matrícula', () => {
  const cycleId = '69c15c7062dacc3e0c6f8ead';
  const filter = buildClassroomBoardEnrollmentFilter(cycleId);

  assert.deepEqual(filter, {
    cycleId,
    status: { $ne: 'TRANSFERRED' },
  });
  assert.equal(Object.hasOwn(filter, 'campusId'), false);
});

test('sin ciclo activo no se construye una consulta de matrículas', () => {
  assert.equal(buildClassroomBoardEnrollmentFilter(null), null);
});
