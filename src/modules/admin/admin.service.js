import mongoose from 'mongoose';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { BillingSchedule } from '../../models/billingSchedule.model.js';
import { AttendancePolicy } from '../../models/attendancePolicy.model.js';
import { AttendanceSession } from '../../models/attendanceSession.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AttendanceMonthlySummary } from '../../models/attendanceMonthlySummary.model.js';
import { Student } from '../../models/student.model.js';
import { Person } from '../../models/person.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Program } from '../../models/program.model.js';
import { ProgramEnrollment } from '../../models/programEnrollment.model.js';
import { ProgramSession } from '../../models/programSession.model.js';
import { allEndpointMetadata, validateEndpointMetadataShape, warnMetadataWithoutRoute } from '../../admin/endpointMetadataRegistry.js';
import { ApiError } from '../../utils/errors.js';
import { getEnrollmentContextMapByStudentIds } from '../../shared/enrollmentCurrent.js';
import { createStudentService } from '../students/students.service.js';

// Servicios del módulo de administración

export async function createCampus(data) {
  const campus = new Campus(data);
  return campus.save();
}

export async function listCampuses() {
  return Campus.find();
}

export async function createCycle(data) {
  // Convertir fechas a objetos Date
  const cycle = new Cycle({
    ...data,
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
  });
  return cycle.save();
}

export async function listCycles() {
  return Cycle.find();
}

export async function createClassroom(data) {
  const classroom = new Classroom(data);
  return classroom.save();
}

export async function listClassrooms() {
  return Classroom.find().populate('campusId').populate('cycleId');
}

export async function updateClassroom(classroomId, data) {
  const classroom = await Classroom.findById(classroomId);
  if (!classroom) throw new ApiError(404, 'Salon no encontrado');

  const nextValues = {
    campusId: data.campusId ?? classroom.campusId,
    cycleId: data.cycleId ?? classroom.cycleId,
    level: data.level ?? classroom.level,
    grade: data.grade ?? classroom.grade,
    section: data.section ?? classroom.section,
    capacity: data.capacity ?? classroom.capacity,
    displayName: data.displayName ?? classroom.displayName,
    isActive: data.isActive ?? classroom.isActive,
    notes: data.notes ?? classroom.notes ?? '',
  };

  classroom.set(nextValues);
  await classroom.save();

  return Classroom.findById(classroom._id).populate('campusId').populate('cycleId');
}

export async function createProgram({ name, notes, cycleId }) {
  const cycle = await Cycle.findById(cycleId);
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

  return Program.create({
    name,
    notes: notes || '',
    campusId: null,
    cycleId: cycle._id,
    isActive: true,
  });
}

export async function listPrograms() {
  const programs = await Program.find()
    .populate('campusId')
    .populate('cycleId')
    .sort({ _id: -1 })
    .lean();

  const programIds = programs.map((row) => row._id);
  const counts = programIds.length
    ? await ProgramEnrollment.aggregate([
      { $match: { programId: { $in: programIds }, isActive: true } },
      { $group: { _id: '$programId', studentsCount: { $sum: 1 } } },
    ])
    : [];
  const countMap = new Map(counts.map((row) => [String(row._id), Number(row.studentsCount || 0)]));

  return programs.map((program) => ({
    id: String(program._id),
    name: program.name,
    notes: program.notes || '',
    isActive: Boolean(program.isActive),
    campus: program.campusId ? {
      id: String(program.campusId._id),
      code: program.campusId.code || null,
      name: program.campusId.name || program.campusId.code || null,
    } : null,
    cycle: program.cycleId ? {
      id: String(program.cycleId._id),
      name: program.cycleId.name || null,
    } : null,
    studentsCount: countMap.get(String(program._id)) || 0,
  }));
}

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && value.toString) return Number(value.toString());
  return 0;
}

function applyProgramSessionEntry(sessionDoc, entryPayload) {
  const entries = Array.isArray(sessionDoc.entries) ? sessionDoc.entries : [];
  const existing = entries.find((row) => String(row.programEnrollmentId) === String(entryPayload.programEnrollmentId));
  if (existing) {
    existing.studentId = entryPayload.studentId;
    existing.attended = entryPayload.attended;
    existing.paymentStatus = entryPayload.paymentStatus;
    existing.paymentAmount = entryPayload.paymentAmount;
    existing.paymentMethod = entryPayload.paymentMethod;
    existing.receivedBy = entryPayload.receivedBy ?? null;
    existing.notes = entryPayload.notes || '';
    return;
  }

  entries.push(entryPayload);
  sessionDoc.entries = entries;
}

