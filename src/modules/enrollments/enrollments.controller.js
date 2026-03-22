import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getEnrollmentService,
  getClassroomCapacityService,
  getCampusCapacityService,
  confirmEnrollmentService,
  finalizeEnrollmentService,
  listEnrollmentsService,
} from './enrollments.service.js';

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


export const confirmEnrollment = asyncHandler(async (req, res) => {
  const data = await confirmEnrollmentService({
    enrollmentId: req.validatedParams.id,
    payload: req.validated,
    userId: req.user.id,
  });

  res.json(data);
});

export const finalizeEnrollment = asyncHandler(async (req, res) => {
  const data = await finalizeEnrollmentService(req.validated, req.user.id);
  res.status(201).json(data);
});

export const listEnrollments = asyncHandler(async (req, res) => {
  const data = await listEnrollmentsService({ ...(req.validatedQuery || req.query), campusScope: req.campusScope });
  res.json(data);
});
