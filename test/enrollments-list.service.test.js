import test from 'node:test';
import assert from 'node:assert/strict';
import { listEnrollmentsService } from '../src/modules/enrollments/enrollments.service.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';

test('listEnrollmentsService filtra por q usando Person sin lanzar error', async (t) => {
  t.mock.method(Person, 'find', () => ({
    select() { return this; },
    lean: async () => [{ _id: 'person-1' }],
  }));

  t.mock.method(Student, 'find', () => ({
    select() { return this; },
    lean: async () => [],
  }));

  const result = await listEnrollmentsService({ q: '12345678', campusScope: [] });

  assert.deepEqual(result, { items: [], nextCursor: null });
});
