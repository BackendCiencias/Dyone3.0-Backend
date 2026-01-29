import { asyncHandler } from '../../utils/asyncHandler.js';
import { createEnrollmentService, getEnrollmentService } from './enrollments.service.js';

export const createEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await createEnrollmentService(req.validated, req.user.id);
  res.status(201).json(enrollment);
});

export const getEnrollmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const enrollment = await getEnrollmentService(id);
  res.json(enrollment);
});