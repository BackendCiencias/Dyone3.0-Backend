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
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: objectIdSchema.optional(),
  campus: z.enum(['CIENCIAS', 'CIMAS', 'CIENCIAS_APLICADAS']).optional(),
});


const campusSchema = z.enum(['CIENCIAS', 'CIMAS', 'CIENCIAS_APLICADAS']);

export const familyListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: objectIdSchema.optional(),
  campus: campusSchema.optional(),
});

const guardianSchema = z.object({
  dni: z.string().optional(),
  names: z.string().min(1),
  lastNames: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  relationship: z.enum(['PADRE', 'MADRE', 'TUTOR', 'APODERADO', 'Padre', 'Madre', 'Apoderado', 'Otro']),
});

const relationshipSchema = z.enum(['PADRE', 'MADRE', 'TUTOR', 'APODERADO', 'Padre', 'Madre', 'Apoderado', 'Otro']);

const tutorPersonPayloadSchema = z.object({
  names: z.string().trim().min(1),
  lastNames: z.string().trim().min(1),
  dni: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional(),
  gender: z.enum(['Masculino', 'Femenino']).optional(),
});

export const familyAddTutorSchema = z.object({
  mode: z.enum(['create', 'linkExisting']).optional().default('create'),
  tutorId: objectIdSchema.optional(),
  personId: objectIdSchema.optional(),
  person: tutorPersonPayloadSchema.optional(),
  studentId: objectIdSchema.optional(),
  relationship: relationshipSchema,
  livesWithStudent: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'create' && !data.person) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'person es requerido en modo create', path: ['person'] });
  }

  if (data.mode === 'linkExisting' && !data.tutorId && !data.personId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tutorId o personId es requerido en modo linkExisting', path: ['tutorId'] });
  }
});

export const familySetPrimaryTutorSchema = z.object({
  tutorId: objectIdSchema,
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
