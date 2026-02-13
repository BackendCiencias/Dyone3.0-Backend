import { z } from 'zod';

export const paymentCreateSchema = z.object({
  familyId: z.string().min(1),
  campusId: z.string().min(1),
  paidAt: z.string().optional(),
  method: z.enum(['CASH', 'YAPE', 'TRANSFER']),
  voucherNumber: z.string().min(1),
  allocations: z.array(
    z.object({
      chargeId: z.string().min(1),
      amount: z.number().positive(),
    })
  ).min(1),
  notes: z.string().optional(),
});

export const debtorsQuerySchema = z.object({
  campusId: z.string().optional(),
  cycleId: z.string().optional(),
  conceptId: z.string().optional(),
  q: z.string().optional(),
});