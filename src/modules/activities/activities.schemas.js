import { z } from 'zod';

const CAMPUS_CODES = ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'];
const METHOD_CODES = ['CASH', 'YAPE', 'TRANSFER'];
const ACTIVITY_STATUS = ['ACTIVE', 'CLOSED', 'LIQUIDATED'];
const ACTIVITY_TYPES = ['CONTEST', 'EVENT', 'CAMPAIGN', 'SPECIAL_COLLECTION'];
const AUDIENCE_TYPES = ['LEVEL', 'GRADE', 'CLASSROOMS', 'CUSTOM'];
const LEVELS = ['INITIAL', 'PRIMARY', 'SECONDARY'];

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return defaultValue;
}

function normalizeDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCampus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || null;
}

const objectIdSchema = z.string().trim().regex(/^[a-f\d]{24}$/i, 'Id invalido');
const amountSchema = z.union([z.string(), z.number()]).transform((value) => Number(value)).refine((value) => Number.isFinite(value) && value > 0, {
  message: 'amount debe ser mayor a 0',
});

function validateActivityAudience(value, ctx, { allowPartial = false } = {}) {
  if (value.audienceType === 'LEVEL' && !value.targetLevel) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetLevel'], message: 'targetLevel es requerido para audienceType LEVEL' });
  }
  if (value.audienceType === 'GRADE') {
    if (!value.targetLevel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetLevel'], message: 'targetLevel es requerido para audienceType GRADE' });
    }
    if (!value.targetGrade) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetGrade'], message: 'targetGrade es requerido para audienceType GRADE' });
    }
  }
  if (value.audienceType === 'CLASSROOMS' && !value.classroomIds?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['classroomIds'], message: 'classroomIds es requerido para audienceType CLASSROOMS' });
  }
  if (value.startsAt && value.endsAt && value.startsAt > value.endsAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'endsAt debe ser posterior a startsAt' });
  }

  if (allowPartial && value.audienceType === undefined) {
    return;
  }
}

const activityBodyBaseSchema = z.object({
  campusCode: z.string().transform(normalizeCampus).refine((value) => CAMPUS_CODES.includes(value), {
    message: 'campusCode invalido',
  }),
  name: z.string().trim().min(3, 'name es requerido'),
  type: z.string().trim().toUpperCase().optional().default('SPECIAL_COLLECTION').refine((value) => ACTIVITY_TYPES.includes(value), {
    message: 'type invalido',
  }),
  description: z.string().trim().optional().default(''),
  audienceType: z.string().trim().toUpperCase().refine((value) => AUDIENCE_TYPES.includes(value), {
    message: 'audienceType invalido',
  }),
  targetLevel: z.string().trim().toUpperCase().optional().or(z.literal('')).transform((value) => value || null).refine((value) => value === null || LEVELS.includes(value), {
    message: 'targetLevel invalido',
  }),
  targetGrade: z.union([z.string(), z.number()]).optional().or(z.literal('')).transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }),
  classroomIds: z.array(objectIdSchema).optional().default([]),
  amount: amountSchema,
  allowSecretaryCollection: z.any().optional().transform((value) => normalizeBoolean(value, true)),
  allowAuxiliarCollection: z.any().optional().transform((value) => normalizeBoolean(value, true)),
  allowAdminCollection: z.any().optional().transform((value) => normalizeBoolean(value, true)),
  startsAt: z.any().optional().transform(normalizeDate),
  endsAt: z.any().optional().transform(normalizeDate),
});

export const activityCreateBodySchema = activityBodyBaseSchema.superRefine((value, ctx) => {
  validateActivityAudience(value, ctx);
});

export const activityUpdateBodySchema = activityBodyBaseSchema.partial().extend({
  status: z.string().trim().toUpperCase().optional().refine((value) => value === undefined || ACTIVITY_STATUS.includes(value), {
    message: 'status invalido',
  }),
}).superRefine((value, ctx) => {
  validateActivityAudience(value, ctx, { allowPartial: true });
});

export const activityParamsSchema = z.object({
  activityId: objectIdSchema,
});

export const activityCollectionParamsSchema = z.object({
  collectionId: objectIdSchema,
});

export const listActivitiesQuerySchema = z.object({
  campus: z.any().optional().transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    return normalizeCampus(value);
  }).refine((value) => value === null || CAMPUS_CODES.includes(value), { message: 'campus invalido' }),
  status: z.any().optional().transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    return String(value).trim().toUpperCase();
  }).refine((value) => value === null || ACTIVITY_STATUS.includes(value), { message: 'status invalido' }),
  q: z.string().trim().optional().default(''),
  limit: z.any().optional().transform((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 20;
    return Math.max(1, Math.min(100, Math.trunc(parsed)));
  }),
});

export const activityParticipantsQuerySchema = z.object({
  q: z.string().trim().optional().default(''),
  status: z.any().optional().transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    return String(value).trim().toUpperCase();
  }).refine((value) => value === null || ['PENDING', 'PAID', 'ANULADO'].includes(value), { message: 'status invalido' }),
  limit: z.any().optional().transform((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 50;
    return Math.max(1, Math.min(200, Math.trunc(parsed)));
  }),
});

export const createParticipantBodySchema = z.object({
  studentId: objectIdSchema,
  notes: z.string().trim().optional().default(''),
});

export const createCollectionBodySchema = z.object({
  studentId: objectIdSchema,
  amount: amountSchema.optional(),
  method: z.string().trim().toUpperCase().optional().default('CASH').refine((value) => METHOD_CODES.includes(value), {
    message: 'method invalido',
  }),
  collectedAt: z.any().optional().transform(normalizeDate),
  notes: z.string().trim().optional().default(''),
});

export const searchActivityStudentsQuerySchema = z.object({
  q: z.string().trim().min(1, 'q es requerido'),
  campus: z.any().optional().transform((value) => {
    if (value === undefined || value === null || value === '') return null;
    return normalizeCampus(value);
  }).refine((value) => value === null || CAMPUS_CODES.includes(value), { message: 'campus invalido' }),
  limit: z.any().optional().transform((value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.max(1, Math.min(25, Math.trunc(parsed)));
  }),
});
