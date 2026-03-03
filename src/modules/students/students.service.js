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
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { ApiError } from '../../utils/errors.js';
import { getClassroomCapacityService } from '../enrollments/enrollments.service.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { buildAccentInsensitiveRegex, normalizeSearchTerm } from '../../utils/search.js';
import {
  findStudentWithPersonById,
  findPersonByDni,
  updatePersonById,
  updateStudentById,
} from './repositories/students.repository.js';

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

function ensureCampusAccess({ campus, campusScope }) {
  const allowedCampuses = Array.isArray(campusScope) ? campusScope : [];
  if (allowedCampuses.includes('ALL')) return;
  if (!allowedCampuses.includes(campus)) {
    throw new ApiError(403, 'No autorizado para consultar este campus');
  }
}

function resolveCampusCodes(campus) {
  const raw = String(campus || '').trim().toUpperCase();
  const codes = CAMPUS_ALIAS[raw];
  if (!codes) {
    throw new ApiError(400, 'campus inválido. Usa CIENCIAS, CIMAS o CIENCIAS_APLICADAS');
  }
  return { normalized: raw, codes };
}

async function buildStudentResponse(items) {
  const studentIds = items.map((row) => row._id);
  const vacancies = await Vacancy.find({ studentId: { $in: studentIds } })
    .populate({ path: 'classroomId', populate: { path: 'campusId' } })
    .lean();

  const vacancyByStudent = new Map(vacancies.map((vacancy) => [String(vacancy.studentId), vacancy]));

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
      bankCode: student.bankCode || null,
      campusCode: campus?.code || null,
      lastKnownGrade: classroom?.grade || null,
      lastKnownSection: classroom?.section || null,
      classroomName:classroom?.displayName || null,
      activeStatus: student.activeStatus,
    };
  });
}

export async function createStudentService({ person, familyId, classroomId, entryDate, notes }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const classroom = classroomId ? await Classroom.findById(classroomId).session(session) : null;
    if (classroomId && !classroom) {
      throw new ApiError(404, 'Classroom no encontrado');
    }

    const personDoc = await resolveOrCreatePerson(person, session);

    let family = null;
    if (familyId) {
      family = await Family.findById(familyId).session(session);
      if (!family) throw new ApiError(404, 'Familia no encontrada');
    }

    const existingStudent = await Student.findOne({ personId: personDoc._id }).session(session);
    if (existingStudent) {
      throw new ApiError(409, 'Ya existe un alumno para esta persona');
    }

    const internalCode = await nextStudentCode(session);

    // Student puede existir sin familia; matrícula/StudentCycle define su estado activo.
    const student = await Student.create([
      {
        personId: personDoc._id,
        ...(family ? { familyId: family._id } : {}),
        internalCode,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        notes,
      },
    ], { session });

    const studentDoc = student[0];

    if (family) {
      await Family.updateOne({ _id: family._id }, { $addToSet: { studentIds: studentDoc._id } }, { session });
    }

    if (classroom) {
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
          $setOnInsert: {
            studentId: studentDoc._id,
            cycleId: cycle._id,
          },
          $set: {
            classroomId: classroom._id,
            notes: notes || undefined,
          },
        },
        { upsert: true, session }
      );
    }

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

function parseSearchLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.min(10, Math.trunc(parsed));
}

function isNumericTerm(value) {
  return /^\d+$/.test(value);
}

