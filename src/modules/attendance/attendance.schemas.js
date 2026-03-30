import { z } from 'zod';

const objectIdSchema = z.string().regex(/^[a-fA-F0-9]{24}$/, 'ObjectId inválido');
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida. Usa YYYY-MM-DD');
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Hora inválida. Usa HH:mm');

export const attendanceSessionOpenSchema = z.object({
  campusId: objectIdSchema,
  cycleId: objectIdSchema,
  date: dateSchema,
  expectedStartTime: timeSchema.optional(),
  onTimeUntil: timeSchema.optional(),
  lateUntil: timeSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const attendanceSessionCurrentQuerySchema = z.object({
  campusId: objectIdSchema,
  cycleId: objectIdSchema,
  date: dateSchema,
});

export const attendanceSessionIdParamsSchema = z.object({
  sessionId: objectIdSchema,
});

export const attendanceSessionUpdateSchema = z.object({
  expectedStartTime: timeSchema.optional(),
  onTimeUntil: timeSchema.optional(),
  lateUntil: timeSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
});

export const attendanceRecordIdParamsSchema = z.object({
  recordId: objectIdSchema,
});

export const attendanceIntakeViewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
  q: z.string().trim().max(120).optional(),
});

export const attendanceScanSchema = z.object({
  studentCode: z.string().trim().min(1).max(64),
  arrivalTime: timeSchema.optional(),
  markMethod: z.enum(['MANUAL', 'BARCODE']),
});

export const attendanceCloseSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export const attendanceJustificationSchema = z.object({
  justificationReason: z.string().trim().min(3).max(1000),
});

export const attendanceBatchJustificationSchema = z.object({
  recordIds: z.array(objectIdSchema).min(1).max(31),
  justificationReason: z.string().trim().min(3).max(1000),
});

export const attendanceMonthlySummaryQuerySchema = z.object({
  campusId: objectIdSchema.optional(),
  cycleId: objectIdSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const attendanceDailyReportQuerySchema = z.object({
  date: dateSchema,
});

export const attendanceRecentJustificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const attendanceClassroomMonthlySummaryParamsSchema = z.object({
  classroomId: objectIdSchema,
});

export const attendanceStudentMonthlySummaryParamsSchema = z.object({
  studentId: objectIdSchema,
});
