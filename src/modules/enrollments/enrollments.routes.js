import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { enrollmentCreateSchema } from './enrollments.schemas.js';
import {
  createEnrollment,
  getEnrollmentById,
  getClassroomCapacity,
  getCampusCapacity,
} from './enrollments.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

router.post('/', validate(enrollmentCreateSchema), createEnrollment);
router.get('/classrooms/:classroomId/capacity', getClassroomCapacity);
router.get('/capacity', getCampusCapacity);
router.get('/:id', getEnrollmentById);

export default router;