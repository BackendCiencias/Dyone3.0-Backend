import { z } from 'zod';

// Schema de persona reutilizable
const personSchema = z.object({
  names: z.string().min(1),
  lastNames: z.string().min(1),
  dni: z.string().min(1),
  gender: z.enum(['Masculino', 'Femenino']),
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

// Esquema principal de matrícula
export const enrollmentCreateSchema = z.object({
  campusId: z.string().min(1),
  cycleId: z.string().min(1),
  originSchool: z.string().min(1),
  students: z.array(enrollmentStudentSchema).min(1),
  contractNumber: z.string().optional(),
  notes: z.string().optional(),
});