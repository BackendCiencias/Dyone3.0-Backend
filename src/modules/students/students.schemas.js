import { z } from 'zod';

const nullableString = z.string().trim().optional().or(z.literal(''));

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