import { asyncHandler } from '../../utils/asyncHandler.js';
import { createChargeService } from './charges.service.js';

export const createCharge = asyncHandler(async (req, res) => {
  const charge = await createChargeService({ ...req.validated, createdByUserId: req.user.id });
  res.status(201).json(charge);
});
