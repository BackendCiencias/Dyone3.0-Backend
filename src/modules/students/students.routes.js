import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { studentCreateSchema } from './students.schemas.js';
import { createStudent, searchStudent, listStudents, studentSummary } from './students.controller.js';
import { tutorCreateSchema } from '../tutors/tutors.schemas.js';
import { upsertTutor } from '../tutors/tutors.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_CIENCIAS_SEC', 'SECRETARY_CIENCIAS_PRIM', 'SECRETARY_CIMAS']));

router.get('/', listStudents);
router.get('/:id/summary', studentSummary);
router.post('/', validate(studentCreateSchema), createStudent);

router.post('/:studentId/tutors', (req, _res, next) => { req.body.studentId = req.params.studentId; next(); }, validate(tutorCreateSchema), upsertTutor);
router.get('/search', searchStudent);

export default router;
