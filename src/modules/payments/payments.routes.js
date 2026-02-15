import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import { paymentCreateSchema } from './payments.schemas.js';
import { createPayment, getDebtors } from './payments.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRoles(['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER', 'SECRETARY_CIENCIAS_SEC', 'SECRETARY_CIENCIAS_PRIM', 'SECRETARY_CIMAS']));

router.post('/', validate(paymentCreateSchema), createPayment);
router.get('/debtors', attachCampusScope(), getDebtors);

export default router;