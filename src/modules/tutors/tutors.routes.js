import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { tutorCreateSchema } from './tutors.schemas.js';
import { upsertTutor } from './tutors.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_CIENCIAS_SEC', 'SECRETARY_CIENCIAS_PRIM', 'SECRETARY_CIMAS']));

router.post('/', validate(tutorCreateSchema), upsertTutor);
router.post('/student/:studentId', (req, _res, next) => { req.body.studentId = req.params.studentId; next(); }, validate(tutorCreateSchema), upsertTutor);

export default router;
