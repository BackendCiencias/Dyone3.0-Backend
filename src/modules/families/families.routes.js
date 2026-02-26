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
  familyTutorParamsSchema,
  familyUpdateTutorSchema,
  familyUnlinkStudentSchema,
} from './families.schemas.js';
import {
  createFamily,
  listFamilies,
  searchFamilies,
  linkStudentFamily,
  getFamilyById,
  addFamilyTutor,
  setFamilyPrimaryTutor,
  updateFamilyTutor,
  deleteFamilyTutor,
  unlinkFamilyStudent,
} from './families.controller.js';

const router = Router();
const FAMILY_READ_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_VIEWER', 'AUXILIAR'];
const FAMILY_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];

router.use(authMiddleware);

router.post('/', requireRoles(FAMILY_WRITE_ROLES), validate(familyCreateSchema), createFamily);
router.post('/link-student', requireRoles(FAMILY_WRITE_ROLES), validate(familyLinkStudentSchema), linkStudentFamily);

router.get('/', requireRoles(FAMILY_READ_ROLES), validateRequest({ query: familyListSchema }), listFamilies);
router.get('/search', requireRoles(FAMILY_READ_ROLES), validateRequest({ query: familySearchSchema }), searchFamilies);
router.get('/:id', requireRoles(FAMILY_READ_ROLES), validateRequest({ params: familyIdParamsSchema }), getFamilyById);
router.post('/:id/tutors', requireRoles(FAMILY_WRITE_ROLES), validateRequest({ params: familyIdParamsSchema, body: familyAddTutorSchema }), addFamilyTutor);
router.patch('/:id/primary-tutor', requireRoles(FAMILY_WRITE_ROLES), validateRequest({ params: familyIdParamsSchema, body: familySetPrimaryTutorSchema }), setFamilyPrimaryTutor);
router.patch('/:id/tutors/:tutorId', requireRoles(FAMILY_WRITE_ROLES), validateRequest({ params: familyTutorParamsSchema, body: familyUpdateTutorSchema }), updateFamilyTutor);
router.delete('/:id/tutors/:tutorId', requireRoles(FAMILY_WRITE_ROLES), validateRequest({ params: familyTutorParamsSchema }), deleteFamilyTutor);
router.post('/:id/unlink-student', requireRoles(FAMILY_WRITE_ROLES), validateRequest({ params: familyIdParamsSchema, body: familyUnlinkStudentSchema }), unlinkFamilyStudent);

export default router;
