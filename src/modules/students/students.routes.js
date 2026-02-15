import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import {
  studentCreateSchema,
  studentIdParamsSchema,
  studentDetailQuerySchema,
  studentCycleStatusSchema,
  studentClassroomSchema,
  studentCreateWithPersonSchema,
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
  validateRequest({ params: studentIdParamsSchema, body: studentClassroomSchema }),
  changeStudentClassroom
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
