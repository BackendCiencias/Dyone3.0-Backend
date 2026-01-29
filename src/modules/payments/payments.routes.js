import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { paymentCreateSchema } from './payments.schemas.js';
import { createPayment, getDebtors } from './payments.controller.js';

const router = Router();

// Proteger rutas de pagos
router.use(authMiddleware);
router.use(requireRoles(['SECRETARY', 'DIRECTOR', 'PROMOTER']));

router.post('/', validate(paymentCreateSchema), createPayment);
router.get('/debtors', getDebtors);

export default router;