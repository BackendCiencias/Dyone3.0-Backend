import { z } from 'zod';

export const chargeCreateSchema = z.object({
  studentId: z.string().optional(),
  studentCod: z.string().optional(),
  cycleId: z.string().min(1),
  campusId: z.string().min(1),
  conceptName: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});