export async function searchStudentAutocompleteService({ q, dni, limit }) {
  const normalizedDni = normalizeSearchTerm(dni);
  const normalizedQ = normalizeSearchTerm(q);

  const term = normalizedDni || normalizedQ;
  if (!term) return [];

  const normalizedLimit = parseSearchLimit(limit);
  const peopleFetchLimit = normalizedLimit * 3;
  const qRegex = buildAccentInsensitiveRegex(normalizedQ);
  const dniRegex = buildAccentInsensitiveRegex(normalizedDni || normalizedQ);

  let personFilter = null;
  if (normalizedDni) {
    personFilter = normalizedDni.length === 8 && isNumericTerm(normalizedDni)
      ? { dni: normalizedDni }
      : { dni: dniRegex };
  } else if (qRegex) {
    const orFilters = [{ names: qRegex }, { lastNames: qRegex }];
    if (/\d/.test(normalizedQ) && dniRegex) {
      orFilters.push({ dni: dniRegex });
    }
    personFilter = { $or: orFilters };
  }

  const [people, codeMatchedStudents] = await Promise.all([
    personFilter
      ? Person.find(personFilter)
        .select('_id')
        .limit(peopleFetchLimit)
        .lean()
      : Promise.resolve([]),
    qRegex
      ? Student.find({ $or: [{ internalCode: qRegex }, { bankCode: qRegex }] })
        .select('_id personId')
        .limit(peopleFetchLimit)
        .lean()
      : Promise.resolve([]),
  ]);

  const personIdSet = new Set(people.map((person) => String(person._id)));
  codeMatchedStudents.forEach((student) => {
    if (student.personId) personIdSet.add(String(student.personId));
  });

  if (!personIdSet.size) return [];

  const orderedPersonIds = Array.from(personIdSet).map((id) => new mongoose.Types.ObjectId(id));
  const students = await Student.find({ personId: { $in: orderedPersonIds } })
    .select('_id personId familyId')
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .lean();
  console.log(students)
  const mapped = students
    .filter((student) => student.personId)
    .map((student) => ({
      _id: student._id,
      personId: {
        _id: student.personId._id,
        names: student.personId.names,
        lastNames: student.personId.lastNames,
        dni: student.personId.dni ?? null,
      },
      familyId: student.familyId || null,
    }));

  if (normalizedDni && normalizedDni.length === 8 && isNumericTerm(normalizedDni)) {
    mapped.sort((a, b) => {
      const aExact = a.personId?.dni === normalizedDni ? 1 : 0;
      const bExact = b.personId?.dni === normalizedDni ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return String(a._id).localeCompare(String(b._id));
    });
  } else {
    mapped.sort((a, b) => {
      const aLastName = normalizeSearchTerm(a.personId?.lastNames || '');
      const bLastName = normalizeSearchTerm(b.personId?.lastNames || '');
      if (aLastName !== bLastName) return aLastName.localeCompare(bLastName, 'es');

      const aNames = normalizeSearchTerm(a.personId?.names || '');
      const bNames = normalizeSearchTerm(b.personId?.names || '');
      if (aNames !== bNames) return aNames.localeCompare(bNames, 'es');

      return String(a._id).localeCompare(String(b._id));
    });
  }
  console.log("mapped_ ",mapped)
  console.log("x ",mapped.slice(0, normalizedLimit))
  return mapped.slice(0, normalizedLimit);
}



export function scoreUnassignedMatch({ qNormalized, dni, names, lastNames, internalCode }) {
  const dniValue = String(dni || '').toLowerCase();
  const namesValue = normalizeSearchTerm(names || '');
  const lastNamesValue = normalizeSearchTerm(lastNames || '');
  const internalValue = normalizeSearchTerm(internalCode || '');
  const fullName = `${lastNamesValue} ${namesValue}`.trim();

  if (dniValue && dniValue === qNormalized) return 300;
  if (lastNamesValue.startsWith(qNormalized) || namesValue.startsWith(qNormalized) || fullName.startsWith(qNormalized)) return 200;
  if (dniValue.includes(qNormalized) || namesValue.includes(qNormalized) || lastNamesValue.includes(qNormalized) || internalValue.includes(qNormalized) || fullName.includes(qNormalized)) return 100;
  return 0;
}

