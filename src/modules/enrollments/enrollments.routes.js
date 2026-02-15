import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { enrollmentCreateSchema, enrollmentConfirmSchema, enrollmentIdParamsSchema } from './enrollments.schemas.js';
import {
  createEnrollment,
  getEnrollmentById,
  getClassroomCapacity,
  getCampusCapacity,
  confirmEnrollment,
} from './enrollments.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

router.post('/', validate(enrollmentCreateSchema), createEnrollment);
router.post('/:id/confirm', validateRequest({ params: enrollmentIdParamsSchema, body: enrollmentConfirmSchema }), confirmEnrollment);
router.get('/classrooms/:classroomId/capacity', getClassroomCapacity);
router.get('/capacity', getCampusCapacity);
router.get('/:id', getEnrollmentById);

export default router;
