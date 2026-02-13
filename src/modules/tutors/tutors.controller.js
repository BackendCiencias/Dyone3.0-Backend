import { asyncHandler } from '../../utils/asyncHandler.js';
import { upsertTutorService } from './tutors.service.js';

export const upsertTutor = asyncHandler(async (req, res) => {
  const tutor = await upsertTutorService(req.validated);
  res.status(201).json(tutor);
});
