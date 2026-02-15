import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createEnrollmentService,
  getEnrollmentService,
  getClassroomCapacityService,
  getCampusCapacityService,
} from './enrollments.service.js';

export const createEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await createEnrollmentService(req.validated, req.user.id);
  res.status(201).json(enrollment);
});

export const getEnrollmentById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const enrollment = await getEnrollmentService(id);
  res.json(enrollment);
});

export const getClassroomCapacity = asyncHandler(async (req, res) => {
  const data = await getClassroomCapacityService({
    classroomId: req.params.classroomId,
    cycleId: req.query.cycleId,
  });

  res.json(data);
});

export const getCampusCapacity = asyncHandler(async (req, res) => {
  const data = await getCampusCapacityService({
    campusId: req.query.campusId,
    cycleId: req.query.cycleId,
  });

  res.json({ items: data });
});
