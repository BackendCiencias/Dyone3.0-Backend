import test from 'node:test';
import assert from 'node:assert/strict';
import { toFamilyListItem } from '../src/modules/families/presenters/familyListItem.presenter.js';
import { toIntakeSearchItems } from '../src/modules/enrollments/presenters/intakeSearch.presenter.js';

test('toFamilyListItem preserva address en listado/search de familias', () => {
  const row = toFamilyListItem({
    _id: '507f191e810c19729de860ea',
    address: 'Av. Siempre Viva 742',
    notes: 'Ninguna',
    studentIds: [],
    tutorIds: [],
  });

  assert.equal(row.address, 'Av. Siempre Viva 742');
});

test('toIntakeSearchItems incluye address para resultados FAMILY', () => {
  const items = toIntakeSearchItems({
    families: [{
      familyId: '507f191e810c19729de860ea',
      address: 'Jr. Los Álamos 123',
      primaryTutor: null,
      students: [],
      studentsCount: 0,
    }],
    students: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'FAMILY');
  assert.equal(items[0].address, 'Jr. Los Álamos 123');
});