export async function getProgramDetail(programId) {
  const program = await Program.findById(programId)
    .populate('campusId')
    .populate('cycleId')
    .lean();

  if (!program) throw new ApiError(404, 'Programa no encontrado');

  const enrollments = await ProgramEnrollment.find({ programId: program._id, isActive: true })
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate({ path: 'classroomId', populate: { path: 'campusId' } })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  const sessions = await ProgramSession.find({ programId: program._id })
    .sort({ date: -1, _id: -1 })
    .lean();

  const studentIds = enrollments.map((row) => row.studentId?._id).filter(Boolean);
  const contexts = studentIds.length
    ? await getEnrollmentContextMapByStudentIds(studentIds, { cycleId: program.cycleId?._id || program.cycleId || null })
    : new Map();

  return {
    program: {
      id: String(program._id),
      name: program.name,
      notes: program.notes || '',
      isActive: Boolean(program.isActive),
      campus: program.campusId ? {
        id: String(program.campusId._id),
        code: program.campusId.code || null,
        name: program.campusId.name || program.campusId.code || null,
      } : null,
      cycle: program.cycleId ? {
        id: String(program.cycleId._id),
        name: program.cycleId.name || null,
      } : null,
    },
    students: enrollments.map((row) => {
      const student = row.studentId || {};
      const person = student.personId || {};
      const fallbackClassroom = row.classroomId || null;
      const context = contexts.get(String(student._id)) || null;
      const classroom = fallbackClassroom || context?.classroom || null;
      const campus = fallbackClassroom?.campusId || context?.campus || null;

      return {
        programEnrollmentId: String(row._id),
        studentId: student._id ? String(student._id) : null,
        student: {
          names: person.names || null,
          lastNames: person.lastNames || null,
          fullName: [person.lastNames, person.names].filter(Boolean).join(', '),
          dni: person.dni || null,
          internalCode: student.internalCode || null,
        },
        campus: campus ? {
          id: String(campus._id),
          code: campus.code || null,
          name: campus.name || campus.code || null,
        } : null,
        classroom: classroom ? {
          id: String(classroom._id),
          displayName: classroom.displayName || null,
          grade: classroom.grade || null,
          section: classroom.section || null,
        } : null,
        payment: {
          amount: toMoney(row.paymentAmount),
          method: row.paymentMethod || 'CASH',
          paymentDate: row.paymentDate || null,
        },
        notes: row.notes || '',
      };
    }),
    sessions: sessions.map((session) => ({
      id: String(session._id),
      date: session.date,
      notes: session.notes || '',
      wasHeld: Boolean(session.wasHeld),
      entriesCount: Array.isArray(session.entries) ? session.entries.length : 0,
      paidCount: Array.isArray(session.entries) ? session.entries.filter((entry) => entry.paymentStatus === 'PAID').length : 0,
      pendingCount: Array.isArray(session.entries) ? session.entries.filter((entry) => entry.paymentStatus !== 'PAID').length : 0,
      entries: (Array.isArray(session.entries) ? session.entries : []).map((entry) => ({
        id: String(entry._id),
        programEnrollmentId: String(entry.programEnrollmentId),
        studentId: String(entry.studentId),
        attended: Boolean(entry.attended),
        paymentStatus: entry.paymentStatus || 'PENDING',
        paymentAmount: toMoney(entry.paymentAmount),
        paymentMethod: entry.paymentMethod || 'PENDING',
        receivedBy: entry.receivedBy || null,
        notes: entry.notes || '',
      })),
    })),
  };
}

export async function getProgramSessionDetail(programId, sessionId) {
  const [program, session, enrollments] = await Promise.all([
    Program.findById(programId).populate('cycleId').lean(),
    ProgramSession.findById(sessionId).lean(),
    ProgramEnrollment.find({ programId, isActive: true })
      .populate({ path: 'studentId', populate: { path: 'personId' } })
      .populate({ path: 'classroomId', populate: { path: 'campusId' } })
      .sort({ _id: -1 })
      .lean(),
  ]);

  if (!program) throw new ApiError(404, 'Programa no encontrado');
  if (!session) throw new ApiError(404, 'Sesión no encontrada');
  if (String(session.programId) !== String(programId)) {
    throw new ApiError(404, 'La sesión no pertenece a este programa');
  }

  const entryMap = new Map((Array.isArray(session.entries) ? session.entries : []).map((entry) => [String(entry.programEnrollmentId), entry]));

  return {
    program: {
      id: String(program._id),
      name: program.name,
      notes: program.notes || '',
      cycle: program.cycleId ? {
        id: String(program.cycleId._id),
        name: program.cycleId.name || null,
      } : null,
    },
    session: {
      id: String(session._id),
      date: session.date,
      notes: session.notes || '',
      wasHeld: Boolean(session.wasHeld),
    },
    students: enrollments.map((row) => {
      const student = row.studentId || {};
      const person = student.personId || {};
      const classroom = row.classroomId || null;
      const campus = classroom?.campusId || null;
      const entry = entryMap.get(String(row._id)) || null;

      return {
        programEnrollmentId: String(row._id),
        studentId: student._id ? String(student._id) : null,
        student: {
          names: person.names || null,
          lastNames: person.lastNames || null,
          fullName: [person.lastNames, person.names].filter(Boolean).join(', '),
          dni: person.dni || null,
        },
        campus: campus ? {
          id: String(campus._id),
          code: campus.code || null,
          name: campus.name || campus.code || null,
        } : null,
        classroom: classroom ? {
          id: String(classroom._id),
          displayName: classroom.displayName || null,
        } : null,
        sessionEntry: entry ? {
          id: String(entry._id),
          attended: Boolean(entry.attended),
          paymentStatus: entry.paymentStatus || 'PENDING',
          paymentAmount: toMoney(entry.paymentAmount),
          paymentMethod: entry.paymentMethod || 'PENDING',
          receivedBy: entry.receivedBy || null,
          notes: entry.notes || '',
        } : null,
      };
    }),
  };
}

