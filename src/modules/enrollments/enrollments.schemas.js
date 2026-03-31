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

export const enrollmentStatusUpdateSchema = z.object({
  status: z.enum(['ABSENT', 'ENROLLED', 'TRANSFERRED']),
  reason: z.string().trim().min(1).optional(),
});

export const enrollmentContractUpdateSchema = z.object({
  address: z.string().trim().min(1, 'La dirección de contacto es obligatoria'),
  notes: z.string().trim().optional(),
  contractDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha de contrato inválida'),
});

export const enrollmentContractSignersUpdateSchema = z.object({
  signerPersonIds: z.array(objectIdSchema).min(1, 'Debe quedar al menos un tutor firmante'),
});

export const enrollmentStudentCostsUpdateSchema = z.object({
  students: z.array(z.object({
    enrollmentStudentId: objectIdSchema,
    admissionFeeAmount: z.number().min(0),
    enrollmentFeeAmount: z.number().min(0),
    pensionAmount: z.number().min(0),
  })).min(1),
});

export const enrollmentMergeSchema = z.object({
  sourceEnrollmentId: objectIdSchema,
  notes: z.string().trim().max(600).optional(),
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

const stringOrNumber = z.union([z.string(), z.number()]);
const optionalDniSchema = z.union([
  z.string().trim().regex(/^\d{8}$/, 'DNI inválido. Debe tener exactamente 8 dígitos'),
  z.literal(''),
]).optional();

const finalStudentSchema = z.object({
  localId: z.string().optional(),
  mode: z.enum(['existing', 'new']),
  existingStudentId: objectIdSchema.optional(),
  names: z.string().optional(),
  lastNames: z.string().optional(),
  dni: optionalDniSchema,
  gender: z.enum(['M', 'F']).optional(),
  previousSchoolType: z.enum(['CIMAS', 'CIENCIAS', 'CIENCIAS_APLICADAS', 'OTHER']).optional(),
  previousSchoolName: z.string().optional(),
  classroomId: objectIdSchema,
  level: z.string().optional(),
  grade: z.string().optional(),
  notes: z.string().optional(),
  amounts: z.object({
    admissionFeeAmount: stringOrNumber.optional(),
    enrollmentFeeAmount: stringOrNumber.optional(),
    pensionAmount: stringOrNumber.optional(),
    pensionMonthlyAmounts: z.array(stringOrNumber).length(SCHOOL_MONTHS).optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'existing' && !data.existingStudentId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'existingStudentId es requerido para alumno existente', path: ['existingStudentId'] });
  }
  if (data.mode === 'new') {
    if (!String(data.names || '').trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'names es requerido para alumno nuevo', path: ['names'] });
    if (!String(data.lastNames || '').trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'lastNames es requerido para alumno nuevo', path: ['lastNames'] });
  }
  if (String(data.previousSchoolType || '').trim() === 'OTHER' && !String(data.previousSchoolName || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'previousSchoolName es requerido cuando previousSchoolType = OTHER', path: ['previousSchoolName'] });
  }
});

const finalTutorSchema = z.object({
  localId: z.string().optional(),
  mode: z.string().optional(),
  existingTutorId: objectIdSchema.optional(),
  names: z.string().trim().min(1),
  lastNames: z.string().trim().min(1),
  dni: optionalDniSchema,
  phone: z.string().optional(),
  relationship: z.string().optional(),
  isLegalResponsible: z.boolean().optional(),
  includeInContract: z.boolean().optional(),
  linkedStudentIds: z.array(z.string()).optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'existing' && !data.existingTutorId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'existingTutorId es requerido para tutor existente', path: ['existingTutorId'] });
  }
  if (!Array.isArray(data.linkedStudentIds) || !data.linkedStudentIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'linkedStudentIds debe tener al menos un alumno vinculado', path: ['linkedStudentIds'] });
  }
});

export const enrollmentFinalizeSchema = z.object({
  activeCycleId: objectIdSchema.optional(),
  students: z.array(finalStudentSchema).min(1),
  tutors: z.array(finalTutorSchema).min(1),
  observations: z.object({
    general: z.string().optional(),
    address: z.string().optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  const studentRefs = new Set();
  const studentDnis = new Set();
  const tutorDnis = new Set();

  data.students.forEach((student, index) => {
    const ref = student.localId || student.existingStudentId;
    if (!ref) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Cada alumno debe tener localId o existingStudentId', path: ['students', index, 'localId'] });
      return;
    }

    if (studentRefs.has(ref)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No se permiten alumnos duplicados en el draft', path: ['students', index] });
      return;
    }

    studentRefs.add(ref);

    const dni = String(student.dni || '').replace(/\D/g, '').trim();
    if (dni) {
      if (studentDnis.has(dni)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No se permiten DNIs repetidos entre alumnos', path: ['students', index, 'dni'] });
      }
      studentDnis.add(dni);
    }
  });

  if (!data.tutors.some((tutor) => tutor.includeInContract !== false)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Debe haber al menos un tutor firmante', path: ['tutors'] });
  }

  data.tutors.forEach((tutor, index) => {
    const dni = String(tutor.dni || '').replace(/\D/g, '').trim();
    if (dni) {
      if (tutorDnis.has(dni)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No se permiten DNIs repetidos entre tutores', path: ['tutors', index, 'dni'] });
      }
      if (studentDnis.has(dni)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un mismo DNI no puede existir en alumnos y tutores del draft', path: ['tutors', index, 'dni'] });
      }
      tutorDnis.add(dni);
    }

    const linkedIds = Array.isArray(tutor.linkedStudentIds) ? tutor.linkedStudentIds : [];
    linkedIds.forEach((linkedId, linkedIndex) => {
      if (!studentRefs.has(linkedId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Tutor vinculado a un alumno inexistente en el draft',
          path: ['tutors', index, 'linkedStudentIds', linkedIndex],
        });
      }
    });
  });
});
