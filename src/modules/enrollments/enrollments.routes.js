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

const coreSecretaryRoles = [
  'SECRETARY',
  'SECRETARY_CIENCIAS_SEC',
  'SECRETARY_CIENCIAS_PRIM',
  'SECRETARY_CIMAS',
];

const router = Router();

// Proteger todas las rutas de familias
router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]));

router.post('/', validate(enrollmentCreateSchema), createEnrollment);
router.post('/:id/confirm', validateRequest({ params: enrollmentIdParamsSchema, body: enrollmentConfirmSchema }), confirmEnrollment);
router.get('/classrooms/:classroomId/capacity', getClassroomCapacity);
router.get('/capacity', getCampusCapacity);
router.get('/:id', getEnrollmentById);

export default router;
