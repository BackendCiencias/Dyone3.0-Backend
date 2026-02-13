import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { studentCreateSchema } from './students.schemas.js';
import {
  createStudent,
  searchStudent,
  listStudents,
  studentSummary,
  listStudentsByCampus,
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

router.get('/', requireRoles(['ADMIN', 'PROMOTER']), listStudents);
router.get('/campus/:campus', requireRoles(['ADMIN', 'PROMOTER', 'DIRECTOR', ...coreSecretaryRoles]), listStudentsByCampus);
router.get('/:id/summary', requireRoles(['ADMIN', 'PROMOTER', 'DIRECTOR', ...coreSecretaryRoles]), studentSummary);
router.post('/', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]), validate(studentCreateSchema), createStudent);

router.post(
  '/:studentId/tutors',
  requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]),
  (req, _res, next) => { req.body.studentId = req.params.studentId; next(); },
  validate(tutorCreateSchema),
  upsertTutor
);
router.get('/search', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]), searchStudent);

export default router;
