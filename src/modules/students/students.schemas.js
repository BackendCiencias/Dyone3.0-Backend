import { z } from 'zod';

const personSchema = z.object({
  names: z.string().min(1),
  lastNames: z.string().min(1),
  dni: z.string().min(1),
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
  familyId: z.string().min(1),
  entryDate: z.string().optional(),
  notes: z.string().optional(),
});