export async function searchUnassignedStudentsByQueryService({ q, limit = 20 }) {
  const term = String(q || '').trim();
  const normalized = normalizeSearchTerm(term);
  if (normalized.length < 2) throw new ApiError(400, 'q muy corto');

  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));
  const regex = buildAccentInsensitiveRegex(term) || new RegExp(escapeRegExp(term), 'i');

  const rows = await Student.aggregate([
    {
      $match: {
        $or: [{ familyId: null }, { familyId: { $exists: false } }],
      },
    },
    {
      $lookup: {
        from: 'person',
        localField: 'personId',
        foreignField: '_id',
        as: 'person',
      },
    },
    { $unwind: '$person' },
    {
      $match: {
        $or: [
          { internalCode: regex },
          { 'person.dni': regex },
          { 'person.names': regex },
          { 'person.lastNames': regex },
          { $expr: { $regexMatch: { input: { $concat: ['$person.lastNames', ' ', '$person.names'] }, regex } } },
        ],
      },
    },
    {
      $project: {
        _id: 1,
        internalCode: 1,
        activeStatus: 1,
        person: {
          personId: '$person._id',
          names: '$person.names',
          lastNames: '$person.lastNames',
          dni: '$person.dni',
          gender: '$person.gender',
        },
      },
    },
    { $limit: normalizedLimit * 3 },
  ]);

  // console.log("[DBG] [rows]: ",rows)
  const items = rows
    .map((row) => ({
      studentId: row._id,
      internalCode: row.internalCode,
      activeStatus: row.activeStatus || 'ACTIVE',
      personId: row.person ? {
        personId: row.person.personId,
        names: row.person.names,
        lastNames: row.person.lastNames,
        dni: row.person.dni || null,
        gender: row.person.gender,
      }
      : null,
      score: scoreUnassignedMatch({
        qNormalized: normalized,
        dni: row.person.dni,
        names: row.person.names,
        lastNames: row.person.lastNames,
        internalCode: row.internalCode,
      }),
    }))
    .sort((a, b) => (b.score - a.score) || String(a.studentId).localeCompare(String(b.studentId)))
    .slice(0, normalizedLimit)
    .map(({ score, ...item }) => item);

  console.log("[DBG] [Búsqueda de:",term,"]: ",items[0])

  return { q: term, items };
}

export async function searchUnassignedStudentsService({ limit = 20, cursor }) {
  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));

  const filter = {
    $or: [
      { familyId: null },
      { familyId: { $exists: false } },
    ],
  };

  if (cursor) {
    if (!mongoose.Types.ObjectId.isValid(cursor)) {
      throw new ApiError(400, 'cursor inválido');
    }
    filter._id = { $gt: cursor };
  }

  const rows = await Student.find(filter)
    .sort({ _id: 1 })
    .limit(normalizedLimit + 1)
    .populate({
      path: 'personId',
      select: 'names lastNames dni gender',
    })
    .lean();

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;

  const items = selected.map((student) => ({
    _id: String(student._id),
    internalCode: student.internalCode,
    personId: student.personId
      ? {
        _id: String(student.personId._id),
        names: student.personId.names,
        lastNames: student.personId.lastNames,
        dni: student.personId.dni ?? null,
        gender: student.personId.gender,
      }
      : null,
    activeStatus: student.activeStatus || 'ACTIVE',
  }));
  
  console.log("[DBG] [Lista de alumnos (primero)]: ",items[0])

  return {
    items,
    nextCursor: hasMore ? String(selected[selected.length - 1]._id) : null,
  };
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
    gender: person?.gender || null,
    internalCode: student?.internalCode || null,
    bankCode: student?.bankCode || null,
    names: person?.names || null,
    lastNames: person?.lastNames || null,
    birthDate: person?.birthDate || null,
    campusCode: latestVacancy?.classroomId?.campusId?.code || null,
    activeStatus: student.activeStatus,
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
  // console.log('[Student][dbg] content=', student);
  // console.log('[sendFamily][dbg] content=', sendFamily);
  // console.log('[Family][dbg] content=', sendFamily);

  const sendEnrollmentStatus = {
    cycle: {
      id: latestCycle?.cycleId?._id?.toString() || null,
      status: latestCycle?.status || null,
    },
    classroom: {
      id: latestVacancy?.classroomId?._id?.toString() || null,
      displayName: latestVacancy?.classroomId?.displayName || null,
      grade: latestVacancy?.classroomId?.grade || null,
      section: latestVacancy?.classroomId?.section || null,
      level: latestVacancy?.classroomId?.level || null,
    },
    campus: {
      code: latestVacancy?.classroomId?.campusId?.code || null,
      name: latestVacancy?.classroomId?.campusId?.name || null,
    },
    // currentClassroom: latestVacancy || null,
    // lastestCycle: latestCycle || null,
  }

  return {
    student: sendStudent,
    familyLink: sendFamily,
    enrollmentStatus: sendEnrollmentStatus,
    debtsSummary: {
      pendingTotal,
      overdueTotal,
      lastPaymentAt: lastPayment?.paidAt || null,
    },
  };
}


