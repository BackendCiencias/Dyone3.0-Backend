import { asyncHandler } from '../../utils/asyncHandler.js';
import { getSecretaryOverviewService } from './dashboard.service.js';

export const getSecretaryOverview = asyncHandler(async (req, res) => {
  const result = await getSecretaryOverviewService({
    ...(req.validatedQuery || req.query),
    campusScope: req.campusScope,
  });
  res.json(result);
});
