import { z } from 'zod';

const nullableString = z.string().trim().optional().or(z.literal(''));

export const tutorCreateSchema = z.object({
  studentId: z.string().optional(),
  studentCod: z.string().optional(),
  studentCods: z.array(z.string().trim().min(1)).optional(),
  studentsCod: z.array(z.string().trim().min(1)).optional(),
  familyId: z.string().optional(),
  relationship: z.enum(['MADRE', 'PADRE', 'HERMANA', 'HERMANO', 'ABUELA', 'ABUELO', 'APODERADO']),
  names: z.string().trim().min(1),
  lastNames: z.string().trim().min(1),
  dni: nullableString,
  phones: z.union([z.string(), z.array(z.string())]).optional(),
  notes: z.string().optional(),
  isPrimary: z.boolean().optional(),
  livesWithStudent: z.boolean().optional(),
});