export async function addStudentToProgram(programId, payload) {
  const program = await Program.findById(programId).lean();
  if (!program) throw new ApiError(404, 'Programa no encontrado');

  let studentId = payload.existingStudentId;
  let classroomId = null;

  if (payload.newStudent) {
    classroomId = payload.newStudent.classroomId;
    let classroom = null;
    if (classroomId) {
      classroom = await Classroom.findById(classroomId).lean();
      if (!classroom) throw new ApiError(404, 'Salón no encontrado');
    }

    const externalSchoolName = String(payload.newStudent.otherSchoolName || '').trim();
    const externalGrade = String(payload.newStudent.grade || '').trim();
    const programNotes = ['Alta rápida para programa'];
    if (externalSchoolName) programNotes.push(`Colegio: ${externalSchoolName}`);
    if (externalGrade) programNotes.push(`Grado programa: ${externalGrade}`);

    const created = await createStudentService({
      person: {
        names: payload.newStudent.names,
        lastNames: payload.newStudent.lastNames,
        gender: 'F',
      },
      notes: programNotes.join(' | '),
    });
    studentId = created.studentId;

    if (!classroom && (externalSchoolName || externalGrade)) {
      await Student.updateOne(
        { _id: created.studentId },
        {
          $set: {
            previousCampus: externalSchoolName || 'OTHER',
          },
        }
      );
    }
  }

  const student = await Student.findById(studentId).populate('personId').lean();
  if (!student) throw new ApiError(404, 'Alumno no encontrado');

  const paymentDate = new Date(payload.paymentDate);
  if (Number.isNaN(paymentDate.getTime())) throw new ApiError(400, 'Fecha de pago inválida');

  const decimalAmount = mongoose.Types.Decimal128.fromString(String(payload.paymentAmount || 0));
  const enrollment = await ProgramEnrollment.findOneAndUpdate(
    { programId, studentId },
    {
      $set: {
        classroomId: classroomId || null,
        paymentAmount: decimalAmount,
        paymentMethod: payload.paymentMethod,
        paymentDate,
        notes: payload.notes || '',
        isActive: true,
      },
      $setOnInsert: {
        pricePerSession: mongoose.Types.Decimal128.fromString('0'),
      },
    },
    { new: true, upsert: true }
  )
    .populate({ path: 'classroomId', populate: { path: 'campusId' } })
    .lean();

  if (payload.sessionId) {
    const programSession = await ProgramSession.findOne({ _id: payload.sessionId, programId });
    if (!programSession) throw new ApiError(404, 'Sesión de programa no encontrada');

    const paid = Number(payload.paymentAmount || 0) > 0;
    applyProgramSessionEntry(programSession, {
      programEnrollmentId: enrollment._id,
      studentId: student._id,
      attended: payload.attended !== false,
      paymentStatus: paid ? 'PAID' : 'PENDING',
      paymentAmount: mongoose.Types.Decimal128.fromString(String(payload.paymentAmount || 0)),
      paymentMethod: paid ? payload.paymentMethod : 'PENDING',
      receivedBy: paid ? (payload.receivedBy || null) : null,
      notes: payload.notes || '',
    });
    programSession.wasHeld = true;
    await programSession.save();
  }

  return {
    programEnrollmentId: String(enrollment._id),
    studentId: String(student._id),
    student: {
      names: student.personId?.names || null,
      lastNames: student.personId?.lastNames || null,
      fullName: [student.personId?.lastNames, student.personId?.names].filter(Boolean).join(', '),
      dni: student.personId?.dni || null,
      internalCode: student.internalCode || null,
    },
    payment: {
      amount: toMoney(enrollment.paymentAmount),
      method: enrollment.paymentMethod || 'CASH',
      paymentDate: enrollment.paymentDate || null,
    },
  };
}

export async function createProgramSession(programId, payload) {
  const program = await Program.findById(programId).lean();
  if (!program) throw new ApiError(404, 'Programa no encontrado');

  const sessionDate = new Date(payload.date);
  if (Number.isNaN(sessionDate.getTime())) throw new ApiError(400, 'Fecha de sesión inválida');

  const item = await ProgramSession.findOneAndUpdate(
    { programId, date: sessionDate },
    {
      $set: {
        notes: payload.notes || '',
        wasHeld: true,
      },
      $setOnInsert: {
        programId,
        date: sessionDate,
      },
    },
    { new: true, upsert: true }
  ).lean();

  return {
    id: String(item._id),
    date: item.date,
    notes: item.notes || '',
    wasHeld: Boolean(item.wasHeld),
    entriesCount: Array.isArray(item.entries) ? item.entries.length : 0,
  };
}

