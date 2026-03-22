import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { familyCreateSchema } from '../src/modules/families/families.schemas.js';
import { createStudentService, updateStudentCycleStatusService } from '../src/modules/students/students.service.js';
import { linkStudentFamilyService } from '../src/modules/families/families.service.js';
import { createEnrollmentService } from '../src/modules/enrollments/enrollments.service.js';
import { Person } from '../src/models/person.model.js';
import { Student } from '../src/models/student.model.js';
import { Family } from '../src/models/family.model.js';
import { Tutor } from '../src/models/tutor.model.js';
import { Counter } from '../src/models/counter.model.js';
import { Classroom } from '../src/models/classroom.model.js';
import { Cycle } from '../src/models/cycle.model.js';
import { StudentCycle } from '../src/models/studentCycle.model.js';
import { Vacancy } from '../src/models/vacancy.model.js';
import { Campus } from '../src/models/campus.model.js';
import { Enrollment } from '../src/models/enrollment.model.js';
import { EnrollmentStudent } from '../src/models/enrollmentStudent.model.js';
import { Charge } from '../src/models/charge.model.js';
import { ContractSnapshot } from '../src/models/contractSnapshot.model.js';
import { BillingConcept } from '../src/models/billingConcept.model.js';
import { BillingSchedule } from '../src/models/billingSchedule.model.js';
import * as auditModule from '../src/shared/audit.service.js';

function buildSession() {
  return {
    startTransaction() {},
    async commitTransaction() {},
    async abortTransaction() {},
    async endSession() {},
    async withTransaction(work) {
      return work();
    },
  };
}

function setupStartSessionMock(t) {
  const session = buildSession();
  t.mock.method(mongoose, 'startSession', async () => session);
  return session;
}

function buildSessionResult(value) {
  return {
    session: async () => value,
  };
}

