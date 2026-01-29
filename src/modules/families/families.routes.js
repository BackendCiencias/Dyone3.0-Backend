import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { familyCreateSchema } from './families.schemas.js';
import { createFamily, searchFamily } from './families.controller.js';

const router = Router();

// Proteger todas las rutas de familias
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

// Crear una nueva familia
router.post('/', validate(familyCreateSchema), createFamily);

// Buscar familias por DNI
router.get('/search', searchFamily);

export default router;