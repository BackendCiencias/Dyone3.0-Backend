import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import {
  getCampuses,
  postCampus,
  getCycles,
  postCycle,
  getClassrooms,
  postClassroom,
  patchClassroom,
  getBillingConcepts,
  postBillingConcept,
  postBillingSchedule,
  getBillingScheduleByCycle,
  getEndpointsCatalog,
  getModelsCatalog,
  getAttendancePolicyConfig,
  putAttendancePolicyConfig,
  getAttendanceSessionsConfig,
  deleteAttendanceSessionConfig,
  getCajaArequipaExport,
  getPrograms,
  postProgram,
  getProgramById,
  postProgramStudent,
  postProgramSession,
  getProgramSessionById,
  putProgramSessionEntry,
} from './admin.controller.js';
import {
  campusCreateSchema,
  cycleCreateSchema,
  classroomCreateSchema,
  classroomUpdateSchema,
  billingConceptCreateSchema,
  billingScheduleUpsertSchema,
  billingScheduleQuerySchema,
  attendancePolicyUpsertSchema,
  attendancePolicyQuerySchema,
  adminAttendanceSessionsQuerySchema,
  adminAttendanceSessionParamsSchema,
  cajaArequipaExportQuerySchema,
  programCreateSchema,
  programEnrollmentCreateSchema,
  programIdParamsSchema,
  programSessionCreateSchema,
  programSessionEntryUpsertSchema,
  programSessionParamsSchema,
} from './admin.schemas.js';

const router = Router();

// Middleware de autenticación y roles comunes para todas las rutas de administración
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER', 'ADMIN']));

// Campuses
router.get('/campuses', getCampuses);
router.post('/campuses', validate(campusCreateSchema), postCampus);

// Cycles
router.get('/cycles', getCycles);
router.post('/cycles', validate(cycleCreateSchema), postCycle);

// Classrooms
router.get('/classrooms', getClassrooms);
router.post('/classrooms', validate(classroomCreateSchema), postClassroom);
router.patch('/classrooms/:id', validate(classroomUpdateSchema), patchClassroom);

// Billing concepts
router.get('/billing-concepts', getBillingConcepts);
router.post('/billing-concepts', validate(billingConceptCreateSchema), postBillingConcept);
router.post('/billing-schedule', validate(billingScheduleUpsertSchema), postBillingSchedule);
router.get('/billing-schedule', validateRequest({ query: billingScheduleQuerySchema }), getBillingScheduleByCycle);
router.get('/attendance-policy', validateRequest({ query: attendancePolicyQuerySchema }), getAttendancePolicyConfig);
router.put('/attendance-policy', validateRequest({ body: attendancePolicyUpsertSchema }), putAttendancePolicyConfig);
router.get('/attendance-sessions', requireRoles(['ADMIN']), validateRequest({ query: adminAttendanceSessionsQuerySchema }), getAttendanceSessionsConfig);
router.delete('/attendance-sessions/:sessionId', requireRoles(['ADMIN']), validateRequest({ params: adminAttendanceSessionParamsSchema }), deleteAttendanceSessionConfig);
router.get('/exports/caja-arequipa', validateRequest({ query: cajaArequipaExportQuerySchema }), getCajaArequipaExport);
router.get('/programs', getPrograms);
router.post('/programs', validate(programCreateSchema), postProgram);
router.get('/programs/:id', validateRequest({ params: programIdParamsSchema }), getProgramById);
router.post('/programs/:id/students', validateRequest({ params: programIdParamsSchema, body: programEnrollmentCreateSchema }), postProgramStudent);
router.post('/programs/:id/sessions', validateRequest({ params: programIdParamsSchema, body: programSessionCreateSchema }), postProgramSession);
router.get('/programs/:id/sessions/:sessionId', validateRequest({ params: programSessionParamsSchema }), getProgramSessionById);
router.put('/programs/:id/sessions/:sessionId/entry', validateRequest({ params: programSessionParamsSchema, body: programSessionEntryUpsertSchema }), putProgramSessionEntry);

router.get('/endpoints', requireRoles(['ADMIN']), getEndpointsCatalog);
router.get('/models', requireRoles(['ADMIN']), getModelsCatalog);

export default router;