function buildLeanQuery(value) {
  return {
    select() { return this; },
    populate() { return this; },
    sort() { return this; },
    limit() { return this; },
    lean: async () => value,
    session: async () => value,
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}

test('familyCreateSchema no permite crear familias sin alumno', () => {
  assert.throws(
    () => familyCreateSchema.parse({
      tutors: [{ names: 'Ana', lastNames: 'Perez', dni: '12345678', gender: 'F' }],
      students: [],
    }),
    /al menos un estudiante/i
  );
});

test('flujo familia existente + alumno nuevo crea alumno en ABSENT con vacante', async (t) => {
  setupStartSessionMock(t);

  const familyId = new mongoose.Types.ObjectId();
  const classroomId = new mongoose.Types.ObjectId();
  const campusId = new mongoose.Types.ObjectId();
  const cycleId = new mongoose.Types.ObjectId();
  const personId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();

  t.mock.method(Person, 'findOne', () => buildSessionResult(null));
  t.mock.method(Person.prototype, 'save', async function save() {
    this._id = personId;
    return this;
  });
  let familyFindByIdCall = 0;
  t.mock.method(Family, 'findById', () => {
    familyFindByIdCall += 1;
    if (familyFindByIdCall === 1) return buildSessionResult({ _id: familyId });
    return buildPopulateQuery({ _id: familyId, studentIds: [{ _id: studentId }], tutorIds: [] });
  });
  t.mock.method(Student, 'findOne', () => buildSessionResult(null));
  t.mock.method(Counter, 'findOneAndUpdate', async () => ({ seq: 1 }));
  t.mock.method(Classroom, 'findById', () => buildSessionResult({ _id: classroomId, campusId }));
  t.mock.method(Cycle, 'findOne', () => ({
    sort() { return this; },
    session: async () => ({ _id: cycleId }),
  }));

  let createdStudentPayload = null;
  t.mock.method(Student, 'create', async (docs) => {
    createdStudentPayload = docs[0];
    return [{ ...docs[0], _id: studentId }];
  });

  let familyUpdatePayload = null;
  t.mock.method(Family, 'updateOne', async (_query, payload) => {
    familyUpdatePayload = payload;
    return { acknowledged: true };
  });

  let studentCyclePayload = null;
  t.mock.method(StudentCycle, 'updateOne', async (_query, payload) => {
    studentCyclePayload = payload;
    return { acknowledged: true };
  });

  let vacancyPayload = null;
  t.mock.method(Vacancy, 'updateOne', async (_query, payload) => {
    vacancyPayload = payload;
    return { acknowledged: true };
  });

  const hydratedStudent = { _id: studentId, personId: { _id: personId }, familyId: { _id: familyId } };
  t.mock.method(Student, 'findById', () => buildPopulateQuery(hydratedStudent));

  const result = await createStudentService({
    person: { names: 'Luis', lastNames: 'Rojas', dni: '12345678', gender: 'M' },
    familyId: String(familyId),
    classroomId: String(classroomId),
  });

  assert.equal(String(createdStudentPayload.familyId), String(familyId));
  assert.deepEqual(familyUpdatePayload, { $addToSet: { studentIds: studentId } });
  assert.equal(studentCyclePayload.$setOnInsert.status, 'ABSENT');
  assert.equal(String(vacancyPayload.$set.classroomId), String(classroomId));
  assert.equal(result.familyId, String(familyId));
});

test('flujo alumno nuevo + familia nueva crea familia, tutor principal y reserva inicial', async (t) => {
  setupStartSessionMock(t);

  const classroomId = new mongoose.Types.ObjectId();
  const campusId = new mongoose.Types.ObjectId();
  const cycleId = new mongoose.Types.ObjectId();
  const familyId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const personStudentId = new mongoose.Types.ObjectId();
  const personTutorId = new mongoose.Types.ObjectId();
  const tutorId = new mongoose.Types.ObjectId();

  let personFindCount = 0;
  t.mock.method(Person, 'findOne', () => ({
    session: async () => {
      personFindCount += 1;
      return null;
    },
  }));

  t.mock.method(Person.prototype, 'save', async function save() {
    if (!this._id) {
      this._id = personFindCount === 1 ? personStudentId : personTutorId;
    }
    return this;
  });

  t.mock.method(Classroom, 'findById', () => buildSessionResult({ _id: classroomId, campusId }));
  t.mock.method(Cycle, 'findOne', () => ({
    sort() { return this; },
    session: async () => ({ _id: cycleId }),
  }));

  t.mock.method(Family, 'create', async () => [{ _id: familyId, tutorIds: [], studentIds: [] }]);
  t.mock.method(Student, 'findOne', () => buildSessionResult(null));
  t.mock.method(Counter, 'findOneAndUpdate', async () => ({ seq: 2 }));
  t.mock.method(Student, 'create', async (docs) => [{ ...docs[0], _id: studentId }]);
  t.mock.method(StudentCycle, 'updateOne', async () => ({ acknowledged: true }));
  t.mock.method(Vacancy, 'updateOne', async () => ({ acknowledged: true }));

  let familyUpdateCalls = [];
  t.mock.method(Family, 'updateOne', async (_query, payload) => {
    familyUpdateCalls.push(payload);
    return { acknowledged: true };
  });

  t.mock.method(Tutor, 'findOneAndUpdate', async () => ({ _id: tutorId }));

  const hydratedStudent = { _id: studentId, personId: { _id: personStudentId }, familyId: { _id: familyId } };
  t.mock.method(Student, 'findById', () => buildPopulateQuery(hydratedStudent));
  t.mock.method(Family, 'findById', () => buildPopulateQuery({ _id: familyId, studentIds: [{ _id: studentId }], tutorIds: [{ _id: tutorId }] }));

  const result = await createStudentService(
    {
      person: { names: 'Lucia', lastNames: 'Vega', dni: '87654321', gender: 'F' },
      classroomId: String(classroomId),
    },
    {
      address: 'Av. Central',
      primaryTutor: {
        person: { names: 'Maria', lastNames: 'Vega', dni: '11112222', gender: 'F', phone: '999999999' },
        relationship: 'Madre',
        livesWithStudent: true,
      },
    }
  );

  assert.equal(result.familyId, String(familyId));
  assert.equal(result.studentId, String(studentId));
  assert.equal(result.tutorIds.length, 1);
  assert.equal(familyUpdateCalls.length >= 2, true);
});

test('flujo alumno existente sin familia puede vincularse a familia existente y copiar tutores', async (t) => {
  setupStartSessionMock(t);

  const studentId = new mongoose.Types.ObjectId();
  const familyId = new mongoose.Types.ObjectId();
  const referenceStudentId = new mongoose.Types.ObjectId();
  const tutorPersonId = new mongoose.Types.ObjectId();
  const copiedTutorId = new mongoose.Types.ObjectId();

  t.mock.method(Student, 'findById', () => buildSessionResult({ _id: studentId, familyId: null }));
  t.mock.method(Family, 'findById', () => buildSessionResult({ _id: familyId, studentIds: [referenceStudentId], tutorIds: [] }));
  t.mock.method(Student, 'updateOne', async () => ({ acknowledged: true }));

  const familyUpdateCalls = [];
  t.mock.method(Family, 'updateOne', async (_query, payload) => {
    familyUpdateCalls.push(payload);
    return { acknowledged: true };
  });

  let tutorFindCall = 0;
  t.mock.method(Tutor, 'find', () => ({
    session: async () => {
      tutorFindCall += 1;
      return tutorFindCall === 1
        ? [{
            tutorPersonId,
            relationship: 'Madre',
            isPrimary: true,
            livesWithStudent: true,
            notes: 'ref',
          }]
        : [];
    },
  }));

  t.mock.method(Tutor, 'findOneAndUpdate', async () => ({
    value: { _id: copiedTutorId },
    lastErrorObject: { upserted: copiedTutorId },
  }));

  const result = await linkStudentFamilyService({
    studentId: String(studentId),
    familyId: String(familyId),
    requestId: 'test-flow',
  });

  assert.equal(result.ok, true);
  assert.equal(result.copiedTutorsCount, 1);
  assert.equal(familyUpdateCalls.length, 2);
});

test('flujo alumno existente + familia existente + contrato confirma matricula y sincroniza entidades', async (t) => {
  setupStartSessionMock(t);

  const familyId = new mongoose.Types.ObjectId();
  const campusId = new mongoose.Types.ObjectId();
  const cycleId = new mongoose.Types.ObjectId();
  const classroomId = new mongoose.Types.ObjectId();
  const studentId = new mongoose.Types.ObjectId();
  const enrollmentId = new mongoose.Types.ObjectId();
  const enrollmentStudentId = new mongoose.Types.ObjectId();

  t.mock.method(Family, 'findById', () => buildSessionResult({ _id: familyId }));
  t.mock.method(Campus, 'findById', () => buildSessionResult({ _id: campusId }));
  t.mock.method(Cycle, 'findById', () => buildSessionResult({ _id: cycleId }));
  t.mock.method(Student, 'find', () => ({
    populate() { return this; },
    select() { return this; },
    session: async () => [{
      _id: studentId,
      familyId,
      previousCampus: 'EXTERNO',
      internalCode: 'COD_A0001',
      personId: { names: 'Juan', lastNames: 'Perez' },
    }],
  }));
  t.mock.method(Classroom, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [{ _id: classroomId, displayName: '1A', campusId, cycleId, capacity: 30 }],
  }));
  t.mock.method(EnrollmentStudent, 'find', () => ({
    populate() { return this; },
    session: async () => [],
  }));

  const enrollmentDoc = {
    _id: enrollmentId,
    familyId,
    campusId,
    cycleId,
    status: 'CONFIRMED',
    notes: 'Contrato 2026',
    studentIds: [],
    enrollmentStudents: [],
    async save() { return this; },
  };
  t.mock.method(Enrollment, 'create', async () => [enrollmentDoc]);

  t.mock.method(BillingConcept, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [
      { _id: new mongoose.Types.ObjectId(), code: 'ADMISSION_FEE' },
      { _id: new mongoose.Types.ObjectId(), code: 'ENROLLMENT_FEE' },
      { _id: new mongoose.Types.ObjectId(), code: 'TUITION' },
    ],
  }));
  t.mock.method(BillingSchedule, 'find', () => ({
    session: async () => ([
      { conceptCode: 'ADMISSION_FEE', dueDate: new Date('2026-03-01') },
      { conceptCode: 'ENROLLMENT_FEE', dueDate: new Date('2026-03-01') },
      { conceptCode: 'TUITION', monthIndex: 0, dueDate: new Date('2026-03-10') },
      { conceptCode: 'TUITION', monthIndex: 1, dueDate: new Date('2026-04-10') },
    ]),
  }));

  t.mock.method(EnrollmentStudent.prototype, 'save', async function save() {
    if (!this._id) this._id = enrollmentStudentId;
    return this;
  });

  t.mock.method(Charge, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [],
  }));

  let insertedCharges = [];
  t.mock.method(Charge, 'insertMany', async (docs) => {
    insertedCharges = docs;
    return docs;
  });

  t.mock.method(StudentCycle, 'findOneAndUpdate', async () => ({ acknowledged: true }));
  let vacancyUpdateCount = 0;
  t.mock.method(Vacancy, 'updateOne', async () => {
    vacancyUpdateCount += 1;
    return { acknowledged: true };
  });
  t.mock.method(Vacancy, 'find', () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [],
  }));
  t.mock.method(Vacancy, 'countDocuments', () => ({
    session: async () => 0,
  }));

  let snapshotSaved = false;
  t.mock.method(ContractSnapshot.prototype, 'save', async function save() {
    snapshotSaved = true;
    return this;
  });

  t.mock.method(auditModule, 'registerAuditLog', async () => ({ ok: true }));
  t.mock.method(Enrollment, 'findById', () => buildPopulateQuery({ _id: enrollmentId, enrollmentStudents: [] }));

  const result = await createEnrollmentService({
    familyId: String(familyId),
    campusId: String(campusId),
    cycleId: String(cycleId),
    notes: 'Contrato 2026',
    enrollmentStudents: [{
      studentId: String(studentId),
      classroomId: String(classroomId),
      admissionFee: { applies: true, isExempt: false, amount: 100, reason: '' },
      enrollmentFee: { isExempt: false, amount: 200, reason: '' },
      pensionMonthlyAmounts: [300, 320, -1, -1, -1, -1, -1, -1, -1, -1],
      previousSchoolType: 'OTHER',
    }],
  }, 'user-1');

  assert.equal(snapshotSaved, true);
  assert.equal(vacancyUpdateCount, 1);
  assert.equal(insertedCharges.length, 4);
  assert.ok(result);
});

