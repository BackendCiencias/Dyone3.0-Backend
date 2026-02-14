import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Family } from '../../models/family.model.js';
import { Counter } from '../../models/counter.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Payment } from '../../models/payment.model.js';
import { Charge } from '../../models/charge.model.js';
import { ApiError } from '../../utils/errors.js';

function normalizeDni(dni) {
  const normalized = String(dni || '').trim();
  if (!normalized) return undefined;
  const lowered = normalized.toLowerCase();
  if (['null', 'undefined', 'n/a', 'na', '-'].includes(lowered)) return undefined;
  return normalized;
}

async function nextStudentCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'student_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `COD_A${String(counter.seq).padStart(5, '0')}`;
}

async function resolveCurrentCycle(session) {
  const now = new Date();
  const cycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort({ startDate: -1 })
    .session(session);

  if (cycle) return cycle;

  const fallback = await Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true })
    .sort({ startDate: -1 })
    .session(session);

  if (!fallback) {
    throw new ApiError(400, 'No hay ciclo escolar activo para crear StudentCycle');
  }

  return fallback;
}

async function resolveOrCreatePerson(person, session) {
  const dni = normalizeDni(person.dni);

  let personDoc = null;
  if (dni) {
    personDoc = await Person.findOne({ dni }).session(session);
  }

  if (!personDoc) {
    personDoc = new Person({
      ...person,
      ...(dni ? { dni } : {}),
      ...(dni ? {} : { dni: undefined }),
    });
    await personDoc.save({ session });
    return personDoc;
  }

  const setUpdates = {};
  if (person.names && personDoc.names !== person.names) setUpdates.names = person.names;
  if (person.lastNames && personDoc.lastNames !== person.lastNames) setUpdates.lastNames = person.lastNames;
  if (person.gender && personDoc.gender !== person.gender) setUpdates.gender = person.gender;
  if (person.phone && personDoc.phone !== person.phone) setUpdates.phone = person.phone;
  if (person.address && personDoc.address !== person.address) setUpdates.address = person.address;
  if (person.email && personDoc.email !== person.email) setUpdates.email = person.email;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: personDoc._id }, { $set: setUpdates }, { session });
  }

  return personDoc;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && value.toString) return Number(value.toString());
  return 0;
}


const CAMPUS_ALIAS = {
  CIMAS: ['CIMAS'],
  CIENCIAS: ['CIENCIAS'],
  CIENCIAS_APLICADAS: ['CIENCIAS_APLICADAS'],
};

const CAMPUS_LEGACY_NORMALIZATION = {
  CIENCIAS_PRI: 'CIENCIAS',
  CIENCIAS_SEC: 'CIENCIAS',
};

const CAMPUS_ACCESS_BY_ROLE = {
  SECRETARY_CIMAS: ['CIMAS'],
  SECRETARY_CIENCIAS_SEC: ['CIENCIAS'],
  SECRETARY_CIENCIAS_PRIM: ['CIENCIAS'],
  SECRETARY_CIENCIAS: ['CIENCIAS'],
  SECRETARY_APLICADAS: ['CIENCIAS_APLICADAS'],
};

export function getAllowedCampusesFromRoles(roles = []) {
  const normalizedRoles = Array.isArray(roles) ? roles : [];

  if (normalizedRoles.includes('ADMIN') || normalizedRoles.includes('PROMOTER')) return ['*'];
  if (normalizedRoles.includes('SECRETARY')) return ['*'];

  const campuses = new Set();
  for (const role of normalizedRoles) {
    const roleCampuses = CAMPUS_ACCESS_BY_ROLE[role];
    if (roleCampuses) {
      for (const campus of roleCampuses) campuses.add(campus);
    }
  }

  return [...campuses];
}

function ensureCampusAccess({ campus, roles }) {
  const allowedCampuses = getAllowedCampusesFromRoles(roles);
  if (allowedCampuses.includes('*')) return;
  if (!allowedCampuses.includes(campus)) {
    throw new ApiError(403, 'No autorizado para consultar este campus');
  }
}

function resolveCampusCodes(campus) {
  const raw = String(campus || '').trim().toUpperCase();
  const normalized = CAMPUS_LEGACY_NORMALIZATION[raw] || raw;
  const codes = CAMPUS_ALIAS[normalized];
  if (!codes) {
    throw new ApiError(400, 'campus inválido. Usa CIENCIAS, CIMAS o CIENCIAS_APLICADAS');
  }
  return { normalized, codes };
}

