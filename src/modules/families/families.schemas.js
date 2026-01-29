import { z } from 'zod';

// Esquema de persona básico
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

export const familyCreateSchema = z.object({
  tutors: z.array(personSchema).min(1, { message: 'Se requiere al menos un tutor' }),
  students: z.array(personSchema).min(1, { message: 'Se requiere al menos un estudiante' }),
  notes: z.string().optional(),
});

export const familySearchSchema = z.object({
  dni: z.string().min(1),
});