import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { authorizeByCampusScope } from '../../shared/authorization.middleware.js';
import { findStudentCampusById } from './repositories/students.repository.js';
import {
  studentCreateSchema,
  studentIdParamsSchema,
  studentDetailQuerySchema,
  studentCycleStatusSchema,
  studentClassroomSchema,
  studentCreateWithPersonSchema,
  studentFinancialParamsSchema,
  studentIdentitySchema,
  studentInternalNotesSchema,
} from './students.schemas.js';
import {
  createStudent,
  searchStudent,
  listStudents,
  studentSummary,
  listStudentsByCampus,
  getStudentDetail,
  updateStudentCycleStatus,
  changeStudentClassroom,
  createStudentWithPerson,
  getStudentAccountStatement,
  getStudentCharges,
  getStudentPayments,
  updateStudentIdentity,
  updateStudentInternalNotes,
} from './students.controller.js';
import { tutorCreateSchema } from '../tutors/tutors.schemas.js';
import { upsertTutor } from '../tutors/tutors.controller.js';

const router = Router();

const coreSecretaryRoles = [
  'SECRETARY',
  'SECRETARY_CIENCIAS_SEC',
  'SECRETARY_CIENCIAS_PRIM',
  'SECRETARY_CIMAS',
];

router.use(authMiddleware);

router.get('/search', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]), searchStudent);
router.get('/', requireRoles(['ADMIN', 'PROMOTER']), listStudents);
router.get('/campus/:campus', requireRoles(['ADMIN', 'PROMOTER', 'DIRECTOR', ...coreSecretaryRoles]), listStudentsByCampus);
router.get('/:id/summary', requireRoles(['ADMIN', 'PROMOTER', 'DIRECTOR', ...coreSecretaryRoles]), studentSummary);
router.get('/:studentId/account-statement',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  authorizeByCampusScope(async (req) => findStudentCampusById(req.params.studentId)),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentAccountStatement
);
router.get('/:studentId/charges',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentCharges
);
router.get('/:studentId/payments',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentPayments
);
router.get(
  '/:id',
  requireRoles(['ADMIN', 'PROMOTER', 'DIRECTOR', ...coreSecretaryRoles]),
  validateRequest({ params: studentIdParamsSchema, query: studentDetailQuerySchema }),
  getStudentDetail
);
router.patch(
  '/:id/cycle-status',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  validateRequest({ params: studentIdParamsSchema, body: studentCycleStatusSchema }),
  updateStudentCycleStatus
);
router.patch(
  '/:id/classroom',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  authorizeByCampusScope(async (req) => findStudentCampusById(req.params.id, req.body?.cycleId)),
  validateRequest({ params: studentIdParamsSchema, body: studentClassroomSchema }),
  changeStudentClassroom
);
router.patch(
  '/:id/identity',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  validateRequest({ params: studentIdParamsSchema, body: studentIdentitySchema }),
  updateStudentIdentity
);
router.patch(
  '/:id/internal-notes',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  validateRequest({ params: studentIdParamsSchema, body: studentInternalNotesSchema }),
  updateStudentInternalNotes
);
router.post('/with-person', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]), validate(studentCreateWithPersonSchema), createStudentWithPerson);
router.post('/', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]), validate(studentCreateSchema), createStudent);

router.post(
  '/:studentId/tutors',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  (req, _res, next) => { req.body.studentId = req.params.studentId; next(); },
  validate(tutorCreateSchema),
  upsertTutor
);

export default router;
