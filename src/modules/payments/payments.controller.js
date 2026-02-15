import { asyncHandler } from '../../utils/asyncHandler.js';
import { createPaymentService, getDebtorsService } from './payments.service.js';

export const createPayment = asyncHandler(async (req, res) => {
  const result = await createPaymentService({
    ...req.validated,
    notes: req.validated.notes || req.validated.note,
    idempotencyKey: req.validated.idempotencyKey || req.headers['idempotency-key'],
    createdByUserId: req.user.id,
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
});

export const getDebtors = asyncHandler(async (req, res) => {
  const { cycleId, conceptId, q, campus, campusId } = req.query;
  const charges = await getDebtorsService({ cycleId, conceptId, q, campus: campus || campusId, campusScope: req.campusScope });
  res.json(charges);
});
