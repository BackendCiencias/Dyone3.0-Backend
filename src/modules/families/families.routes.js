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
  familyListSchema,
  familyAddTutorSchema,
  familySetPrimaryTutorSchema,
} from './families.schemas.js';
import {
  createFamily,
  listFamilies,
  searchFamilies,
  linkStudentFamily,
  getFamilyById,
  addFamilyTutor,
  setFamilyPrimaryTutor,
} from './families.controller.js';

const coreSecretaryRoles = [
  'SECRETARY',
  'SECRETARY_CIENCIAS_SEC',
  'SECRETARY_CIENCIAS_PRIM',
  'SECRETARY_CIMAS',
];

const router = Router();

// Proteger todas las rutas de familias
router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', ...coreSecretaryRoles]));

// Crear una nueva familia
router.post('/', validate(familyCreateSchema), createFamily);
router.post('/link-student', validate(familyLinkStudentSchema), linkStudentFamily);

// Listado base de familias (dashboard)
router.get('/', validateRequest({ query: familyListSchema }), listFamilies);

// Buscar familias por datos de ventanilla
router.get('/search', validateRequest({ query: familySearchSchema }), searchFamilies);
router.get('/:id', validateRequest({ params: familyIdParamsSchema }), getFamilyById);
router.post('/:id/tutors', validateRequest({ params: familyIdParamsSchema, body: familyAddTutorSchema }), addFamilyTutor);
router.patch('/:id/primary-tutor', validateRequest({ params: familyIdParamsSchema, body: familySetPrimaryTutorSchema }), setFamilyPrimaryTutor);

export default router;