async function buildStudentResponse(items) {
  const studentIds = items.map((row) => row._id);
  const vacancies = await Vacancy.find({ studentId: { $in: studentIds } })
    .sort({ startDate: -1 })
    .populate({ path: 'classroomId', populate: { path: 'campusId' } })
    .lean();

  const vacancyByStudent = new Map();
  for (const vacancy of vacancies) {
    const key = String(vacancy.studentId);
    if (!vacancyByStudent.has(key)) vacancyByStudent.set(key, vacancy);
  }

  return items.map((student) => {
    const person = student.personId;
    const vacancy = vacancyByStudent.get(String(student._id));
    const classroom = vacancy?.classroomId;
    const campus = classroom?.campusId;

    return {
      id: student._id.toString(),
      dni: person?.dni || null,
      names: person?.names || null,
      lastNames: person?.lastNames || null,
      code: student.internalCode || null,
      campusCode: campus?.code || null,
      lastKnownGrade: classroom?.grade || null,
      lastKnownSection: classroom?.section || null,
      classroomName:classroom?.displayName || null,
      isActive: student.isActive,
    };
  });
}

export async function createStudentService({ person, familyId, classroomId, entryDate, notes }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const classroom = await Classroom.findById(classroomId).session(session);
    if (!classroom) {
      throw new ApiError(404, 'Classroom no encontrado');
    }

    const personDoc = await resolveOrCreatePerson(person, session);

    let family = null;
    if (familyId) {
      family = await Family.findById(familyId).session(session);
      if (!family) throw new ApiError(404, 'Familia no encontrada');
    } else {
      family = new Family({ tutorIds: [], studentIds: [], notes: 'Stub creado desde POST /api/students' });
      await family.save({ session });
    }

    const existingStudent = await Student.findOne({ personId: personDoc._id }).session(session);
    if (existingStudent) {
      throw new ApiError(409, 'Ya existe un alumno para esta persona');
    }

    const internalCode = await nextStudentCode(session);

    const student = await Student.create([
      {
        personId: personDoc._id,
        familyId: family._id,
        internalCode,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        notes,
      },
    ], { session });

    const studentDoc = student[0];

    await Family.updateOne({ _id: family._id }, { $addToSet: { studentIds: studentDoc._id } }, { session });

    const cycle = await resolveCurrentCycle(session);

    await StudentCycle.updateOne(
      { studentId: studentDoc._id, cycleId: cycle._id, campusId: classroom.campusId },
      {
        $setOnInsert: {
          studentId: studentDoc._id,
          cycleId: cycle._id,
          campusId: classroom.campusId,
          status: 'ABSENT',
        },
      },
      { upsert: true, session }
    );

    await Vacancy.updateOne(
      { studentId: studentDoc._id, cycleId: cycle._id },
      {
        $set: {
          classroomId: classroom._id,
          endDate: null,
          notes: notes || undefined,
        },
        $setOnInsert: {
          studentId: studentDoc._id,
          cycleId: cycle._id,
          startDate: new Date(),
        },
      },
      { upsert: true, session }
    );

    await session.commitTransaction();

    return Student.findById(studentDoc._id)
      .populate('personId')
      .populate('familyId');
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function findStudentByDniService(dni) {
  const person = await Person.findOne({ dni });
  if (!person) return null;
  const student = await Student.findOne({ personId: person._id }).populate('personId').populate('familyId');
  return student;
}

export async function searchStudentsService({ q, limit = 20, cursor }) {
  const term = String(q || '').trim();
  if (!term) throw new ApiError(400, 'q es requerido');

  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));
  const regex = new RegExp(escapeRegExp(term), 'i');

  const people = await Person.find({
    $or: [{ dni: regex }, { names: regex }, { lastNames: regex }],
  }).select('_id').lean();

  const where = {
    $or: [
      { internalCode: regex },
      ...(people.length ? [{ personId: { $in: people.map((p) => p._id) } }] : []),
    ],
  };

  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(cursor)) {
      throw new ApiError(400, 'cursor inválido');
    }
    where._id = { $gt: cursor };
  }

  const rows = await Student.find(where)
    .sort({ _id: 1 })
    .limit(normalizedLimit + 1)
    .populate('personId')
    .lean();

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;

  const items = await buildStudentResponse(selected);

  return {
    items,
    nextCursor: hasMore ? selected[selected.length - 1]._id.toString() : null,
  };
}

