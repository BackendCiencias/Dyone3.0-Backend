import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import {
  getCampuses,
  postCampus,
  getCycles,
  postCycle,
  getClassrooms,
  postClassroom,
  getBillingConcepts,
  postBillingConcept,
  getEndpointsCatalog,
  getModelsCatalog,
} from './admin.controller.js';
import {
  campusCreateSchema,
  cycleCreateSchema,
  classroomCreateSchema,
  billingConceptCreateSchema,
} from './admin.schemas.js';

const router = Router();

// Middleware de autenticación y roles comunes para todas las rutas de administración
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY','SECRETARY_CIENCIAS_SEC', 'DIRECTOR', 'PROMOTER','ADMIN']));

// Campuses
router.get('/campuses', getCampuses);
router.post('/campuses', validate(campusCreateSchema), postCampus);

// Cycles
router.get('/cycles', getCycles);
router.post('/cycles', validate(cycleCreateSchema), postCycle);

// Classrooms
router.get('/classrooms', getClassrooms);
router.post('/classrooms', validate(classroomCreateSchema), postClassroom);

// Billing concepts
router.get('/billing-concepts', getBillingConcepts);
router.post('/billing-concepts', validate(billingConceptCreateSchema), postBillingConcept);

router.get('/endpoints', requireRoles(['ADMIN']), getEndpointsCatalog);
router.get('/models', requireRoles(['ADMIN']), getModelsCatalog);

export default router;