export async function upsertProgramSessionEntry(programId, sessionId, payload) {
  const [programSession, enrollment] = await Promise.all([
    ProgramSession.findOne({ _id: sessionId, programId }),
    ProgramEnrollment.findOne({ _id: payload.programEnrollmentId, programId, isActive: true }).lean(),
  ]);

  if (!programSession) throw new ApiError(404, 'Sesión de programa no encontrada');
  if (!enrollment) throw new ApiError(404, 'Alumno del programa no encontrado');

  const paid = Number(payload.paymentAmount || 0) > 0;
  applyProgramSessionEntry(programSession, {
    programEnrollmentId: enrollment._id,
    studentId: enrollment.studentId,
    attended: payload.attended === true,
    paymentStatus: paid ? 'PAID' : 'PENDING',
    paymentAmount: mongoose.Types.Decimal128.fromString(String(payload.paymentAmount || 0)),
    paymentMethod: paid ? payload.paymentMethod : 'PENDING',
    receivedBy: paid ? (payload.receivedBy || null) : null,
    notes: payload.notes || '',
  });
  programSession.wasHeld = true;
  await programSession.save();

  const entry = programSession.entries.find((row) => String(row.programEnrollmentId) === String(enrollment._id));
  return {
    sessionId: String(programSession._id),
    entry: {
      id: String(entry._id),
      programEnrollmentId: String(entry.programEnrollmentId),
      studentId: String(entry.studentId),
      attended: Boolean(entry.attended),
      paymentStatus: entry.paymentStatus || 'PENDING',
      paymentAmount: toMoney(entry.paymentAmount),
      paymentMethod: entry.paymentMethod || 'PENDING',
      receivedBy: entry.receivedBy || null,
      notes: entry.notes || '',
    },
  };
}

export async function createBillingConcept(data) {
  const concept = new BillingConcept(data);
  return concept.save();
}

export async function listBillingConcepts() {
  return BillingConcept.find();
}

export async function upsertBillingSchedule({ cycleId, conceptCode, items }) {
  const cycle = await Cycle.findById(cycleId);
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

  const concept = await BillingConcept.findOne({ code: conceptCode });
  if (!concept) throw new ApiError(404, `BillingConcept no encontrado: ${conceptCode}`);

  const seen = new Set();
  for (const item of items) {
    const key = item.monthIndex === null ? 'null' : String(item.monthIndex);
    if (seen.has(key)) throw new ApiError(400, `monthIndex duplicado en items: ${key}`);
    seen.add(key);
  }

  await BillingSchedule.deleteMany({ cycleId: cycle._id, conceptCode });

  const docs = items.map((item) => ({
    cycleId: cycle._id,
    conceptCode,
    monthIndex: item.monthIndex,
    label: item.label || '',
    dueDate: new Date(item.dueDate),
  }));

  await BillingSchedule.insertMany(docs);

  return BillingSchedule.find({ cycleId: cycle._id, conceptCode }).sort({ monthIndex: 1, dueDate: 1 }).lean();
}

export async function getBillingSchedule({ cycleId, conceptCode }) {
  const schedule = await BillingSchedule.find({ cycleId, conceptCode })
    .sort({ monthIndex: 1, dueDate: 1 })
    .lean();

  return {
    cycleId,
    conceptCode,
    items: schedule.map((row) => ({
      monthIndex: row.monthIndex ?? null,
      label: row.label || '',
      dueDate: row.dueDate,
    })),
  };
}

function mapAttendancePolicy(policy) {
  if (!policy) return null;

  return {
    id: String(policy._id),
    campusId: String(policy.campusId),
    cycleId: String(policy.cycleId),
    level: policy.level || null,
    name: policy.name,
    defaultOnTimeUntil: policy.defaultOnTimeUntil,
    notes: policy.notes || '',
    isActive: Boolean(policy.isActive),
    updatedAt: policy.updatedAt,
  };
}

export async function getAttendancePolicy({ campusId, cycleId, level }) {
  const policy = await AttendancePolicy.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  return { item: mapAttendancePolicy(policy) };
}

export async function upsertAttendancePolicy({ campusId, cycleId, level, name, defaultOnTimeUntil, notes }, user) {
  const payload = {
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
    name,
    defaultOnTimeUntil,
    notes: notes || null,
    updatedByUserId: user.id,
  };

  const existing = await AttendancePolicy.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level,
    classroomId: null,
    programId: null,
    isActive: true,
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (existing) {
    existing.set(payload);
    await existing.save();
    return { item: mapAttendancePolicy(existing.toObject()) };
  }

  const created = await AttendancePolicy.create({
    ...payload,
    createdByUserId: user.id,
  });

  return { item: mapAttendancePolicy(created.toObject()) };
}

function slugifyFilePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'todos';
}

