import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { authorizeByCampusScope } from '../../shared/authorization.middleware.js';
import { findStudentCampusById } from './repositories/students.repository.js';
import {
  studentCreateSchema,
  studentIdParamsSchema,
  studentDetailQuerySchema,
  studentCycleStatusSchema,
  studentClassroomSchema,
  studentIntakeCreateSchema,
  studentFinancialParamsSchema,
  studentIdentitySchema,
  studentInternalNotesSchema,
  studentSearchQuerySchema,
  studentBankCodeSchema,
  studentUnassignedQuerySchema,
  unassignedSearchQuerySchema,
  studentPrintCardsSchema,
} from './students.schemas.js';
import {
  createStudent,
  searchStudent,
  listStudents,
  studentSummary,
  listStudentsByCampus,
  getStudentDetail,
  updateStudentCycleStatus,
  changeStudentClassroom,
  createStudentIntake,
  getStudentAccountStatement,
  getStudentCharges,
  getStudentPayments,
  updateStudentIdentity,
  updateStudentInternalNotes,
  updateStudentBankCode,
  listUnassignedStudents,
  searchUnassigned,
  printStudentCards,
} from './students.controller.js';
import { tutorCreateSchema } from '../tutors/tutors.schemas.js';
import { upsertTutor } from '../tutors/tutors.controller.js';

const router = Router();
const STUDENT_READ_ROLES = ['ADMIN', 'PROMOTER', 'DIRECTOR', 'SECRETARY', 'SECRETARY_VIEWER', 'AUXILIAR'];
const STUDENT_WRITE_ROLES = ['ADMIN', 'PROMOTER', 'DIRECTOR', 'SECRETARY'];

router.use(authMiddleware);

router.get('/search', requireRoles(STUDENT_READ_ROLES), validateRequest({ query: studentSearchQuerySchema }), searchStudent);
router.post('/print-cards', requireRoles(STUDENT_READ_ROLES), validateRequest({ body: studentPrintCardsSchema }), printStudentCards);
router.get('/', requireRoles(['ADMIN', 'PROMOTER']), listStudents);
router.get('/campus/:campus', requireRoles(STUDENT_READ_ROLES), listStudentsByCampus);
router.get('/unassigned/search', requireRoles(STUDENT_READ_ROLES), validateRequest({ query: unassignedSearchQuerySchema }), searchUnassigned);
router.get('/unassigned', requireRoles(['ADMIN', 'SECRETARY', 'SECRETARY_VIEWER', 'PROMOTER']), validateRequest({ query: studentUnassignedQuerySchema }), listUnassignedStudents);
router.get('/:id/summary', requireRoles(STUDENT_READ_ROLES), studentSummary);
router.get('/:studentId/account-statement',
  requireRoles(STUDENT_READ_ROLES),
  authorizeByCampusScope(async (req) => findStudentCampusById(req.params.studentId)),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentAccountStatement
);
router.get('/:studentId/charges',
  requireRoles(STUDENT_READ_ROLES),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentCharges
);
router.get('/:studentId/payments',
  requireRoles(STUDENT_READ_ROLES),
  validateRequest({ params: studentFinancialParamsSchema }),
  getStudentPayments
);
router.get(
  '/:id',
  requireRoles(STUDENT_READ_ROLES),
  validateRequest({ params: studentIdParamsSchema, query: studentDetailQuerySchema }),
  getStudentDetail
);
router.patch(
  '/:id/cycle-status',
  requireRoles(STUDENT_WRITE_ROLES),
  validateRequest({ params: studentIdParamsSchema, body: studentCycleStatusSchema }),
  updateStudentCycleStatus
);
router.patch(
  '/:id/classroom',
  requireRoles(STUDENT_WRITE_ROLES),
  authorizeByCampusScope(async (req) => findStudentCampusById(req.params.id, req.body?.cycleId)),
  validateRequest({ params: studentIdParamsSchema, body: studentClassroomSchema }),
  changeStudentClassroom
);
router.patch(
  '/:id/identity',
  requireRoles(STUDENT_WRITE_ROLES),
  validateRequest({ params: studentIdParamsSchema, body: studentIdentitySchema }),
  updateStudentIdentity
);
router.patch(
  '/:id/internal-notes',
  requireRoles(STUDENT_WRITE_ROLES),
  validateRequest({ params: studentIdParamsSchema, body: studentInternalNotesSchema }),
  updateStudentInternalNotes
);
router.patch(
  '/:id/bank-code',
  requireRoles(['ADMIN', 'SECRETARY']),
  validateRequest({ params: studentIdParamsSchema, body: studentBankCodeSchema }),
  updateStudentBankCode
);
router.post('/intake', requireRoles(STUDENT_WRITE_ROLES), validate(studentIntakeCreateSchema), createStudentIntake);
router.post('/', requireRoles(STUDENT_WRITE_ROLES), validate(studentCreateSchema), createStudent);

router.post(
  '/:studentId/tutors',
  requireRoles(STUDENT_WRITE_ROLES),
  (req, _res, next) => { req.body.studentId = req.params.studentId; next(); },
  validate(tutorCreateSchema),
  upsertTutor
);

export default router;
