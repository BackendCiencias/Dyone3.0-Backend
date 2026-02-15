import { z } from 'zod';

const nullableString = z.string().trim().optional().or(z.literal(''));
const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

const personSchema = z.object({
  names: z.string().trim().min(1),
  lastNames: z.string().trim().min(1),
  dni: nullableString,
  gender: z.enum(['Masculino', 'Femenino']),
  birthDate: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  nationality: z.string().optional(),
  foreignIdNumber: z.string().optional(),
});

export const studentCreateSchema = z.object({
  person: personSchema,
  classroomId: z.string().min(1),
  familyId: z.string().optional(),
  entryDate: z.string().optional(),
  notes: z.string().optional(),
});

export const studentIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const studentDetailQuerySchema = z.object({
  cycleId: objectIdSchema.optional(),
});

export const studentCycleStatusSchema = z.object({
  cycleId: objectIdSchema,
  status: z.enum(['ABSENT', 'ENROLLED', 'TRANSFERRED']),
  reason: z.string().trim().min(1).optional(),
});

export const studentClassroomSchema = z.object({
  cycleId: objectIdSchema,
  classroomId: objectIdSchema,
  reason: z.string().trim().min(1).optional(),
});