function formatDateForFileName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function levelToSpanish(level) {
  const safeLevel = String(level || '').toUpperCase();
  if (safeLevel === 'INITIAL') return 'INICIAL';
  if (safeLevel === 'PRIMARY') return 'PRIMARIA';
  if (safeLevel === 'SECONDARY') return 'SECUNDARIA';
  return '';
}

function csvEscape(value) {
  const safeValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function ensureCampusScopeAccess({ requestedCampus, user }) {
  if (!requestedCampus) return;
  const campusScope = Array.isArray(user?.campusScope) ? user.campusScope : [];
  if (!campusScope.length || campusScope.includes('ALL')) return;
  if (!campusScope.includes(requestedCampus)) {
    throw new ApiError(403, 'No autorizado para exportar alumnos de este campus');
  }
}

function getAllowedCampusCodes(user) {
  const campusScope = Array.isArray(user?.campusScope) ? user.campusScope : [];
  if (!campusScope.length || campusScope.includes('ALL')) return null;
  return new Set(campusScope.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean));
}

const COMPOUND_SURNAME_PARTICLES = new Set([
  'DE',
  'DEL',
  'DELA',
  'DE LA',
  'DE LAS',
  'DE LOS',
  'LA',
  'LAS',
  'LOS',
  'SAN',
  'SANTA',
  'VAN',
  'VON',
  'MC',
  'MAC',
]);

function splitNames(rawNames) {
  const tokens = String(rawNames || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase());

  if (!tokens.length) {
    return { firstName: '', secondName: '' };
  }

  return {
    firstName: tokens[0] || '',
    secondName: tokens.slice(1).join(' '),
  };
}

function isSurnameParticle(token) {
  return COMPOUND_SURNAME_PARTICLES.has(String(token || '').trim().toUpperCase());
}

function splitLastNames(rawLastNames) {
  const tokens = String(rawLastNames || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toUpperCase());

  if (!tokens.length) {
    return { paternalLastName: '', maternalLastName: '' };
  }

  if (tokens.length === 1) {
    return { paternalLastName: tokens[0], maternalLastName: '' };
  }

  if (tokens.length === 2) {
    return { paternalLastName: tokens[0], maternalLastName: tokens[1] };
  }

  if (isSurnameParticle(tokens[0])) {
    return {
      paternalLastName: tokens.slice(0, -1).join(' ').trim(),
      maternalLastName: tokens[tokens.length - 1] || '',
    };
  }

  const paternalTokens = [];
  const maternalTokens = [];

  let index = 0;
  paternalTokens.push(tokens[index]);
  index += 1;

  while (index < tokens.length - 1 && isSurnameParticle(tokens[index])) {
    paternalTokens.push(tokens[index]);
    index += 1;
    if (index < tokens.length - 1) {
      paternalTokens.push(tokens[index]);
      index += 1;
    }
  }

  maternalTokens.push(...tokens.slice(index));

  return {
    paternalLastName: paternalTokens.join(' ').trim(),
    maternalLastName: maternalTokens.join(' ').trim(),
  };
}

function extractPensionAmount(enrollmentStudent) {
  const amounts = Array.isArray(enrollmentStudent?.pensionMonthlyAmounts)
    ? enrollmentStudent.pensionMonthlyAmounts
    : [];

  const firstValid = amounts.find((value) => Number.isFinite(Number(value)) && Number(value) >= 0);
  if (firstValid === undefined) return '';
  return String(Number(firstValid));
}

async function resolveExportCycle(cycleId) {
  if (cycleId) {
    const explicitCycle = await Cycle.findById(cycleId).lean();
    if (!explicitCycle) throw new ApiError(404, 'Ciclo no encontrado');
    return explicitCycle;
  }

  const currentDate = new Date();
  const activeCycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: currentDate },
    endDate: { $gte: currentDate },
  })
    .sort({ startDate: -1, _id: -1 })
    .lean();

  if (activeCycle) return activeCycle;

  const fallbackCycle = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .lean();

  if (!fallbackCycle) throw new ApiError(404, 'No hay ciclo escolar activo para exportar');
  return fallbackCycle;
}

