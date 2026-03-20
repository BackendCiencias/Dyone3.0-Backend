import { asyncHandler } from '../../utils/asyncHandler.js';
import { createChargeService, deleteChargeService, updateChargeService } from './charges.service.js';

export const createCharge = asyncHandler(async (req, res) => {
  const charge = await createChargeService({ ...req.validated, createdByUserId: req.user.id });
  res.status(201).json(charge);
});

export const updateCharge = asyncHandler(async (req, res) => {
  const charge = await updateChargeService(req.validatedParams.id, req.validated, req.user.id);
  res.json(charge);
});

export const deleteCharge = asyncHandler(async (req, res) => {
  const payload = await deleteChargeService(req.validatedParams.id, req.user.id);
  res.json(payload);
});
