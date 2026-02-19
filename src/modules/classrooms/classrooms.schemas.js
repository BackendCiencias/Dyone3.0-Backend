import { z } from 'zod';

const levelMap = {
  INICIAL: 'INITIAL',
  INITIAL: 'INITIAL',
  PRIMARIA: 'PRIMARY',
  PRIMARY: 'PRIMARY',
  SECUNDARIA: 'SECONDARY',
  SECONDARY: 'SECONDARY',
};

function normalizeLevel(levelRaw) {
  const normalized = String(levelRaw || '').trim().toUpperCase();
  return levelMap[normalized] || null;
}

function normalizeGrade(gradeRaw) {
  if (gradeRaw === null || gradeRaw === undefined) return null;

  const asString = String(gradeRaw).trim();
  const match = asString.match(/\d+/);
  if (!match) return null;

  const grade = Number.parseInt(match[0], 10);
  if (!Number.isFinite(grade) || grade <= 0) return null;
  return grade;
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return defaultValue;
}

export const classroomOptionsQuerySchema = z.object({
  level: z.any().refine((value) => normalizeLevel(value), {
    message: 'level es requerido y debe ser válido (INITIAL|PRIMARY|SECONDARY o INICIAL|PRIMARIA|SECUNDARIA)',
  }).transform((value) => normalizeLevel(value)),
  grade: z.any().refine((value) => normalizeGrade(value) !== null, {
    message: 'grade es requerido y debe ser numérico (ej: 1, "1", "1°")',
  }).transform((value) => normalizeGrade(value)),
  includeCapacity: z.any().optional().transform((value) => parseBoolean(value, true)),
});

export const levelLabels = {
  INITIAL: 'INICIAL',
  PRIMARY: 'PRIMARIA',
  SECONDARY: 'SECUNDARIA',
};
