import { asyncHandler } from '../../utils/asyncHandler.js';
import { createPaymentService, getDebtorsService } from './payments.service.js';

export const createPayment = asyncHandler(async (req, res) => {
  const { familyId, campusId, paidAt, method, totalAmount, allocations, notes } = req.validated;
  const payment = await createPaymentService({
    familyId,
    campusId,
    paidAt,
    method,
    totalAmount,
    allocations,
    notes,
    createdByUserId: req.user.id,
  });
  res.status(201).json(payment);
});

export const getDebtors = asyncHandler(async (req, res) => {
  const { campusId, cycleId, conceptId, q } = req.query;
  const charges = await getDebtorsService({ campusId, cycleId, conceptId, q });
  res.json(charges);
});