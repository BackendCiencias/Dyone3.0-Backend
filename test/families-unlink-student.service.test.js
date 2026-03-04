import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { unlinkStudentFromFamilyService } from '../src/modules/families/families.service.js';
import { Family } from '../src/models/family.model.js';
import { Student } from '../src/models/student.model.js';
import { Tutor } from '../src/models/tutor.model.js';

const familyId = '64b8f4e4b6f57f1a6a9c1111';
const studentId = '64b8f4e4b6f57f1a6a9c2222';

function setupTransactionMock(t) {
  const fakeSession = {
    async withTransaction(work) {
      await work();
    },
    async endSession() {},
  };
  t.mock.method(mongoose, 'startSession', async () => fakeSession);
}

function buildSessionResult(value) {
  return {
    session: async () => value,
  };
}

test('unlink ok devuelve payload base con newFamilyId null', async (t) => {
  setupTransactionMock(t);

  let findByIdCall = 0;
  t.mock.method(Family, 'findById', () => {
    findByIdCall += 1;
    if (findByIdCall === 1) return buildSessionResult({ _id: familyId, studentIds: [studentId], tutorIds: ['t1'] });
    if (findByIdCall === 2) return buildSessionResult({ _id: familyId, studentIds: [], tutorIds: [] });

    return {
      populate() { return this; },
      lean: async () => ({ _id: familyId, notes: null, studentIds: [], tutorIds: [] }),
    };
  });

  t.mock.method(Student, 'findById', () => buildSessionResult({ _id: studentId, familyId }));
  t.mock.method(Family, 'updateOne', async () => ({ acknowledged: true }));
  t.mock.method(Student, 'updateOne', async () => ({ acknowledged: true }));

  t.mock.method(Tutor, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [{ _id: 't1' }],
  }));
  t.mock.method(Tutor, 'deleteMany', async () => ({ deletedCount: 1 }));
  t.mock.method(Tutor, 'findOne', () => ({ session() { return this; }, lean: async () => null }));
  t.mock.method(Tutor, 'updateMany', async () => ({ acknowledged: true }));
  t.mock.method(Tutor, 'updateOne', async () => ({ acknowledged: true }));

  const result = await unlinkStudentFromFamilyService(familyId, studentId);

  assert.equal(result.ok, true);
  assert.equal(result.familyId, familyId);
  assert.equal(result.studentId, studentId);
  assert.equal(result.newFamilyId, null);
});

test('unlink falla cuando student no pertenece a la familia', async (t) => {
  setupTransactionMock(t);

  t.mock.method(Family, 'findById', () => buildSessionResult({ _id: familyId, studentIds: [], tutorIds: [] }));
  t.mock.method(Student, 'findById', () => buildSessionResult({ _id: studentId, familyId }));

  await assert.rejects(
    unlinkStudentFromFamilyService(familyId, studentId),
    (error) => error?.status === 409 && /does not belong/i.test(error?.message)
  );
});

test('unlink elimina relaciones tutor-student con deleteMany cuando existen', async (t) => {
  setupTransactionMock(t);

  let findByIdCall = 0;
  t.mock.method(Family, 'findById', () => {
    findByIdCall += 1;
    if (findByIdCall <= 2) return buildSessionResult({ _id: familyId, studentIds: [studentId], tutorIds: [] });
    return { populate() { return this; }, lean: async () => ({ _id: familyId, notes: null, studentIds: [], tutorIds: [] }) };
  });

  t.mock.method(Student, 'findById', () => buildSessionResult({ _id: studentId, familyId }));
  t.mock.method(Family, 'updateOne', async () => ({ acknowledged: true }));
  t.mock.method(Student, 'updateOne', async () => ({ acknowledged: true }));

  t.mock.method(Tutor, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [{ _id: 't1' }, { _id: 't2' }],
  }));

  let deletedCountArg = 0;
  t.mock.method(Tutor, 'deleteMany', async (query) => {
    deletedCountArg = query?._id?.$in?.length || 0;
    return { deletedCount: 2 };
  });
  t.mock.method(Tutor, 'findOne', () => ({ session() { return this; }, lean: async () => null }));
  t.mock.method(Tutor, 'updateMany', async () => ({ acknowledged: true }));
  t.mock.method(Tutor, 'updateOne', async () => ({ acknowledged: true }));

  await unlinkStudentFromFamilyService(familyId, studentId);
  assert.equal(deletedCountArg, 2);
});

test('unlink deja student.familyId en null', async (t) => {
  setupTransactionMock(t);

  let findByIdCall = 0;
  t.mock.method(Family, 'findById', () => {
    findByIdCall += 1;
    if (findByIdCall === 1) return buildSessionResult({ _id: familyId, studentIds: [studentId], tutorIds: [] });
    return { populate() { return this; }, lean: async () => ({ _id: familyId, notes: null, studentIds: [], tutorIds: [] }) };
  });

  t.mock.method(Student, 'findById', () => buildSessionResult({ _id: studentId, familyId }));
  t.mock.method(Family, 'updateOne', async () => ({ acknowledged: true }));

  let updatePayload = null;
  t.mock.method(Student, 'updateOne', async (_query, payload) => {
    updatePayload = payload;
    return { acknowledged: true };
  });

  t.mock.method(Tutor, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [],
  }));
  t.mock.method(Tutor, 'deleteMany', async () => ({ deletedCount: 0 }));
  t.mock.method(Tutor, 'findOne', () => ({ session() { return this; }, lean: async () => null }));
  t.mock.method(Tutor, 'updateMany', async () => ({ acknowledged: true }));
  t.mock.method(Tutor, 'updateOne', async () => ({ acknowledged: true }));

  await unlinkStudentFromFamilyService(familyId, studentId);
  assert.deepEqual(updatePayload, { $set: { familyId: null } });
});
