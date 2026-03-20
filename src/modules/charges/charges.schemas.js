import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

export const chargeCreateSchema = z.object({
  studentId: z.string().optional(),
  studentCod: z.string().optional(),
  cycleId: z.string().min(1).optional(),
  campusId: z.string().min(1).optional(),
  billingConceptId: objectIdSchema.optional(),
  conceptName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  observation: z.string().optional(),
}).superRefine((value, ctx) => {
  if (!value.studentId && !value.studentCod) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['studentId'],
      message: 'Debes enviar studentId o studentCod',
    });
  }

  if (!value.billingConceptId && !value.conceptName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['billingConceptId'],
      message: 'Debes enviar billingConceptId o conceptName',
    });
  }
});

export const chargeIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const chargeUpdateSchema = z.object({
  amount: z.number().positive(),
  dueDate: z.string().optional(),
});
