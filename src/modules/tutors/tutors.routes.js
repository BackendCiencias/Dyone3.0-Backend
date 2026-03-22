import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { tutorCreateSchema, tutorIdParamsSchema, tutorSearchQuerySchema, tutorUpdateSchema } from './tutors.schemas.js';
import { upsertTutor, updateTutor, deleteTutor, searchTutors } from './tutors.controller.js';

const router = Router();

router.use(authMiddleware);

router.get('/search', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER']), validateRequest({ query: tutorSearchQuerySchema }), searchTutors);
router.post('/', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER']), validate(tutorCreateSchema), upsertTutor);
router.post('/student/:studentId', requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER']), (req, _res, next) => { req.body.studentId = req.params.studentId; next(); }, validate(tutorCreateSchema), upsertTutor);

router.patch('/:id', requireRoles(['ADMIN', 'SECRETARY']), validateRequest({ params: tutorIdParamsSchema, body: tutorUpdateSchema }), updateTutor);
router.delete('/:id', requireRoles(['ADMIN']), validateRequest({ params: tutorIdParamsSchema }), deleteTutor);

export default router;
