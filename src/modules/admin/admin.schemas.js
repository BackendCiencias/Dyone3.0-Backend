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

const classroomBaseSchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  level: z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']),
  grade: z.string().min(1),
  section: z.string().min(1),
  capacity: z.number().int().positive(),
  displayName: z.string().min(1),
  isActive: z.boolean().optional().default(true),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const classroomCreateSchema = classroomBaseSchema;

export const classroomUpdateSchema = classroomBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Debe enviar al menos un campo para actualizar' }
);

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

export const attendancePolicyUpsertSchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  level: z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']),
  name: z.string().trim().min(1).max(120).default('Asistencia regular'),
  defaultOnTimeUntil: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const attendancePolicyQuerySchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  level: z.enum(['INITIAL', 'PRIMARY', 'SECONDARY']),
});

export const cajaArequipaExportQuerySchema = z.object({
  campus: z.enum(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']).optional(),
  cycleId: z.string().min(1).optional(),
});

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

export const programCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).optional().default(''),
  cycleId: objectIdSchema,
});

export const programIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const programEnrollmentCreateSchema = z.object({
  existingStudentId: objectIdSchema.optional(),
  newStudent: z.object({
    names: z.string().trim().min(1),
    lastNames: z.string().trim().min(1),
    classroomId: objectIdSchema.optional(),
    otherSchoolName: z.string().trim().max(160).optional().default(''),
    grade: z.string().trim().max(40).optional().default(''),
  }).optional(),
  sessionId: objectIdSchema.optional(),
  attended: z.boolean().optional().default(true),
  paymentAmount: z.coerce.number().min(0),
  paymentMethod: z.enum(['CASH', 'YAPE', 'TRANSFER']),
  receivedBy: z.enum(['Juan Carlos', 'Juan Manuel', 'Maricarmen', 'Diego', 'Angie']).nullable().optional().default(null),
  paymentDate: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Fecha de pago inválida' }),
  notes: z.string().trim().max(1000).optional().default(''),
}).superRefine((data, ctx) => {
  if (!data.existingStudentId && !data.newStudent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Debe enviar existingStudentId o newStudent' });
  }
  if (data.newStudent && !data.newStudent.classroomId) {
    const hasOtherSchool = Boolean(String(data.newStudent.otherSchoolName || '').trim());
    const hasGrade = Boolean(String(data.newStudent.grade || '').trim());
    if (!hasOtherSchool || !hasGrade) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Para alumno externo debes indicar colegio y grado',
        path: ['newStudent'],
      });
    }
  }
  if (Number(data.paymentAmount || 0) > 0 && !data.receivedBy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Debe indicar quién recibió el pago',
      path: ['receivedBy'],
    });
  }
});

export const programSessionCreateSchema = z.object({
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Fecha de sesión inválida' }),
  notes: z.string().trim().max(1000).optional().default(''),
});

export const programSessionParamsSchema = z.object({
  id: objectIdSchema,
  sessionId: objectIdSchema,
});

export const programSessionEntryUpsertSchema = z.object({
  programEnrollmentId: objectIdSchema,
  attended: z.boolean(),
  paymentAmount: z.coerce.number().min(0).optional().default(0),
  paymentMethod: z.enum(['CASH', 'YAPE', 'TRANSFER', 'PENDING']).optional().default('PENDING'),
  receivedBy: z.enum(['Juan Carlos', 'Juan Manuel', 'Maricarmen', 'Diego', 'Angie']).nullable().optional().default(null),
  notes: z.string().trim().max(1000).optional().default(''),
}).superRefine((data, ctx) => {
  if (Number(data.paymentAmount || 0) > 0 && !data.receivedBy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Debe indicar quién recibió el pago',
      path: ['receivedBy'],
    });
  }
});
