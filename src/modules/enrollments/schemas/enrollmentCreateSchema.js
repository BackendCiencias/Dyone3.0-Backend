import { z } from 'zod';

const SCHOOL_MONTHS = 10;
const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');

const admissionFeeSchema = z.object({
  applies: z.boolean(),
  isExempt: z.boolean(),
  amount: z.number().min(0),
  reason: z.string(),
}).strict();

const enrollmentFeeSchema = z.object({
  isExempt: z.boolean(),
  amount: z.number().min(0),
  reason: z.string(),
}).strict();

const enrollmentStudentSchema = z.object({
  studentId: objectIdSchema,
  classroomId: objectIdSchema,
  admissionFee: admissionFeeSchema,
  enrollmentFee: enrollmentFeeSchema,
  pensionMonthlyAmounts: z.array(z.number().min(-1)).length(SCHOOL_MONTHS),
  previousSchoolType: z.string().min(1),
  notes: z.string().optional(),
}).strict();

export const enrollmentCreateSchema = z.object({
  familyId: objectIdSchema,
  campusId: objectIdSchema,
  cycleId: objectIdSchema,
  enrollmentStudents: z.array(enrollmentStudentSchema).min(1),
  notes: z.string().optional(),
}).strict();
