import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { searchTutorsService } from '../src/modules/tutors/tutors.service.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';
import { Tutor } from '../src/models/tutor.model.js';

function buildLeanQuery(value) {
  return {
    select() { return this; },
    populate() { return this; },
    limit() { return this; },
    lean: async () => value,
  };
}

test('searchTutorsService devuelve tutores existentes y excluye personas que son alumnos', async (t) => {
  const standalonePersonId = new mongoose.Types.ObjectId();
  const studentPersonId = new mongoose.Types.ObjectId();
  const relatedStudentId = new mongoose.Types.ObjectId();

  t.mock.method(Person, 'find', () => buildLeanQuery([
    {
      _id: standalonePersonId,
      names: 'Maria',
      lastNames: 'Perez',
      dni: '11112222',
      phone: '999888777',
      gender: 'F',
    },
    {
      _id: studentPersonId,
      names: 'Alumno',
      lastNames: 'YaExiste',
      dni: '33334444',
      phone: '900000000',
      gender: 'M',
    },
  ]));

  t.mock.method(Student, 'find', () => buildLeanQuery([
    { personId: studentPersonId },
    {
      _id: relatedStudentId,
      personId: new mongoose.Types.ObjectId(),
    },
  ]));

  t.mock.method(Tutor, 'find', () => buildLeanQuery([
    {
      tutorPersonId: standalonePersonId,
      studentId: {
        _id: relatedStudentId,
        personId: { names: 'Luis', lastNames: 'Rojas' },
      },
      relationship: 'Madre',
      isPrimary: true,
    },
  ]));

  const result = await searchTutorsService({ q: 'Maria', limit: 10 });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].dni, '11112222');
  assert.equal(result.items[0].linkedStudents.length, 1);
  assert.match(result.items[0].linkedStudents[0].fullName, /Rojas/);
});

test('searchTutorsService retorna vacio cuando no encuentra coincidencias', async (t) => {
  t.mock.method(Person, 'find', () => buildLeanQuery([]));
  t.mock.method(Student, 'find', () => buildLeanQuery([]));
  t.mock.method(Tutor, 'find', () => buildLeanQuery([]));

  const result = await searchTutorsService({ q: 'ZZ', limit: 5 });
  assert.deepEqual(result, { items: [], nextCursor: null });
});
