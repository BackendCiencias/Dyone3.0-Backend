import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  buildAdmissionFeeCharge,
  buildEnrollmentFeeCharge,
  buildTuitionCharges,
} from '../src/modules/enrollments/services/enrollmentConfirmation.helpers.js';

test('buildAdmissionFeeCharge incluye concept y respeta dueDate recibido', () => {
  const dueDate = new Date('2026-03-31T00:00:00.000Z');

  const charge = buildAdmissionFeeCharge({
    enrollmentStudent: {
      studentId: new mongoose.Types.ObjectId(),
      admissionFee: { applies: true, isExempt: false, amount: 150, reason: 'Ingreso' },
    },
    student: { previousCampus: 'EXTERNO' },
    conceptId: new mongoose.Types.ObjectId(),
    cycleId: new mongoose.Types.ObjectId(),
    campusId: new mongoose.Types.ObjectId(),
    dueDate,
  });

  assert.equal(charge.concept, 'ADMISSION');
  assert.equal(charge.monthIndex, null);
  assert.equal(charge.dueDate, dueDate);
});

test('buildEnrollmentFeeCharge incluye concept y respeta dueDate recibido', () => {
  const dueDate = new Date('2026-04-05T00:00:00.000Z');

  const charge = buildEnrollmentFeeCharge({
    enrollmentStudent: {
      studentId: new mongoose.Types.ObjectId(),
      enrollmentFee: { isExempt: false, amount: 250, reason: 'Matricula' },
    },
    conceptId: new mongoose.Types.ObjectId(),
    cycleId: new mongoose.Types.ObjectId(),
    campusId: new mongoose.Types.ObjectId(),
    dueDate,
  });

  assert.equal(charge.concept, 'ENROLLMENT');
  assert.equal(charge.monthIndex, null);
  assert.equal(charge.dueDate, dueDate);
});

test('buildTuitionCharges asigna concept, monthIndex y dueDate por mes', () => {
  const dueDateMonth0 = new Date('2026-03-10T00:00:00.000Z');
  const dueDateMonth1 = new Date('2026-04-10T00:00:00.000Z');

  const charges = buildTuitionCharges({
    enrollmentStudent: {
      studentId: new mongoose.Types.ObjectId(),
      pensionMonthlyAmounts: [300, 320, -1],
    },
    conceptId: new mongoose.Types.ObjectId(),
    cycleId: new mongoose.Types.ObjectId(),
    campusId: new mongoose.Types.ObjectId(),
    dueDatesByMonth: new Map([
      [0, dueDateMonth0],
      [1, dueDateMonth1],
    ]),
  });

  assert.equal(charges.length, 2);
  assert.equal(charges[0].concept, 'TUITION');
  assert.equal(charges[0].monthIndex, 0);
  assert.equal(charges[0].dueDate, dueDateMonth0);
  assert.equal(charges[1].monthIndex, 1);
  assert.equal(charges[1].dueDate, dueDateMonth1);
});
