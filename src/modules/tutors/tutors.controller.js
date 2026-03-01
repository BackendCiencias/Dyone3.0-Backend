import { asyncHandler } from '../../utils/asyncHandler.js';
import { upsertTutorService, updateTutorService, deleteTutorService } from './tutors.service.js';

export const upsertTutor = asyncHandler(async (req, res) => {
  const tutor = await upsertTutorService(req.validated);
  res.status(201).json(tutor);
});

export const updateTutor = asyncHandler(async (req, res) => {
  const tutor = await updateTutorService(req.validatedParams.id, req.validated);
  res.json(tutor);
});

export const deleteTutor = asyncHandler(async (req, res) => {
  await deleteTutorService(req.validatedParams.id);
  res.status(204).send();
});
