import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { BillingConcept } from '../src/models/billingConcept.model.js';
import { Charge } from '../src/models/charge.model.js';
import { chargeCreateSchema } from '../src/modules/charges/charges.schemas.js';
import { billingConceptCreateSchema } from '../src/modules/admin/admin.schemas.js';

test('billing concept schema exige code y lo normaliza', () => {
  const parsed = billingConceptCreateSchema.parse({ code: ' mat_nueva ', name: 'Matrícula' });
  assert.equal(parsed.code, 'MAT_NUEVA');

  const err = new BillingConcept({ name: 'Solo nombre' }).validateSync();
  assert.ok(err?.errors?.code);
});

test('charge schema exige campusId', () => {
  const parsed = chargeCreateSchema.parse({
    studentId: '507f1f77bcf86cd799439011',
    cycleId: '507f1f77bcf86cd799439012',
    campusId: '507f1f77bcf86cd799439013',
    conceptName: 'Pensión',
    description: 'Marzo',
    amount: 100,
  });
  assert.equal(parsed.campusId, '507f1f77bcf86cd799439013');

  assert.throws(() => chargeCreateSchema.parse({
    studentId: '507f1f77bcf86cd799439011',
    cycleId: '507f1f77bcf86cd799439012',
    conceptName: 'Pensión',
    description: 'Marzo',
    amount: 100,
  }));
});

test('modelo Charge marca campusId como requerido', () => {
  const err = new Charge({
    studentId: new mongoose.Types.ObjectId(),
    cycleId: new mongoose.Types.ObjectId(),
    conceptId: new mongoose.Types.ObjectId(),
    description: 'Marzo',
    totalAmount: mongoose.Types.Decimal128.fromString('100'),
    outstandingAmount: mongoose.Types.Decimal128.fromString('100'),
  }).validateSync();

  assert.ok(err?.errors?.campusId);
});

test('charge schema acepta una descripción específica compatible con cargos existentes', () => {
  const basePayload = {
    studentId: '507f1f77bcf86cd799439011',
    billingConceptId: '507f1f77bcf86cd799439012',
    amount: 75,
  };

  const existingCharge = chargeCreateSchema.parse(basePayload);
  assert.equal(existingCharge.customDescription, undefined);

  const customCharge = chargeCreateSchema.parse({
    ...basePayload,
    customDescription: '  Paseo de promoción  ',
  });
  assert.equal(customCharge.customDescription, 'Paseo de promoción');
});
