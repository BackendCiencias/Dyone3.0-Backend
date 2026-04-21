import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  createPaymentService,
  getAccountingPaymentsService,
  getDebtorsSearchService,
  getDebtorsService,
  getDebtorsPrintService,
  getDailyPaymentSummaryService,
  getDailyPaymentTransactionsService,
  updatePaymentReceiptServiceV2,
} from './payments.service.js';
import {
  confirmCajaArequipaImportService,
  getCajaArequipaReviewService,
  processCajaArequipaPdfService,
} from './cajaArequipa.service.js';

export const createPayment = asyncHandler(async (req, res) => {
  const result = await createPaymentService({
    ...req.validated,
    notes: req.validated.notes || req.validated.note,
    idempotencyKey: req.validated.idempotencyKey || req.headers['idempotency-key'],
    createdByUserId: req.user.id,
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
});

export const getDebtors = asyncHandler(async (req, res) => {
  const { cycleId, conceptId, campus, campusId, onlyOverdue, limit, page } = req.validatedQuery || req.query;
  const result = await getDebtorsService({
    cycleId,
    conceptId,
    campus: campus || campusId,
    campusScope: req.campusScope,
    onlyOverdue,
    limit,
    page,
  });
  res.json(result);
});

export const searchDebtors = asyncHandler(async (req, res) => {
  const { q, cycleId, campus, campusId, limit } = req.validatedQuery || req.query;
  const result = await getDebtorsSearchService({
    q,
    cycleId,
    campus: campus || campusId,
    campusScope: req.campusScope,
    limit,
  });
  res.json(result);
});

export const getDailyPaymentSummary = asyncHandler(async (req, res) => {
  const { campus, campusId, date } = req.validatedQuery || req.query;
  const result = await getDailyPaymentSummaryService({
    campus: campus || campusId,
    date,
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const printDebtors = asyncHandler(async (req, res) => {
  const { studentIds, filters } = req.validated;
  const result = await getDebtorsPrintService({
    studentIds,
    filters,
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const getDailyPaymentTransactions = asyncHandler(async (req, res) => {
  const { campus, campusId, date, page, limit } = req.validatedQuery || req.query;
  const result = await getDailyPaymentTransactionsService({
    campus: campus || campusId,
    date,
    page,
    limit,
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const getAccountingPayments = asyncHandler(async (req, res) => {
  const { campus, campusId, method, page, limit } = req.validatedQuery || req.query;
  const result = await getAccountingPaymentsService({
    campus: campus || campusId,
    method,
    page,
    limit,
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const updatePaymentReceipt = asyncHandler(async (req, res) => {
  const result = await updatePaymentReceiptServiceV2({
    paymentId: req.params.id,
    payload: req.validated,
    userId: req.user.id,
    userRoles: req.user?.roles || [],
  });
  res.json(result);
});

export const processCajaArequipa = asyncHandler(async (req, res) => {
  const { campus, fileName, pdfBase64 } = req.validated;
  const result = await processCajaArequipaPdfService({
    campus,
    fileName,
    pdfBase64,
    campusScope: req.campusScope,
    requestedByUserId: req.user.id,
  });
  res.status(202).json(result);
});

export const getCajaArequipaReview = asyncHandler(async (req, res) => {
  const { importId } = req.validatedParams || req.params;
  const result = await getCajaArequipaReviewService({
    importId,
    campusScope: req.campusScope,
  });
  res.json(result);
});

export const confirmCajaArequipaImport = asyncHandler(async (req, res) => {
  const { importId } = req.validated;
  const result = await confirmCajaArequipaImportService({
    importId,
    campusScope: req.campusScope,
    userId: req.user.id,
  });
  res.json(result);
});
