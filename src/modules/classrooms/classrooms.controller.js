import { asyncHandler } from '../../utils/asyncHandler.js';
import { listClassroomOptions } from './classrooms.service.js';

export const getClassroomOptions = asyncHandler(async (req, res) => {
  const data = await listClassroomOptions(req.validatedQuery);
  res.json(data);
});
