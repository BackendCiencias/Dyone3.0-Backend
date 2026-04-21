import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.js';
import { requireRoles } from '../../middlewares/roles.js';
import { validate } from '../../middlewares/validate.js';
import { validateRequest } from '../../middlewares/validateRequest.js';
import { attachCampusScope, authorizeByCampusScope } from '../../shared/authorization.middleware.js';
import {
  cajaArequipaConfirmBodySchema,
  cajaArequipaImportParamsSchema,
  cajaArequipaProcessBodySchema,
  debtorsQuerySchema,
  debtorsPrintBodySchema,
  debtorsSearchQuerySchema,
  paymentCreateSchema,
  paymentIdParamsSchema,
  paymentReceiptCorrectionSchema,
  paymentsAccountingQuerySchema,
  paymentsDailySummaryQuerySchema,
  paymentsDailyTransactionsQuerySchema,
} from './payments.schemas.js';
import {
  getAccountingPayments,
  confirmCajaArequipaImport,
  createPayment,
  getCajaArequipaReview,
  getDailyPaymentSummary,
  getDailyPaymentTransactions,
  getDebtors,
  printDebtors,
  processCajaArequipa,
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
router.get('/accounting', requireRoles(['ADMIN']), attachCampusScope(), validateRequest({ query: paymentsAccountingQuerySchema }), getAccountingPayments);
router.get('/daily-summary', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: paymentsDailySummaryQuerySchema }), getDailyPaymentSummary);
router.get('/daily-transactions', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: paymentsDailyTransactionsQuerySchema }), getDailyPaymentTransactions);
router.post('/caja-arequipa/process', requireRoles(['ADMIN', 'SECRETARY']), attachCampusScope(), validateRequest({ body: cajaArequipaProcessBodySchema }), processCajaArequipa);
router.get('/caja-arequipa/review/:importId', requireRoles(['ADMIN', 'SECRETARY']), attachCampusScope(), validateRequest({ params: cajaArequipaImportParamsSchema }), getCajaArequipaReview);
router.post('/caja-arequipa/confirm', requireRoles(['ADMIN', 'SECRETARY']), attachCampusScope(), validateRequest({ body: cajaArequipaConfirmBodySchema }), confirmCajaArequipaImport);
router.get('/debtors/search', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsSearchQuerySchema }), searchDebtors);
router.get('/debtors', requireRoles(PAYMENT_READ_ROLES), attachCampusScope(), validateRequest({ query: debtorsQuerySchema }), getDebtors);
router.post('/debtors/print', requireRoles(['ADMIN', 'SECRETARY']), attachCampusScope(), validateRequest({ body: debtorsPrintBodySchema }), printDebtors);

export default router;
