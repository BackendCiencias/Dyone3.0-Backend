import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeSearch } from '../src/services/search/intake.search.js';
import { Cycle } from '../src/models/cycle.model.js';
import { Student } from '../src/models/student.model.js';
import { Person } from '../src/models/person.model.js';
import { Tutor } from '../src/models/tutor.model.js';
import { Family } from '../src/models/family.model.js';
import { StudentCycle } from '../src/models/studentCycle.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';

function chain(value) {
  return {
    sort() { return this; },
    select() { return this; },
    populate() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

test('intakeSearch retorna items por texto aunque no haya ciclo activo', async (t) => {
  t.mock.method(Cycle, 'findOne', () => chain(null));

  t.mock.method(Student, 'find', (query) => {
    if (query?.$or?.some?.((it) => Object.hasOwn(it, 'familyId'))) {
      return chain([
        {
          _id: 's-unassigned-1',
          personId: { _id: 'p-stu-1', names: 'Mario', lastNames: 'Heredia', dni: '77889911', gender: 'M' },
          internalCode: 'COD_A0001',
          activeStatus: 'ACTIVE',
          familyId: null,
        },
      ]);
    }

    if (query?.personId?.$in) return chain([{ _id: 's-family-1' }]);
    return chain([]);
  });

  t.mock.method(StudentCycle, 'find', () => chain([]));
  t.mock.method(Vacancy, 'find', () => chain([]));

  t.mock.method(Person, 'find', () => chain([{ _id: 'p-tutor-1' }]));
  t.mock.method(Tutor, 'find', (query) => chain(query?.isPrimary ? [{ _id: 't-1' }] : [{ _id: 't-1' }]));

  t.mock.method(Family, 'find', (query) => {
    if (query?.tutorIds || query?.studentIds) return chain([{ _id: 'f-1' }]);

    if (query?._id?.$in) {
      return chain([
        {
          _id: 'f-1',
          studentIds: [{ _id: 's-family-1', personId: { names: 'Lucia', lastNames: 'Heredia', dni: '11223344', gender: 'F' } }],
          tutorIds: [{ isPrimary: true, tutorPersonId: { _id: 'p-tutor-1', names: 'Ana', lastNames: 'Heredia', dni: '12345678', phone: '999' } }],
        },
      ]);
    }

    return chain([]);
  });

  const data = await intakeSearch({ q: 'heredia', campusScope: 'CIENCIAS', limit: 10 });
  assert.ok(data.items.length >= 1);
  assert.equal(data.campusScope, 'CIENCIAS');
});

test('intakeSearch valida q corto', async () => {
  await assert.rejects(
    intakeSearch({ q: 'h', campusScope: 'ALL', limit: 10 }),
    (error) => error?.status === 400
  );
});

test('intakeSearch con campusScope ALL no filtra resultados', async (t) => {
  t.mock.method(Cycle, 'findOne', () => chain(null));
  t.mock.method(Student, 'find', (query) => chain(query?.$or?.some?.((it) => Object.hasOwn(it, 'familyId')) ? [
    {
      _id: 's-unassigned-2',
      personId: { _id: 'p-stu-2', names: 'Jose', lastNames: 'Heredia', dni: '00001111', gender: 'M' },
      internalCode: 'COD_A0002',
      activeStatus: 'ACTIVE',
      familyId: null,
    },
  ] : []));
  t.mock.method(Person, 'find', () => chain([]));
  t.mock.method(Tutor, 'find', () => chain([]));
  t.mock.method(Family, 'find', () => chain([]));
  t.mock.method(StudentCycle, 'find', () => chain([]));
  t.mock.method(Vacancy, 'find', () => chain([]));

  const data = await intakeSearch({ q: 'heredia', campusScope: 'ALL', limit: 10 });
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].type, 'STUDENT');
});
