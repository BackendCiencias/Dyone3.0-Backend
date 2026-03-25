import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope, authorizeByCampusScope } from '../../shared/authorization.middleware.js';
import {
  debtorsQuerySchema,
  debtorsSearchQuerySchema,
  paymentCreateSchema,
  paymentIdParamsSchema,
  paymentReceiptCorrectionSchema,
  paymentsDailySummaryQuerySchema,
  paymentsDailyTransactionsQuerySchema,
} from './payments.schemas.js';
import {
  createPayment,
  getDailyPaymentSummary,
  getDailyPaymentTransactions,
  getDebtors,
  searchDebtors,
  updatePaymentReceipt,
} from './payments.controller.js';
import { findPaymentCampusById } from './payments.repository.js';

const router = Router();
const PAYMENT_WRITE_ROLES = ['ADMIN', 'SECRETARY', 'DIRECTOR', 'PROMOTER'];
const PAYMENT_READ_ROLES = [...PAYMENT_WRITE_ROLES, 'SECRETARY_VIEWER', 'AUXILIAR'];

router.use(authMiddleware);

router.post('/', requireRoles(PAYMENT_WRITE_ROLES), validate(paymentCreateSchema), createPayment);
router.patch(
  '/:id/receipt',
  requireRoles(['SECRETARY', 'ADMIN']),
  authorizeByCampusScope(async (req) => findPaymentCampusById(req.params.id)),
  validateRequest({ params: paymentIdParamsSchema, body: paymentReceiptCorrectionSchema }),
  updatePaymentReceipt,
);
router.get('/daily-summary', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: paymentsDailySummaryQuerySchema }), getDailyPaymentSummary);
router.get('/daily-transactions', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: paymentsDailyTransactionsQuerySchema }), getDailyPaymentTransactions);
router.get('/debtors/search', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsSearchQuerySchema }), searchDebtors);
router.get('/debtors', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsQuerySchema }), getDebtors);

export default router;
