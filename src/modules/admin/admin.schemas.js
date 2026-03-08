import { z } from 'zod';

// Esquemas de validación para el módulo de administración

export const campusCreateSchema = z.object({
  code: z.enum(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']),
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
  code: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  name: z.string().min(1),
  isBlocking: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

const billingScheduleItemSchema = z.object({
  monthIndex: z.number().int().min(0).max(9).nullable(),
  label: z.string().trim().optional().default(''),
  dueDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'dueDate inválida' }),
});

export const billingScheduleUpsertSchema = z.object({
  cycleId: z.string().min(1),
  conceptCode: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()),
  items: z.array(billingScheduleItemSchema).min(1),
});

export const billingScheduleQuerySchema = z.object({
  cycleId: z.string().min(1),
  conceptCode: z.string().trim().min(1).max(40).transform((value) => value.toUpperCase()).optional().default('TUITION'),
});
