import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { classroomBoardQuerySchema, classroomOptionsQuerySchema } from './classrooms.schemas.js';
import { getClassroomBoard, getClassroomOptions } from './classrooms.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'DIRECTOR', 'PROMOTER', 'SECRETARY', 'SECRETARY_VIEWER', 'AUXILIAR']));

router.get('/options', validateRequest({ query: classroomOptionsQuerySchema }), getClassroomOptions);
router.get('/board', requireRoles(['ADMIN']), validateRequest({ query: classroomBoardQuerySchema }), getClassroomBoard);

export default router;
