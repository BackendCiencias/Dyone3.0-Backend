import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

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

const guardianSchema = z.object({
  dni: z.string().optional(),
  names: z.string().min(1),
  lastNames: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  relationship: z.enum(['PADRE', 'MADRE', 'TUTOR', 'APODERADO', 'Padre', 'Madre', 'Apoderado', 'Otro']),
});

export const familyLinkStudentSchema = z.object({
  studentId: z.string().min(1),
  familyId: z.string().optional(),
  family: z.object({
    address: z.string().optional(),
    campusId: z.string().optional(),
    guardians: z.array(guardianSchema).min(1),
  }).optional(),
}).refine((data) => data.familyId || data.family, {
  message: 'Debes enviar familyId o family para crear y vincular',
  path: ['familyId'],
});


export const familyIdParamsSchema = z.object({
  id: objectIdSchema,
});
