import { asyncHandler } from '../../utils/asyncHandler.js';
import { createPaymentService, getDebtorsService } from './payments.service.js';

export const createPayment = asyncHandler(async (req, res) => {
  const { familyId, campusId, paidAt, method, voucherNumber, allocations, notes } = req.validated;
  const result = await createPaymentService({
    familyId,
    campusId,
    paidAt,
    method,
    voucherNumber,
    allocations,
    notes,
    createdByUserId: req.user.id,
  });
  res.status(201).json(result);
});

export const getDebtors = asyncHandler(async (req, res) => {
  const { cycleId, conceptId, q } = req.query;
  const charges = await getDebtorsService({ cycleId, conceptId, q });
  res.json(charges);
});