export async function buildCajaArequipaExport({ query, user }) {
  const requestedCampus = query?.campus ? String(query.campus).trim().toUpperCase() : null;
  ensureCampusScopeAccess({ requestedCampus, user });
  const allowedCampusCodes = getAllowedCampusCodes(user);

  const cycle = await resolveExportCycle(query?.cycleId || null);

  const campusDoc = requestedCampus
    ? await Campus.findOne({ code: requestedCampus }).select('_id code name').lean()
    : null;

  if (requestedCampus && !campusDoc) {
    throw new ApiError(404, 'Campus no encontrado');
  }

  const students = await Student.find({ activeStatus: 'ACTIVE' })
    .select('_id personId bankCode')
    .lean();

  const studentIds = students.map((student) => String(student._id));
  const contextMap = await getEnrollmentContextMapByStudentIds(studentIds, { cycleId: cycle._id });

  const exportableStudents = [];
  for (const student of students) {
    const context = contextMap.get(String(student._id));
    if (!context?.classroom || !context?.campus) continue;
    if (allowedCampusCodes && !allowedCampusCodes.has(String(context.campus.code || '').toUpperCase())) continue;
    if (campusDoc && String(context.campus._id) !== String(campusDoc._id)) continue;
    exportableStudents.push({ student, context });
  }

  const personIds = exportableStudents.map(({ student }) => student.personId).filter(Boolean);
  const people = personIds.length
    ? await Person.find({ _id: { $in: personIds } }).select('_id names lastNames').lean()
    : [];
  const personById = new Map(people.map((person) => [String(person._id), person]));

  const rows = exportableStudents
    .map(({ student, context }) => {
      const person = personById.get(String(student.personId)) || {};
      const classroom = context.classroom || null;
      const enrollmentStudent = context.enrollmentStudent || null;
      const { firstName, secondName } = splitNames(person.names);
      const { paternalLastName, maternalLastName } = splitLastNames(person.lastNames);

      return {
        bankCode: String(student.bankCode || '').trim(),
        institutionCode: '',
        firstName,
        secondName,
        paternalLastName,
        maternalLastName,
        classification1: levelToSpanish(classroom?.level),
        classification2: String(classroom?.grade || '').trim(),
        classification3: String(classroom?.section || '').trim().toUpperCase(),
        enrollmentFee: '',
        pension: extractPensionAmount(enrollmentStudent),
        period: '',
        levelOrder: classroom?.level === 'INITIAL' ? 1 : classroom?.level === 'PRIMARY' ? 2 : classroom?.level === 'SECONDARY' ? 3 : 99,
        gradeOrder: Number(classroom?.grade) || 999,
        sectionOrder: String(classroom?.section || '').trim().toUpperCase(),
        sortName: `${paternalLastName} ${maternalLastName} ${firstName} ${secondName}`.trim(),
      };
    })
    .sort((a, b) => {
      if (a.levelOrder !== b.levelOrder) return a.levelOrder - b.levelOrder;
      if (a.gradeOrder !== b.gradeOrder) return a.gradeOrder - b.gradeOrder;
      if (a.sectionOrder !== b.sectionOrder) return a.sectionOrder.localeCompare(b.sectionOrder, 'es');
      return a.sortName.localeCompare(b.sortName, 'es');
    });

  const header = [
    'CODIGO CAJA',
    'CÓDIGO INSTITUCIÓN',
    '1ER NOMBRE',
    '2DO NOMBRE',
    'APELLIDO PATERNO',
    'APELLIDO MATERNO',
    'CLASIFICACION1',
    'CLASIFICACION2',
    'CLASIFICACION3',
    'MATRICULA',
    'PENSION',
    'PERIODO',
  ];
  const body = rows.map((row) => [
    row.bankCode,
    row.institutionCode,
    row.firstName,
    row.secondName,
    row.paternalLastName,
    row.maternalLastName,
    row.classification1,
    row.classification2,
    row.classification3,
    row.enrollmentFee,
    row.pension,
    row.period,
  ].map(csvEscape).join(','));
  const content = `\uFEFF${[header.join(','), ...body].join('\r\n')}`;

  return {
    fileName: `caja-arequipa-${slugifyFilePart(requestedCampus || 'todos')}-${formatDateForFileName()}.csv`,
    rowCount: rows.length,
    content,
    cycle: {
      id: String(cycle._id),
      name: cycle.name,
      year: cycle.year,
    },
    campus: campusDoc ? { id: String(campusDoc._id), code: campusDoc.code, name: campusDoc.name } : null,
  };
}

