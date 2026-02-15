import { z } from 'zod';

const allocationSchema = z.object({
  chargeId: z.string().min(1),
  amount: z.number().positive(),
});

export const paymentCreateSchema = z.object({
  familyId: z.string().min(1).optional(),
  campusId: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  paidAt: z.string().optional(),
  method: z.enum(['CASH', 'YAPE', 'TRANSFER']),
  voucherNumber: z.string().min(1).optional(),
  allocations: z.array(allocationSchema).min(1).optional(),
  notes: z.string().optional(),
  note: z.string().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
}).superRefine((data, ctx) => {
  if (!data.studentId && !data.familyId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['studentId'],
      message: 'Debes enviar studentId o familyId',
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

export const debtorsQuerySchema = z.object({
  campus: z.string().optional(),
  campusId: z.string().optional(),
  cycleId: z.string().optional(),
  conceptId: z.string().optional(),
  q: z.string().optional(),
});