export async function listStudentsByCampusService({ campus, q = '', limit = 20, cursor, campusScope = [] }) {
  const { normalized, codes } = resolveCampusCodes(campus);
  console.log('[studentsByCampus][dbg] normalized=', normalized, 'codes=', codes);
  ensureCampusAccess({ campus: normalized, campusScope });
  console.log('[studentsByCampus][dbg] accessGrantedFor=', normalized, 'campusScope=', campusScope);
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


async function resolveCycleForDetail(cycleId) {
  if (cycleId) {
    const cycle = await Cycle.findById(cycleId).lean();
    if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');
    return cycle;
  }

  const now = new Date();
  return Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort({ startDate: -1 })
    .lean();
}

function composeNotes(currentNotes, reason) {
  if (!reason) return currentNotes;
  const stamp = `[${new Date().toISOString()}] ${reason}`;
  return currentNotes ? `${currentNotes}\n${stamp}` : stamp;
}

async function resolveCampusForCycleStatus(studentId, cycleId) {
  const studentCycle = await StudentCycle.findOne({ studentId, cycleId }).lean();
  if (studentCycle?.campusId) return studentCycle.campusId;

  const vacancy = await Vacancy.findOne({ studentId, cycleId }).populate('classroomId').lean();
  if (vacancy?.classroomId?.campusId) return vacancy.classroomId.campusId;

  return null;
}

export async function getStudentDetailService(studentId, cycleId) {
  const student = await Student.findById(studentId)
    .populate('personId')
    .populate('familyId')
    .lean();

  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const cycle = await resolveCycleForDetail(cycleId);

  const tutors = await Tutor.find({ studentId: student._id })
    .sort({ isPrimary: -1, _id: 1 })
    .limit(10)
    .populate('tutorPersonId')
    .lean();

  let family = null;
  if (student.familyId?._id) {
    family = await Family.findById(student.familyId._id)
      .populate({ path: 'tutorIds', populate: { path: 'tutorPersonId' } })
      .lean();
  }

  const studentCycle = cycle
    ? await StudentCycle.findOne({ studentId: student._id, cycleId: cycle._id }).lean()
    : null;

  const activeVacancy = cycle
    ? await Vacancy.findOne({ studentId: student._id, cycleId: cycle._id })
      .populate({ path: 'classroomId', populate: { path: 'campusId' } })
      .lean()
    : null;

  return {
    student,
    person: student.personId || null,
    family: family ? {
      _id: family._id,
      notes: family.notes || null,
      studentIds: family.studentIds || [],
      tutorIds: family.tutorIds || [],
    } : null,
    tutors,
    currentCycle: cycle ? {
      _id: cycle._id,
      name: cycle.name,
      year: cycle.year,
      type: cycle.type,
    } : null,
    cycleStatus: studentCycle ? {
      _id: studentCycle._id,
      cycleId: studentCycle.cycleId,
      campusId: studentCycle.campusId,
      status: studentCycle.status,
      notes: studentCycle.notes || null,
      enrolledAt: studentCycle.enrolledAt || null,
      transferredAt: studentCycle.transferredAt || null,
    } : null,
    activeVacancy: activeVacancy ? {
      _id: activeVacancy._id,
      cycleId: activeVacancy.cycleId,
      classroomId: activeVacancy.classroomId,
      notes: activeVacancy.notes || null,
    } : null,
  };
}

export async function updateStudentCycleStatusService(studentId, { cycleId, status, reason }, userId = null) {
  const student = await Student.findById(studentId).lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const cycle = await Cycle.findById(cycleId).lean();
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

  const now = new Date();
  const enforceNoDebtOnTransfer = process.env.ALLOW_TRANSFER_WITH_DEBT !== 'true';
  if (status === 'TRANSFERRED' && enforceNoDebtOnTransfer) {
    const debtRows = await Charge.find({
      studentId,
      outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
      status: { $ne: 'CANCELLED' },
    }).select('_id').lean();

    if (debtRows.length) {
      throw new ApiError(409, 'No se puede trasladar al estudiante con deuda pendiente');
    }
  }

  const campusId = await resolveCampusForCycleStatus(studentId, cycleId);
  if (!campusId) throw new ApiError(400, 'No se pudo determinar campus para el estado del ciclo');

  if (status === 'TRANSFERRED' || status === 'ABSENT') {
    await Vacancy.deleteOne({ studentId, cycleId });
  }


  const existingCycle = await StudentCycle.findOne({ studentId, cycleId, campusId }).lean();

  await StudentCycle.updateOne(
    { studentId, cycleId, campusId },
    {
      $setOnInsert: { studentId, cycleId, campusId },
      $set: {
        status,
        notes: composeNotes(existingCycle?.notes, reason),
        enrolledAt: status === 'ENROLLED' ? now : existingCycle?.enrolledAt || null,
        transferredAt: status === 'TRANSFERRED' ? now : null,
      },
    },
    { upsert: true }
  );

  const updated = await StudentCycle.findOne({ studentId, cycleId, campusId }).lean();

  if (status === 'TRANSFERRED' && userId) {
    await registerAuditLog({
      entityType: 'TRANSFER',
      entityId: updated?._id || studentId,
      action: 'STUDENT_TRANSFERRED',
      performedBy: userId,
      campusId,
      payloadSnapshot: { studentId, cycleId, reason: reason || null },
    });
  }

  return {
    studentId,
    cycleId,
    status: updated?.status || status,
    notes: updated?.notes || null,
  };
}

export async function changeStudentClassroomService(studentId, { cycleId, classroomId, reason }, userId = null) {
  const payload = await runInTransaction(async (session) => {
    const student = await Student.findById(studentId).session(session).lean();
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const classroom = await Classroom.findById(classroomId).session(session).lean();
    if (!classroom) throw new ApiError(404, 'Aula no encontrada');

    if (String(classroom.cycleId) !== String(cycleId)) {
      throw new ApiError(400, 'El aula no pertenece al ciclo indicado');
    }

    const activeVacancy = await Vacancy.findOne({ studentId, cycleId }).session(session).lean();
    const hasClassroomChange = !activeVacancy || String(activeVacancy.classroomId) !== String(classroomId);

    if (!hasClassroomChange) {
      const hydratedVacancy = await Vacancy.findById(activeVacancy._id)
        .populate({ path: 'classroomId', populate: { path: 'campusId' } })
        .session(session)
        .lean();

      return { hydratedVacancy, campusId: classroom.campusId, changed: false };
    }

    const capacity = await getClassroomCapacityService({ classroomId, cycleId });
    if (capacity.reservedCount >= capacity.totalCapacity) {
      throw new ApiError(409, 'No hay vacantes disponibles en el aula seleccionada');
    }

    const vacancy = await Vacancy.findOneAndUpdate(
      { studentId, cycleId },
      {
        $setOnInsert: { studentId, cycleId },
        $set: {
          classroomId,
          ...(reason ? { notes: composeNotes(activeVacancy?.notes, reason) } : {}),
        },
      },
      {
        new: true,
        upsert: true,
        session,
      }
    );

    const existingCycle = await StudentCycle.findOne({ studentId, cycleId }).session(session).lean();

    await StudentCycle.updateOne(
      { studentId, cycleId, campusId: classroom.campusId },
      {
        $setOnInsert: { studentId, cycleId, campusId: classroom.campusId },
        $set: { status: existingCycle?.status || 'ABSENT' },
      },
      { upsert: true, session }
    );

    const hydratedVacancy = await Vacancy.findById(vacancy._id)
      .populate({ path: 'classroomId', populate: { path: 'campusId' } })
      .session(session)
      .lean();

    return { hydratedVacancy, campusId: classroom.campusId, changed: true };
  });

  if (userId && payload.changed) {
    await registerAuditLog({
      entityType: 'CLASSROOM_CHANGE',
      entityId: payload.hydratedVacancy._id,
      action: 'STUDENT_CLASSROOM_CHANGED',
      performedBy: userId,
      campusId: payload.campusId,
      payloadSnapshot: { studentId, cycleId, classroomId, reason: reason || null },
    });
  }

  return payload.hydratedVacancy;
}



function money(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mapChargeStatus({ amount, outstandingAmount, dueDate }) {
  if (outstandingAmount === 0) return 'PAID';
  if (outstandingAmount > 0 && outstandingAmount < amount) return 'PARTIAL';
  if (outstandingAmount > 0 && dueDate && dueDate < new Date()) return 'OVERDUE';
  return 'PENDING';
}

async function buildStudentFinancialSnapshot(studentId) {
  if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');

  const student = await Student.findById(studentId).populate('personId').lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const chargesDb = await Charge.find({ studentId: student._id, status: { $ne: 'CANCELLED' } })
    .populate('conceptId', 'name')
    .sort({ dueDate: 1, _id: 1 })
    .lean();

  const chargeIds = chargesDb.map((charge) => charge._id);
  const allocations = chargeIds.length
    ? await PaymentAllocation.find({ chargeId: { $in: chargeIds } })
      .populate('paymentId')
      .sort({ createdAt: -1, _id: -1 })
      .lean()
    : [];

  const paymentById = new Map();
  for (const allocation of allocations) {
    if (!allocation.paymentId) continue;
    const key = String(allocation.paymentId._id);
    const previous = paymentById.get(key) || {
      id: key,
      amount: 0,
      date: allocation.paymentId.paidAt,
      method: allocation.paymentId.method,
      note: allocation.paymentId.notes || null,
    };
    previous.amount = roundMoney(previous.amount + money(allocation.amount));
    paymentById.set(key, previous);
  }

  const charges = chargesDb.map((charge) => {
    const amount = roundMoney(money(charge.totalAmount));
    const outstandingAmount = roundMoney(money(charge.outstandingAmount));
    const status = mapChargeStatus({ amount, outstandingAmount, dueDate: charge.dueDate });

    return {
      id: charge._id.toString(),
      concept: charge.conceptId?.name || charge.description,
      amount,
      outstandingAmount,
      dueDate: charge.dueDate || null,
      status,
    };
  });

  const totals = charges.reduce((acc, charge) => {
    const paid = roundMoney(charge.amount - charge.outstandingAmount);
    acc.paid = roundMoney(acc.paid + Math.max(paid, 0));
    if (charge.outstandingAmount > 0) {
      acc.pending = roundMoney(acc.pending + charge.outstandingAmount);
      if (charge.status === 'OVERDUE') acc.overdue = roundMoney(acc.overdue + charge.outstandingAmount);
    }
    return acc;
  }, { pending: 0, overdue: 0, paid: 0 });

  return {
    student: {
      id: student._id.toString(),
      names: student.personId?.names || null,
      lastNames: student.personId?.lastNames || null,
      dni: student.personId?.dni || null,
      code: student.internalCode || null,
      bankCode: student.bankCode || null,
    },
    totals,
    charges,
    payments: Array.from(paymentById.values()).sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

export async function getStudentAccountStatementService(studentId) {
  return buildStudentFinancialSnapshot(studentId);
}

export async function getStudentChargesService(studentId) {
  const snapshot = await buildStudentFinancialSnapshot(studentId);
  return snapshot.charges;
}

export async function getStudentPaymentsService(studentId) {
  const snapshot = await buildStudentFinancialSnapshot(studentId);
  return snapshot.payments;
}

export async function updateStudentIdentityService(studentId, payload, actor = null) {
  const student = await findStudentWithPersonById(studentId);
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');
  if (!student.personId?._id) throw new ApiError(400, 'El estudiante no tiene persona asociada');

  const personUpdates = {};
  const stringFields = ['names', 'lastNames', 'gender', 'phone', 'address'];
  for (const key of stringFields) {
    if (payload[key] !== undefined) personUpdates[key] = payload[key];
  }

  if (payload.birthDate !== undefined) {
    personUpdates.birthDate = payload.birthDate ? new Date(payload.birthDate) : null;
  }

  if (payload.dni !== undefined) {
    const normalizedDni = normalizeDni(payload.dni);
    if (normalizedDni) {
      const personWithDni = await findPersonByDni(normalizedDni);
      if (personWithDni && String(personWithDni._id) !== String(student.personId._id)) {
        throw new ApiError(409, 'El DNI ya está registrado por otra persona');
      }
    }
    personUpdates.dni = normalizedDni;
  }

  if (!Object.keys(personUpdates).length) {
    throw new ApiError(400, 'No se enviaron cambios de identidad válidos');
  }

  await updatePersonById(student.personId._id, { $set: personUpdates });

  if (actor) {
    await registerAuditLog({
      entityType: 'STUDENT',
      entityId: student._id,
      action: 'STUDENT_IDENTITY_UPDATED',
      performedBy: actor,
      payloadSnapshot: { studentId, updates: personUpdates },
    });
  }

  const updated = await Student.findById(student._id).populate('personId').populate('familyId');
  return { ok: true, student: updated };
}

export async function updateStudentInternalNotesService(studentId, internalNotes, actor = null) {
  const student = await updateStudentById(studentId, { $set: { internalNotes } });
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  if (actor) {
    await registerAuditLog({
      entityType: 'STUDENT',
      entityId: student._id,
      action: 'STUDENT_INTERNAL_NOTES_UPDATED',
      performedBy: actor,
      payloadSnapshot: { studentId, internalNotes },
    });
  }

  return { ok: true, student };
}


export async function updateStudentBankCodeService(studentId, bankCode, actor = null) {
  const student = await Student.findById(studentId).lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const normalizedBankCode = typeof bankCode === 'string' ? bankCode.trim() : null;
  const nextBankCode = normalizedBankCode ? normalizedBankCode : null;

  try {
    const updated = await updateStudentById(studentId, { $set: { bankCode: nextBankCode } });

    if (actor) {
      await registerAuditLog({
        entityType: 'STUDENT',
        entityId: studentId,
        action: 'STUDENT_BANK_CODE_UPDATED',
        performedBy: actor,
        payloadSnapshot: { studentId, bankCode: nextBankCode },
      });
    }

    return { ok: true, student: updated };
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.bankCode) {
      throw new ApiError(409, 'bankCode ya está asignado a otro estudiante');
    }
    throw error;
  }
}
