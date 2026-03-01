import { z } from 'zod';

const nullableString = z.string().trim().optional().or(z.literal(''));
const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

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

export const tutorIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const tutorUpdateSchema = z.object({
  names: z.string().trim().min(1).optional(),
  lastNames: z.string().trim().min(1).optional(),
  dni: nullableString,
  phone: z.string().trim().optional(),
  gender: z.enum(['M', 'F']).optional(),
  relationship: z.enum(['MADRE', 'PADRE', 'HERMANA', 'HERMANO', 'ABUELA', 'ABUELO', 'APODERADO']).optional(),
  isPrimary: z.boolean().optional(),
  livesWithStudent: z.boolean().optional(),
  notes: z.string().optional(),
}).refine((payload) => Object.keys(payload).length > 0, {
  message: 'Debe enviar al menos un campo para actualizar',
});