test('flujo traslado cambia a TRANSFERRED y libera vacante', async (t) => {
  const studentId = new mongoose.Types.ObjectId();
  const cycleId = new mongoose.Types.ObjectId();
  const campusId = new mongoose.Types.ObjectId();

  t.mock.method(Student, 'findById', () => ({ lean: async () => ({ _id: studentId }) }));
  t.mock.method(Cycle, 'findById', () => ({ lean: async () => ({ _id: cycleId }) }));
  t.mock.method(Charge, 'find', () => ({
    select() { return this; },
    lean: async () => [],
  }));
  t.mock.method(StudentCycle, 'findOne', () => ({ lean: async () => ({ _id: 'sc1', studentId, cycleId, campusId, notes: null }) }));
  t.mock.method(Vacancy, 'findOne', () => ({
    populate() { return this; },
    lean: async () => ({ classroomId: { campusId } }),
  }));

  let deletedVacancyQuery = null;
  t.mock.method(Vacancy, 'deleteOne', async (query) => {
    deletedVacancyQuery = query;
    return { acknowledged: true };
  });

  t.mock.method(StudentCycle, 'updateOne', async () => ({ acknowledged: true }));
  t.mock.method(auditModule, 'registerAuditLog', async () => ({ ok: true }));

  const result = await updateStudentCycleStatusService(
    String(studentId),
    { cycleId: String(cycleId), status: 'TRANSFERRED', reason: 'Se traslada fuera de la institucion' },
    'user-1'
  );

  assert.equal(result.status, 'TRANSFERRED');
  assert.deepEqual(deletedVacancyQuery, { studentId: String(studentId), cycleId: String(cycleId) });
});

function buildPopulateQuery(value) {
  return {
    populate() { return this; },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
}
