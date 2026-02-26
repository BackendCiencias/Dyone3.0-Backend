import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

// Schema de persona reutilizable
const personSchema = z.object({
  names: z.string().min(1),
  lastNames: z.string().min(1),
  dni: z.string().min(1),
  gender: z.enum(['M', 'F']),
  birthDate: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  nationality: z.string().optional(),
  foreignIdNumber: z.string().optional(),
});

// Tutor con persona y relación
const tutorSchema = z.object({
  person: personSchema,
  relationship: z.enum(['Padre', 'Madre', 'Abuelo', 'Abuela', 'Tio', 'Tia', 'Apoderado', 'Otro']),
  isPrimary: z.boolean().optional(),
  livesWithStudent: z.boolean().optional(),
});

// Cargo (deuda) inicial para un estudiante
const chargeSchema = z.object({
  conceptId: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
});

// Estudiante con sus tutores y cargos
const enrollmentStudentSchema = z.object({
  person: personSchema,
  tutors: z.array(tutorSchema).min(1),
  classroomId: z.string().min(1),
  charges: z.array(chargeSchema).optional(),
});

const legacyEnrollmentSchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  originSchool: z.string().min(1),
  students: z.array(enrollmentStudentSchema).min(1),
  contractNumber: z.string().optional(),
  notes: z.string().optional(),
});

const quickEnrollmentSchema = z.object({
  studentId: z.string().min(1),
  cycleId: z.string().min(1),
  classroomId: z.string().min(1),
  source: z.enum(['RENEWAL', 'NEW', 'TRANSFER']),
  discounts: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
  notes: z.string().optional(),
});

// Esquema principal de matrícula
export const enrollmentCreateSchema = z.union([quickEnrollmentSchema, legacyEnrollmentSchema]);



export const enrollmentListQuerySchema = z.object({
  q: z.string().optional(),
  campus: z.string().optional(),
  cycleId: objectIdSchema.optional(),
  status: z.enum(['ABSENT', 'ENROLLED', 'TRANSFERRED']).optional(),
  classroomId: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: objectIdSchema.optional(),
});

export const enrollmentIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const enrollmentConfirmSchema = z.object({
  cycleId: objectIdSchema,
  campusId: objectIdSchema,
  students: z.array(z.object({
    studentId: objectIdSchema,
    monthlyAmount: z.number().nonnegative().optional(),
    classroomId: objectIdSchema.optional(),
    pensionMonthlyAmounts: z.array(z.number().min(-1)).length(10).optional(),
    notes: z.string().optional(),
  })).min(1),
  discounts: z.string().optional(),
  exemptions: z.string().optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  for (const [index, student] of data.students.entries()) {
    if (student.monthlyAmount === undefined && student.pensionMonthlyAmounts === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['students', index],
        message: 'Cada estudiante debe enviar monthlyAmount o pensionMonthlyAmounts',
      });
    }
  }
});
