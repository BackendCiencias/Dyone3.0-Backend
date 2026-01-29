import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { studentCreateSchema } from './students.schemas.js';
import { createStudent, searchStudent } from './students.controller.js';

const router = Router();

// Aplicar autenticación y roles a todas las rutas de estudiantes
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

// Crear estudiante
router.post('/', validate(studentCreateSchema), createStudent);

// Buscar estudiante por DNI
router.get('/search', searchStudent);

export default router;