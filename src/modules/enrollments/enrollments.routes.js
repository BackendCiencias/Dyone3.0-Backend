import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope, authorizeByCampusScope } from '../../shared/authorization.middleware.js';
import { findEnrollmentCampusById } from './repositories/enrollments.repository.js';
import { enrollmentConfirmSchema, enrollmentFinalizeSchema, enrollmentIdParamsSchema, enrollmentListQuerySchema, enrollmentStatusUpdateSchema } from './enrollments.schemas.js';
import {
  getEnrollmentById,
  getClassroomCapacity,
  getCampusCapacity,
  confirmEnrollment,
  finalizeEnrollment,
  listEnrollments,
  updateEnrollmentStatus,
} from './enrollments.controller.js';

const router = Router();
const ENROLLMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const ENROLLMENT_READ_ROLES = [...ENROLLMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

router.use(authMiddleware);

router.post('/finalize', requireRoles(ENROLLMENT_WRITE_ROLES), validate(enrollmentFinalizeSchema), finalizeEnrollment);
router.patch('/:id/status',
  requireRoles(ENROLLMENT_WRITE_ROLES),
  authorizeByCampusScope(async (req) => findEnrollmentCampusById(req.params.id)),
  validateRequest({ params: enrollmentIdParamsSchema, body: enrollmentStatusUpdateSchema }),
  updateEnrollmentStatus
);
router.post('/:id/confirm',
  requireRoles(ENROLLMENT_WRITE_ROLES),
  authorizeByCampusScope(async (req) => findEnrollmentCampusById(req.params.id)),
  validateRequest({ params: enrollmentIdParamsSchema, body: enrollmentConfirmSchema }),
  confirmEnrollment
);
router.get('/', requireRoles(ENROLLMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: enrollmentListQuerySchema }), listEnrollments);
router.get('/classrooms/:classroomId/capacity', requireRoles(ENROLLMENT_READ_ROLES), getClassroomCapacity);
router.get('/capacity', requireRoles(ENROLLMENT_READ_ROLES), getCampusCapacity);
router.get('/:id', requireRoles(ENROLLMENT_READ_ROLES), getEnrollmentById);

export default router;
