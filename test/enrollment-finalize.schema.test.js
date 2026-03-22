import test from 'node:test';
import assert from 'node:assert/strict';
import { enrollmentFinalizeSchema } from '../src/modules/enrollments/enrollments.schemas.js';

const objectIdA = '507f1f77bcf86cd799439011';
const objectIdB = '507f1f77bcf86cd799439012';
const classroomId = '507f1f77bcf86cd799439013';

function buildValidPayload() {
  return {
    activeCycleId: objectIdA,
    students: [
      {
        localId: 'student-local-1',
        mode: 'new',
        names: 'Luis',
        lastNames: 'Rojas',
        classroomId,
        amounts: {
          admissionFeeAmount: 0,
          admissionFeeApplies: false,
          enrollmentFeeAmount: 100,
          pensionAmount: 250,
        },
      },
    ],
    tutors: [
      {
        localId: 'tutor-local-1',
        mode: 'new',
        names: 'Maria',
        lastNames: 'Rojas',
        relationship: 'Madre',
        includeInContract: true,
        linkedStudentIds: ['student-local-1'],
      },
    ],
    observations: { general: 'ok', address: 'Av. Siempre Viva' },
  };
}

test('enrollmentFinalizeSchema acepta payload V2 valido', () => {
  const parsed = enrollmentFinalizeSchema.parse(buildValidPayload());
  assert.equal(parsed.students.length, 1);
  assert.equal(parsed.tutors.length, 1);
});

test('enrollmentFinalizeSchema rechaza cuando no hay tutor firmante', () => {
  const payload = buildValidPayload();
  payload.tutors[0].includeInContract = false;

  assert.throws(
    () => enrollmentFinalizeSchema.parse(payload),
    /al menos un tutor firmante/i
  );
});

test('enrollmentFinalizeSchema rechaza tutor vinculado a alumno inexistente', () => {
  const payload = buildValidPayload();
  payload.tutors[0].linkedStudentIds = ['student-local-x'];

  assert.throws(
    () => enrollmentFinalizeSchema.parse(payload),
    /alumno inexistente en el draft/i
  );
});

test('enrollmentFinalizeSchema exige existingTutorId para tutor existente', () => {
  const payload = buildValidPayload();
  payload.tutors[0] = {
    ...payload.tutors[0],
    mode: 'existing',
    existingTutorId: undefined,
  };

  assert.throws(
    () => enrollmentFinalizeSchema.parse(payload),
    /existingTutorId es requerido/i
  );
});

test('enrollmentFinalizeSchema rechaza alumnos duplicados por referencia', () => {
  const payload = buildValidPayload();
  payload.students.push({
    localId: 'student-local-1',
    mode: 'new',
    names: 'Ana',
    lastNames: 'Rojas',
    classroomId,
  });

  assert.throws(
    () => enrollmentFinalizeSchema.parse(payload),
    /alumnos duplicados/i
  );
});