function parseDateOnlyStart(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function parseDateOnlyEndExclusive(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
}

function getYearMonth(value) {
  const date = new Date(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function buildSummaryDelta(record) {
  const status = String(record?.status || '').toUpperCase();
  const justificationStatus = String(record?.justificationStatus || '').toUpperCase();
  return {
    presentCount: status === 'PRESENT' ? 1 : 0,
    lateCount: status === 'LATE' ? 1 : 0,
    absentCount: status === 'ABSENT' ? 1 : 0,
    justifiedLateCount: status === 'LATE' && justificationStatus === 'JUSTIFIED' ? 1 : 0,
    justifiedAbsentCount: status === 'ABSENT' && justificationStatus === 'JUSTIFIED' ? 1 : 0,
  };
}

function toSessionStatusSummaryMap(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    map.set(String(row._id), {
      recordsCount: Number(row.recordsCount || 0),
      presentCount: Number(row.presentCount || 0),
      lateCount: Number(row.lateCount || 0),
      absentCount: Number(row.absentCount || 0),
      justifiedCount: Number(row.justifiedCount || 0),
    });
  });
  return map;
}

export async function listAttendanceSessionsForAdmin(query = {}) {
  const limit = Number(query.limit || 80);
  const filters = {};

  if (query.campusId) filters.campusId = query.campusId;
  if (query.cycleId) filters.cycleId = query.cycleId;
  if (query.status) filters.status = query.status;

  if (query.dateFrom || query.dateTo) {
    filters.date = {};
    if (query.dateFrom) filters.date.$gte = parseDateOnlyStart(query.dateFrom);
    if (query.dateTo) filters.date.$lt = parseDateOnlyEndExclusive(query.dateTo);
  }

  const sessions = await AttendanceSession.find(filters)
    .populate('campusId', '_id code name')
    .populate('cycleId', '_id name year')
    .sort({ date: -1, openedAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  const sessionIds = sessions.map((session) => session._id);
  const grouped = sessionIds.length
    ? await AttendanceRecord.aggregate([
      { $match: { sessionId: { $in: sessionIds } } },
      {
        $group: {
          _id: '$sessionId',
          recordsCount: { $sum: 1 },
          presentCount: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
          lateCount: { $sum: { $cond: [{ $eq: ['$status', 'LATE'] }, 1, 0] } },
          absentCount: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
          justifiedCount: { $sum: { $cond: [{ $eq: ['$justificationStatus', 'JUSTIFIED'] }, 1, 0] } },
        },
      },
    ])
    : [];

  const summaryBySession = toSessionStatusSummaryMap(grouped);
  return {
    items: sessions.map((session) => {
      const summary = summaryBySession.get(String(session._id)) || {
        recordsCount: 0,
        presentCount: 0,
        lateCount: 0,
        absentCount: 0,
        justifiedCount: 0,
      };
      return {
        id: String(session._id),
        scopeType: session.scopeType,
        status: session.status,
        date: session.date,
        expectedStartTime: session.expectedStartTime || null,
        onTimeUntil: session.onTimeUntil || null,
        lateUntil: session.lateUntil || null,
        openedAt: session.openedAt || null,
        closedAt: session.closedAt || null,
        notes: session.notes || '',
        campus: session.campusId ? {
          id: String(session.campusId._id),
          code: session.campusId.code || null,
          name: session.campusId.name || session.campusId.code || null,
        } : null,
        cycle: session.cycleId ? {
          id: String(session.cycleId._id),
          name: session.cycleId.name || null,
          year: session.cycleId.year || null,
        } : null,
        records: summary,
      };
    }),
    meta: {
      total: sessions.length,
      limit,
      filters: {
        campusId: query.campusId || null,
        cycleId: query.cycleId || null,
        status: query.status || null,
        dateFrom: query.dateFrom || null,
        dateTo: query.dateTo || null,
      },
    },
  };
}

export async function deleteAttendanceSessionForAdmin(sessionId, user) {
  const session = await AttendanceSession.findById(sessionId).lean();
  if (!session) {
    throw new ApiError(404, 'Sesión de asistencia no encontrada');
  }

  const records = await AttendanceRecord.find({ sessionId: session._id })
    .select('_id studentId status justificationStatus')
    .lean();

  const studentIds = [...new Set(records.map((row) => String(row.studentId)).filter(Boolean))];
  const vacancies = studentIds.length
    ? await Vacancy.find({ cycleId: session.cycleId, studentId: { $in: studentIds } })
      .select('studentId classroomId')
      .lean()
    : [];
  const classroomByStudentId = new Map(vacancies.map((row) => [String(row.studentId), row.classroomId ? String(row.classroomId) : null]));

  const { year, month } = getYearMonth(session.date);
  const summaryOpsByKey = new Map();

  records.forEach((record) => {
    const classroomId = classroomByStudentId.get(String(record.studentId)) || null;
    const key = [
      String(record.studentId),
      String(session.campusId),
      String(session.cycleId),
      String(year),
      String(month),
      classroomId || 'null',
    ].join('|');
    const current = summaryOpsByKey.get(key) || {
      studentId: record.studentId,
      campusId: session.campusId,
      cycleId: session.cycleId,
      year,
      month,
      classroomId: classroomId ? new mongoose.Types.ObjectId(classroomId) : null,
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    };

    const delta = buildSummaryDelta(record);
    current.presentCount += delta.presentCount;
    current.lateCount += delta.lateCount;
    current.absentCount += delta.absentCount;
    current.justifiedLateCount += delta.justifiedLateCount;
    current.justifiedAbsentCount += delta.justifiedAbsentCount;
    summaryOpsByKey.set(key, current);
  });

  const summaryOps = Array.from(summaryOpsByKey.values());
  if (summaryOps.length) {
    await AttendanceMonthlySummary.bulkWrite(
      summaryOps.map((item) => ({
        updateOne: {
          filter: {
            studentId: item.studentId,
            campusId: item.campusId,
            cycleId: item.cycleId,
            year: item.year,
            month: item.month,
            classroomId: item.classroomId,
          },
          update: {
            $inc: {
              presentCount: -item.presentCount,
              lateCount: -item.lateCount,
              absentCount: -item.absentCount,
              justifiedLateCount: -item.justifiedLateCount,
              justifiedAbsentCount: -item.justifiedAbsentCount,
            },
            $set: { updatedAt: new Date() },
          },
          upsert: false,
        },
      })),
      { ordered: false }
    );

    await Promise.all(summaryOps.map((item) => AttendanceMonthlySummary.deleteMany({
      studentId: item.studentId,
      campusId: item.campusId,
      cycleId: item.cycleId,
      year: item.year,
      month: item.month,
      classroomId: item.classroomId,
      presentCount: { $lte: 0 },
      lateCount: { $lte: 0 },
      absentCount: { $lte: 0 },
      justifiedLateCount: { $lte: 0 },
      justifiedAbsentCount: { $lte: 0 },
    })));
  }

  const [recordsDeleteResult, sessionDeleteResult] = await Promise.all([
    AttendanceRecord.deleteMany({ sessionId: session._id }),
    AttendanceSession.deleteOne({ _id: session._id }),
  ]);

  return {
    message: 'Sesión eliminada correctamente',
    deletedSessionId: String(session._id),
    deletedByUserId: user?.id || (user?._id ? String(user._id) : null),
    stats: {
      deletedRecords: Number(recordsDeleteResult.deletedCount || 0),
      deletedSessions: Number(sessionDeleteResult.deletedCount || 0),
      adjustedSummaryRows: summaryOps.length,
    },
  };
}

function normalizePath(basePath, routePath) {
  const rawRoutePath = Array.isArray(routePath) ? routePath.join('|') : String(routePath || '');
  return `${basePath}${rawRoutePath === '/' ? '' : rawRoutePath}`;
}

function extractRouterEndpoints(mount, metadataByKey) {
  const entries = [];

  for (const layer of mount.router.stack || []) {
    if (!layer.route) continue;

    const methods = Object.keys(layer.route.methods || {})
      .filter((method) => layer.route.methods[method])
      .map((method) => method.toUpperCase());

    for (const method of methods) {
      const path = normalizePath(mount.basePath, layer.route.path);
      const key = `${method} ${path}`;
      const metadata = metadataByKey.get(key);

      entries.push({
        method,
        path,
        module: mount.module || 'unknown',
        authRequired: mount.authRequired ?? null,
        rolesAllowed: null,
        description: `${method} ${path}`,
        requestSchema: null,
        responseSchema: null,
        ...(metadata ? {
          module: metadata.module || mount.module || 'unknown',
          authRequired: metadata.authRequired ?? (mount.authRequired ?? null),
          rolesAllowed: metadata.rolesAllowed ?? null,
          description: metadata.description || `${method} ${path}`,
          requestSchema: metadata.requestSchema ?? null,
          responseSchema: metadata.responseSchema ?? null,
        } : { metadataMissing: true }),
      });
    }
  }

  return entries;
}

export async function listAvailableEndpoints(app) {
  const mounts = app?.locals?.routeCatalogMounts || [];

  validateEndpointMetadataShape(allEndpointMetadata);
  const metadataByKey = new Map(
    allEndpointMetadata.map((entry) => [`${String(entry.method || '').toUpperCase()} ${entry.path}`, { ...entry, method: String(entry.method || '').toUpperCase() }])
  );

  const items = [
    {
      method: 'GET',
      path: '/health',
      module: 'core',
      authRequired: false,
      rolesAllowed: null,
      description: 'Health check',
      requestSchema: null,
      responseSchema: { ok: 'boolean' },
      metadataMissing: true,
    },
  ];

  for (const mount of mounts) {
    items.push(...extractRouterEndpoints(mount, metadataByKey));
  }

  warnMetadataWithoutRoute({ metadata: allEndpointMetadata, routeCatalog: items });

  items.sort((a, b) => {
    if (a.path === b.path) return a.method.localeCompare(b.method);
    return a.path.localeCompare(b.path);
  });

  return items;
}

async function loadAllModelFiles() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const modelsDir = path.resolve(path.dirname(currentFilePath), '../../models');
  const files = await readdir(modelsDir);

  const modelFiles = files.filter((fileName) => fileName.endsWith('.model.js'));

  for (const fileName of modelFiles) {
    const absolutePath = path.join(modelsDir, fileName);
    await import(pathToFileURL(absolutePath).href);
  }
}

function getFieldMetadata(schemaType) {
  const options = schemaType.options || {};
  const baseMetadata = {
    type: schemaType.instance || 'Mixed',
    required: Boolean(options.required),
    unique: Boolean(options.unique),
    index: Boolean(options.index),
    ref: options.ref || null,
    enum: options.enum || null,
    default: options.default === undefined ? null : options.default,
  };

  if (schemaType.instance === 'Array') {
    const itemType = schemaType.caster?.instance || 'Mixed';
    baseMetadata.type = `Array<${itemType}>`;
    baseMetadata.ref = schemaType.caster?.options?.ref || options.ref || null;
  }

  return baseMetadata;
}

export async function listModelsCatalog() {
  await loadAllModelFiles();

  const models = mongoose.modelNames().map((modelName) => {
    const model = mongoose.model(modelName);

    const attributes = Object.entries(model.schema.paths)
      .map(([fieldName, schemaType]) => ({
        name: fieldName,
        ...getFieldMetadata(schemaType),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      model: model.modelName,
      collection: model.collection.collectionName,
      attributes,
    };
  });

  return models.sort((a, b) => a.model.localeCompare(b.model));
}
