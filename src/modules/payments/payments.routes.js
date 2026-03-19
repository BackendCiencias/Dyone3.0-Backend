import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope } from '../../shared/authorization.middleware.js';
import { debtorsQuerySchema, debtorsSearchQuerySchema, paymentCreateSchema } from './payments.schemas.js';
import { createPayment, getDebtors, searchDebtors } from './payments.controller.js';

const router = Router();
const PAYMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const PAYMENT_READ_ROLES = [...PAYMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

router.use(authMiddleware);

router.post('/', requireRoles(PAYMENT_WRITE_ROLES), validate(paymentCreateSchema), createPayment);
router.get('/debtors/search', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsSearchQuerySchema }), searchDebtors);
router.get('/debtors', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsQuerySchema }), getDebtors);

export default router;
