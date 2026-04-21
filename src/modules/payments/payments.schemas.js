import { z } from 'zod';

const allocationSchema = z.object({
  chargeId: z.string().min(1),
  amount: z.number().positive(),
});

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

export const paymentCreateSchema = z.object({
  campusId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  paidAt: z.string().optional(),
  method: z.enum(['CASH', 'YAPE', 'TRANSFER', 'CAJA_AREQUIPA']),
  receiptNumber: z.string().trim().min(1).max(6).optional(),
  voucherNumber: z.string().min(1).optional(),
  allocations: z.array(allocationSchema).min(1).optional(),
  notes: z.string().optional(),
  note: z.string().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
}).superRefine((data, ctx) => {
  if (!data.studentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['studentId'],
      message: 'Debes enviar studentId',
    });
  }

  if (!data.amount && !data.allocations?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amount'],
      message: 'Debes enviar amount o allocations',
    });
  }
});

export const paymentIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const paymentReceiptCorrectionSchema = z.object({
  method: z.enum(['CASH', 'YAPE', 'TRANSFER', 'CAJA_AREQUIPA']),
  amount: z.number().positive().optional(),
  paidAt: z.string().trim().min(1).optional(),
  receiptNumber: z.string().trim().max(6).optional().or(z.literal('')),
  voucherNumber: z.string().trim().max(64).optional().or(z.literal('')),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
  reassignStudentId: objectIdSchema.optional(),
  reassignAllocations: z.array(z.object({
    chargeId: objectIdSchema,
    amount: z.number().positive(),
  })).min(1).optional(),
  correctionReason: z.string().trim().min(5, 'Debes indicar el motivo de la corrección'),
}).superRefine((data, ctx) => {
  const hasStudent = Boolean(data.reassignStudentId);
  const hasAllocations = Array.isArray(data.reassignAllocations) && data.reassignAllocations.length > 0;

  if (hasStudent !== hasAllocations) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reassignStudentId'],
      message: 'Para reasignar el pago debes enviar alumno destino y allocations destino',
    });
  }
});

export const debtorsQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  cycleId: z.string().optional(),
  conceptId: z.string().optional(),
  q: z.string().optional(),
  onlyOverdue: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const debtorsSearchQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  cycleId: z.string().optional(),
  q: z.string().trim().min(2),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const debtorsPrintBodySchema = z.object({
  studentIds: z.array(objectIdSchema).min(1, 'Debes seleccionar al menos un alumno'),
  filters: z.object({
    campus: z.string().optional(),
    campusId: z.string().optional(),
    cycleId: z.string().optional(),
    conceptId: z.string().optional(),
    q: z.string().trim().optional(),
    onlyOverdue: z.coerce.boolean().optional(),
  }).optional().default({}),
});

export const paymentsDailySummaryQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const paymentsDailyTransactionsQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const paymentsAccountingQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  method: z.enum(['CASH', 'YAPE', 'TRANSFER', 'CAJA_AREQUIPA']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const cajaArequipaProcessBodySchema = z.object({
  campus: z.string().trim().min(1).optional(),
  fileName: z.string().trim().min(1).max(200),
  pdfBase64: z.string().trim().min(32),
});

export const cajaArequipaImportParamsSchema = z.object({
  importId: objectIdSchema,
});

export const cajaArequipaConfirmBodySchema = z.object({
  importId: objectIdSchema,
});
