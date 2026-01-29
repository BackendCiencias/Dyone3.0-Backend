import { z } from 'zod';

// Esquemas de validación para el módulo de administración

export const campusCreateSchema = z.object({
  code: z.enum(['CIMAS', 'CIENCIAS_PRI', 'CIENCIAS_SEC']),
  name: z.string().min(1),
  isActive: z.boolean().optional().default(true),
});

export const cycleCreateSchema = z.object({
  type: z.enum(['SCHOOL_YEAR', 'SUMMER', 'PRE_U']),
  name: z.string().min(1),
  year: z.number().int(),
  startDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Fecha inicio inválida' }),
  endDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Fecha fin inválida' }),
  isActive: z.boolean().optional().default(true),
});

export const classroomCreateSchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  level: z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']),
  grade: z.string().min(1),
  section: z.string().min(1),
  capacity: z.number().int().positive(),
  displayName: z.string().min(1),
  isActive: z.boolean().optional().default(true),
});

export const billingConceptCreateSchema = z.object({
  name: z.string().min(1),
  isBlocking: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});