export async function getStudentSummaryService(studentId) {
  if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'id inválido');

  const student = await Student.findById(studentId).populate('personId').populate('familyId').lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const person = student.personId;

  const primaryTutor = await Tutor.findOne({ studentId: student._id, isPrimary: true })
    .populate('tutorPersonId')
    .lean();
  // console.log('[primaryTutor][dbg] content=', primaryTutor);

  const otherTutors = await Tutor.find({ studentId: student._id, isPrimary: false })
    .populate('tutorPersonId')
    .lean();


  const latestCycle = await StudentCycle.findOne({ studentId: student._id })
    .sort({ updatedAt: -1 })
    .lean();

  const latestVacancy = await Vacancy.findOne({ studentId: student._id })
    .sort({ startDate: -1 })
    .populate({ path: 'classroomId', populate: { path: 'campusId' } })
    .lean();

  const charges = await Charge.find({ studentId: student._id, status: { $in: ['OPEN', 'PARTIAL'] } }).lean();
  const now = new Date();
  let pendingTotal = 0;
  let overdueTotal = 0;
  for (const charge of charges) {
    const outstanding = toMoney(charge.outstandingAmount);
    pendingTotal += outstanding;
    if (charge.dueDate && charge.dueDate < now) overdueTotal += outstanding;
  }

  const lastPayment = student.familyId
    ? await Payment.findOne({ familyId: student.familyId._id }).sort({ paidAt: -1 }).lean()
    : null;

  const sendStudent = {
    id: student._id.toString(),
    dni: person?.dni || null,
    internalCode: student?.internalCode || null,
    names: person?.names || null,
    lastNames: person?.lastNames || null,
    birthDate: person?.birthDate || null,
    campusCode: latestVacancy?.classroomId?.campusId?.code || null,
    isActive: student.isActive,
  }
  const sendFamily = {
    familyId: student.familyId?._id?.toString() || null,
    primaryTutor_send: primaryTutor? {
          lastNames: primaryTutor.tutorPersonId?.lastNames || null,
          names: primaryTutor.tutorPersonId?.names || null,
          phone: primaryTutor.tutorPersonId?.phone || null,
          relationship: primaryTutor.relationship || null,
          livesWithStudent: primaryTutor.livesWithStudent ?? null
        }
      : null,
    otherTutors_send: (otherTutors || []).map(tutor => ({
      lastNames: tutor.tutorPersonId?.lastNames || null,
      names: tutor.tutorPersonId?.names || null,
      phone: primaryTutor.tutorPersonId?.phone || null,
      relationship: tutor.relationship || null,
      livesWithStudent: tutor.livesWithStudent ?? null
    }))
  };
  // console.log('[sendStudent][dbg] content=', sendStudent);
  console.log('[sendFamily][dbg] content=', sendFamily);
  // console.log('[Family][dbg] content=', sendFamily);

  return {
    student: sendStudent,
    familyLink: sendFamily,
    enrollmentStatus: {
      currentCycleId: latestCycle?.cycleId?.toString() || null,
      currentClassroomId: latestVacancy?.classroomId?.toString() || null,
      currentClassroom: latestVacancy || null,
      status: latestCycle?.status || 'ABSENT',
    },
    debtsSummary: {
      pendingTotal,
      overdueTotal,
      lastPaymentAt: lastPayment?.paidAt || null,
    },
  };
}


export async function listStudentsByCampusService({ campus, q = '', limit = 20, cursor, roles = [] }) {
  const { normalized, codes } = resolveCampusCodes(campus);
  console.log('[studentsByCampus][dbg] normalized=', normalized, 'codes=', codes);
  ensureCampusAccess({ campus: normalized, roles });
  console.log('[studentsByCampus][dbg] accessGrantedFor=', normalized, 'roles=', roles);
  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));

  const campuses = await Campus.find({ code: { $in: codes } }).select('_id').lean();
  console.log('[studentsByCampus][dbg] campusesFound=', campuses.length, campuses.map((c) => c._id));
  if (!campuses.length) {
    return { campus: normalized, items: [], nextCursor: null };
  }

  const cycles = await StudentCycle.find({ campusId: { $in: campuses.map((c) => c._id) } })
    .sort({ updatedAt: -1 })
    .select('studentId campusId')
    .lean();
  console.log('[studentsByCampus][dbg] studentCyclesFound=', cycles.length);
  console.log('[studentsByCampus][dbg] sampleCycle=', cycles[0]);

  const studentIdSet = new Set();
  const studentIds = [];
  for (const row of cycles) {
    const key = String(row.studentId);
    if (!studentIdSet.has(key)) {
      studentIdSet.add(key);
      studentIds.push(row.studentId);
    }
  }
  console.log('[studentsByCampus][dbg] uniqueStudentIds=', studentIds.length);

  if (!studentIds.length) {
    return { campus: normalized, items: [], nextCursor: null };
  }

  const term = String(q || '').trim();
  const where = { _id: { $in: studentIds } };

  if (term) {
    const regex = new RegExp(escapeRegExp(term), 'i');
    const people = await Person.find({
      $or: [{ dni: regex }, { names: regex }, { lastNames: regex }],
    }).select('_id').lean();

    where.$or = [
      { internalCode: regex },
      ...(people.length ? [{ personId: { $in: people.map((p) => p._id) } }] : []),
    ];
  }

  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(cursor)) throw new ApiError(400, 'cursor inválido');
    where._id.$gt = cursor;
  }
  // console.log('[studentsByCampus][dbg] where=', JSON.stringify(where));

  const rows = await Student.find(where)
    .sort({ _id: 1 })
    .limit(normalizedLimit + 1)
    .populate('personId')
    .lean();
  console.log('[studentsByCampus][dbg] studentsFound=', rows.length);
  // console.log('[studentsByCampus][dbg] studentsOne=', rows[0]);
  
  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const items = await buildStudentResponse(selected);
  console.log('[items][dbg] itemsOne=', items[0]);

  return {
    campus: normalized,
    items,
    nextCursor: hasMore ? selected[selected.length - 1]._id.toString() : null,
  };
}
