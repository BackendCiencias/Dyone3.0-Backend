import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');
const SCHOOL_MONTHS = 10;

const feeSchema = z.object({
  amount: z.number().min(0).optional(),
  isExempt: z.boolean().optional(),
  reason: z.string().optional(),
});

const admissionFeeSchema = feeSchema.extend({
  applies: z.boolean().optional(),
});

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

const tutorSchema = z.object({
  person: personSchema,
  relationship: z.enum(['Padre', 'Madre', 'Abuelo', 'Abuela', 'Tio', 'Tia', 'Apoderado', 'Otro']),
  isPrimary: z.boolean().optional(),
  livesWithStudent: z.boolean().optional(),
});

const chargeSchema = z.object({
  conceptId: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
});

const enrollmentStudentCostsSchema = z.object({
  classroomId: objectIdSchema.optional(),
  monthlyAmount: z.number().nonnegative().optional(),
  pensionMonthlyAmounts: z.array(z.number().min(-1)).length(SCHOOL_MONTHS).optional(),
  admissionFee: admissionFeeSchema.optional(),
  enrollmentFee: feeSchema.optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.monthlyAmount === undefined && data.pensionMonthlyAmounts === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Debe enviar monthlyAmount o pensionMonthlyAmounts',
    });
  }
});

const enrollmentStudentSchema = z.object({
  person: personSchema,
  tutors: z.array(tutorSchema).min(1),
  classroomId: objectIdSchema,
  charges: z.array(chargeSchema).optional(),
  admissionFee: admissionFeeSchema.optional(),
  enrollmentFee: feeSchema.optional(),
  monthlyAmount: z.number().nonnegative().optional(),
  pensionMonthlyAmounts: z.array(z.number().min(-1)).length(SCHOOL_MONTHS).optional(),
  notes: z.string().optional(),
});

const legacyEnrollmentSchema = z.object({
  campusId: objectIdSchema,
  cycleId: objectIdSchema,
  originSchool: z.string().min(1),
  students: z.array(enrollmentStudentSchema).min(1),
  contractNumber: z.string().optional(),
  notes: z.string().optional(),
});

const quickEnrollmentSchema = z.object({
  studentId: objectIdSchema,
  cycleId: objectIdSchema,
  classroomId: objectIdSchema,
  source: z.enum(['RENEWAL', 'NEW', 'TRANSFER']),
  admissionFee: admissionFeeSchema.optional(),
  enrollmentFee: feeSchema.optional(),
  monthlyAmount: z.number().nonnegative().optional(),
  pensionMonthlyAmounts: z.array(z.number().min(-1)).length(SCHOOL_MONTHS).optional(),
  discounts: z.array(z.object({ name: z.string(), amount: z.number() })).optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.monthlyAmount === undefined && data.pensionMonthlyAmounts === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['monthlyAmount'],
      message: 'Debe enviar monthlyAmount o pensionMonthlyAmounts',
    });
  }
});

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

export const intakeSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'q muy corto').max(80),
  campusScope: z.enum(['ALL', 'CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const objectId = z.union([objectIdSchema, z.any()]);

export const intakeSearchResponseSchema = z.object({
  q: z.string(),
  campusScope: z.enum(['ALL', 'CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']),
  items: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('FAMILY'),
      familyId: objectId,
      primaryTutor: z.object({
        personId: objectId,
        names: z.string(),
        lastNames: z.string(),
        dni: z.string().nullable(),
        phone: z.string().nullable().optional(),
      }).nullable(),
      studentsCount: z.number().int().nonnegative(),
      campusHints: z.array(z.string()),
    }),
    z.object({
      type: z.literal('STUDENT'),
      studentId: objectId,
      person: z.object({
        names: z.string(),
        lastNames: z.string(),
        dni: z.string().nullable(),
        gender: z.enum(['M', 'F']),
      }),
      familyId: objectId.nullable(),
      activeStatus: z.enum(['ACTIVE', 'INACTIVE', 'GRADUATED']),
      campusCode: z.enum(['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS']).nullable(),
      cycleStatus: z.enum(['ABSENT', 'ENROLLED', 'TRANSFERRED']).nullable(),
      hasVacancy: z.boolean(),
      classroom: z.object({
        classroomId: objectId,
        label: z.string(),
      }).nullable(),
    }),
  ])),
});

export const enrollmentIdParamsSchema = z.object({
  id: objectIdSchema,
});

export const enrollmentConfirmSchema = z.object({
  cycleId: objectIdSchema.optional(),
  campusId: objectIdSchema.optional(),
  students: z.array(z.object({
    studentId: objectIdSchema,
    classroomId: objectIdSchema.optional(),
    monthlyAmount: z.number().nonnegative().optional(),
    pensionMonthlyAmounts: z.array(z.number().min(-1)).length(SCHOOL_MONTHS).optional(),
    admissionFee: admissionFeeSchema.optional(),
    enrollmentFee: feeSchema.optional(),
    notes: z.string().optional(),
  }).superRefine((data, ctx) => {
    if (data.monthlyAmount === undefined && data.pensionMonthlyAmounts === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cada estudiante debe enviar monthlyAmount o pensionMonthlyAmounts',
      });
    }
  })).min(1),
  discounts: z.string().optional(),
  exemptions: z.string().optional(),
  notes: z.string().optional(),
});
