import { asyncHandler } from '../../utils/asyncHandler.js';
import { getAdminOverviewService, getSecretaryOverviewService } from './dashboard.service.js';

export const getSecretaryOverview = asyncHandler(async (req, res) => {
  const result = await getSecretaryOverviewService({
    ...(req.validatedQuery || req.query),
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const getAdminOverview = asyncHandler(async (req, res) => {
  const result = await getAdminOverviewService({
    ...(req.validatedQuery || req.query),
    campusScope: req.campusScope,
  });
  res.json(result);
});
