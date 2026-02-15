import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import {
  familyCreateSchema,
  familyLinkStudentSchema,
  familyIdParamsSchema,
  familySearchSchema,
  familyAddTutorSchema,
  familySetPrimaryTutorSchema,
} from './families.schemas.js';
import {
  createFamily,
  searchFamily,
  linkStudentFamily,
  getFamilyById,
  addFamilyTutor,
  setFamilyPrimaryTutor,
} from './families.controller.js';

const router = Router();

// Proteger todas las rutas de familias
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

// Crear una nueva familia
router.post('/', validate(familyCreateSchema), createFamily);
router.post('/link-student', validate(familyLinkStudentSchema), linkStudentFamily);

// Buscar familias por datos de ventanilla
router.get('/search', validateRequest({ query: familySearchSchema }), searchFamily);
router.get('/:id', validateRequest({ params: familyIdParamsSchema }), getFamilyById);
router.post('/:id/tutors', validateRequest({ params: familyIdParamsSchema, body: familyAddTutorSchema }), addFamilyTutor);
router.patch('/:id/primary-tutor', validateRequest({ params: familyIdParamsSchema, body: familySetPrimaryTutorSchema }), setFamilyPrimaryTutor);

export default router;
