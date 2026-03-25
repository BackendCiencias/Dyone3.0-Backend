import { asyncHandler } from '../../utils/asyncHandler.js';
import { getClassroomBoardService, listClassroomOptions } from './classrooms.service.js';

export const getClassroomOptions = asyncHandler(async (req, res) => {
  const data = await listClassroomOptions(req.validatedQuery);
  res.json(data);
});

export const getClassroomBoard = asyncHandler(async (req, res) => {
  const data = await getClassroomBoardService(req.validatedQuery);
  res.json(data);
});
