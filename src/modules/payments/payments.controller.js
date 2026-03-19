import { asyncHandler } from '../../utils/asyncHandler.js';
import { createPaymentService, getDebtorsSearchService, getDebtorsService } from './payments.service.js';

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
  const { cycleId, conceptId, campus, campusId, onlyOverdue, limit, page } = req.validatedQuery || req.query;
  const result = await getDebtorsService({
    cycleId,
    conceptId,
    campus: campus || campusId,
    campusScope: req.campusScope,
    onlyOverdue,
    limit,
    page,
  });
  res.json(result);
});

export const searchDebtors = asyncHandler(async (req, res) => {
  const { q, cycleId, campus, campusId, limit } = req.validatedQuery || req.query;
  const result = await getDebtorsSearchService({
    q,
    cycleId,
    campus: campus || campusId,
    campusScope: req.campusScope,
    limit,
  });
  res.json(result);
});
