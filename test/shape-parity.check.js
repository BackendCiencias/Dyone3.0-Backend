import assert from 'node:assert/strict';
import { toFamilyListItem } from '../src/modules/families/presenters/familyListItem.presenter.js';
import { toUnassignedStudentListItem } from '../src/modules/students/presenters/unassignedStudentListItem.presenter.js';

function keysOf(obj) {
  return Object.keys(obj).sort();
}

const familyListSource = {
  _id: '1',
  notes: null,
  students: [{ _id: 's1', currentCampusCode: 'CIENCIAS' }],
  studentsCount: 1,
  tutorsCount: 1,
  primaryTutor: { names: 'Ana', lastNames: 'Pérez', dni: '123', phone: '999' },
  updatedAt: new Date().toISOString(),
};

const familySearchSource = {
  familyId: '2',
  students: [{ _id: 's2', currentCampusCode: null }],
  studentsCount: 1,
  tutorsCount: 1,
  primaryTutor: { names: 'Luis', lastNames: 'Rojas', dni: '456', phone: null },
};

const familyListItem = toFamilyListItem(familyListSource);
const familySearchItem = toFamilyListItem(familySearchSource);
assert.deepEqual(keysOf(familyListItem), keysOf(familySearchItem));

const unassignedListSource = {
  _id: 's1',
  internalCode: 'COD_A0001',
  personId: { _id: 'p1', names: 'Ana', lastNames: 'Pérez', dni: '123', gender: 'F' },
  activeStatus: 'ACTIVE',
  campusCode: 'CIENCIAS',
};

const unassignedSearchSource = {
  studentId: 's2',
  internalCode: 'COD_A0002',
  person: { personId: 'p2', names: 'Luis', lastNames: 'Rojas', dni: '456', gender: 'M' },
  activeStatus: 'ACTIVE',
  campusCode: null,
};

const unassignedListItem = toUnassignedStudentListItem(unassignedListSource);
const unassignedSearchItem = toUnassignedStudentListItem(unassignedSearchSource);
assert.deepEqual(keysOf(unassignedListItem), keysOf(unassignedSearchItem));
assert.deepEqual(keysOf(unassignedListItem.personId), keysOf(unassignedSearchItem.personId));

console.log('Shape parity presenters: OK');
