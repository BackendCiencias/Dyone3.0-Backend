import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
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
import { normalizePersonNameFields, normalizePersonUpdatePayload } from '../../utils/personNameFormatter.js';
import { searchUnassignedStudentsService as searchUnassignedStudentsModuleService, addCampusToStudents } from './services/unassignedStudents.search.service.js';
import { toUnassignedStudentListItem } from './presenters/unassignedStudentListItem.presenter.js';
import {
  findStudentWithPersonById,
  findPersonByDni,
  updatePersonById,
  updateStudentById,
  findUnassignedList,
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

  return `COD${String(counter.seq).padStart(6, '0')}`;
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
  const normalizedPerson = normalizePersonNameFields(person);
  const dni = normalizeDni(normalizedPerson.dni);

  let personDoc = null;
  if (dni) {
    personDoc = await Person.findOne({ dni }).session(session);
  }

  if (!personDoc) {
    personDoc = new Person({
      ...normalizedPerson,
      ...(dni ? { dni } : {}),
      ...(dni ? {} : { dni: undefined }),
    });
    await personDoc.save({ session });
    return personDoc;
  }

  const setUpdates = {};
  if (normalizedPerson.names && personDoc.names !== normalizedPerson.names) setUpdates.names = normalizedPerson.names;
  if (normalizedPerson.lastNames && personDoc.lastNames !== normalizedPerson.lastNames) setUpdates.lastNames = normalizedPerson.lastNames;
  if (normalizedPerson.gender && personDoc.gender !== normalizedPerson.gender) setUpdates.gender = normalizedPerson.gender;
  if (normalizedPerson.phone && personDoc.phone !== normalizedPerson.phone) setUpdates.phone = normalizedPerson.phone;
  if (normalizedPerson.address && personDoc.address !== normalizedPerson.address) setUpdates.address = normalizedPerson.address;
  if (normalizedPerson.email && personDoc.email !== normalizedPerson.email) setUpdates.email = normalizedPerson.email;

  if (Object.keys(setUpdates).length) {
    await Person.updateOne({ _id: personDoc._id }, normalizePersonUpdatePayload({ $set: setUpdates }), { session });
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
  if (!studentIds.length) return [];

  const activeCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  const vacancyFilter = { studentId: { $in: studentIds } };
  const cycleStatusFilter = { studentId: { $in: studentIds } };
  if (activeCycle?._id) {
    vacancyFilter.cycleId = activeCycle._id;
    cycleStatusFilter.cycleId = activeCycle._id;
  }

  const [vacancies, studentCycles, chargeTotals] = await Promise.all([
    Vacancy.find(vacancyFilter)
      .sort({ updatedAt: -1, _id: -1 })
      .populate({ path: 'classroomId', populate: { path: 'campusId' } })
      .lean(),
    StudentCycle.find(cycleStatusFilter)
      .sort({ updatedAt: -1, _id: -1 })
      .select('studentId status campusId')
      .lean(),
    Charge.aggregate([
      {
        $match: {
          studentId: { $in: studentIds },
          status: { $ne: 'CANCELLED' },
        },
      },
      {
        $group: {
          _id: '$studentId',
          totalDebt: { $sum: { $toDouble: '$outstandingAmount' } },
        },
      },
    ]),
  ]);

  const vacancyByStudent = new Map();
  for (const vacancy of vacancies) {
    const key = String(vacancy.studentId);
    if (!vacancyByStudent.has(key)) vacancyByStudent.set(key, vacancy);
  }

  const cycleStatusByStudent = new Map();
  for (const row of studentCycles) {
    const key = String(row.studentId);
    if (!cycleStatusByStudent.has(key)) cycleStatusByStudent.set(key, row);
  }

  const debtByStudent = new Map(
    chargeTotals.map((row) => [String(row._id), roundMoney(Number(row.totalDebt || 0))])
  );

  return items.map((student) => {
    const person = student.personId;
    const vacancy = vacancyByStudent.get(String(student._id));
    const classroom = vacancy?.classroomId;
    const campus = classroom?.campusId;
    const cycleStatus = cycleStatusByStudent.get(String(student._id));

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
      classroomName: classroom?.displayName || null,
      activeStatus: student.activeStatus,
      enrollmentStatus: cycleStatus?.status || null,
      totalDebt: debtByStudent.get(String(student._id)) || 0,
    };
  });
}

export async function createStudentService({ person, classroomId, entryDate, notes }, tutorPayload = null) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const classroom = classroomId ? await Classroom.findById(classroomId).session(session) : null;
    if (classroomId && !classroom) {
      throw new ApiError(404, 'Classroom no encontrado');
    }

    const personDoc = await resolveOrCreatePerson(person, session);

    const existingStudent = await Student.findOne({ personId: personDoc._id }).session(session);
    if (existingStudent) {
      throw new ApiError(409, 'Ya existe un alumno para esta persona');
    }

    const internalCode = await nextStudentCode(session);

    // Student puede existir sin familia; matrícula/StudentCycle define su estado activo.
    const student = await Student.create([
      {
        personId: personDoc._id,
        internalCode,
        entryDate: entryDate ? new Date(entryDate) : undefined,
        notes,
      },
    ], { session });

    const studentDoc = student[0];

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

    let tutorIds = [];
    if (tutorPayload?.primaryTutor) {
      const tutorPersonDoc = await resolveOrCreatePerson(tutorPayload.primaryTutor.person, session);

      const tutor = await Tutor.findOneAndUpdate(
        { studentId: studentDoc._id, tutorPersonId: tutorPersonDoc._id },
        {
          $set: {
            relationship: tutorPayload.primaryTutor.relationship,
            isPrimary: true,
            livesWithStudent: tutorPayload.primaryTutor.livesWithStudent ?? true,
            ...(tutorPayload.primaryTutor.notes ? { notes: tutorPayload.primaryTutor.notes } : {}),
          },
          $setOnInsert: {
            studentId: studentDoc._id,
            tutorPersonId: tutorPersonDoc._id,
          },
        },
        { upsert: true, new: true, session }
      );

      tutorIds = [String(tutor._id)];
    }

    await session.commitTransaction();

    const hydratedStudent = await Student.findById(studentDoc._id)
      .populate('personId');

    return {
      studentId: String(studentDoc._id),
      tutorIds,
      student: hydratedStudent,
    };
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
  const student = await Student.findOne({ personId: person._id }).populate('personId');
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
    .select('_id personId')
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .lean();
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
  return mapped.slice(0, normalizedLimit);
}



export async function searchUnassignedStudentsByQueryService({ q, limit = 20 }) {
  const term = String(q || '').trim();
  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));
  const items = await searchUnassignedStudentsModuleService({ q: term, limit: normalizedLimit, campusScope: 'ALL' });

  return { q: term, items };
}

export async function searchUnassignedStudentsService({ limit = 20, cursor }) {
  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));

  if (cursor && !mongoose.Types.ObjectId.isValid(cursor)) {
    throw new ApiError(400, 'cursor inválido');
  }

  const rows = await findUnassignedList({
    limit: normalizedLimit,
    cursor,
  });

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const withCampus = await addCampusToStudents(selected);
  const items = withCampus.map((student) => toUnassignedStudentListItem(student));

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


function normalizePrintCardFilters(filters = {}) {
  return {
    q: String(filters.q || '').trim(),
    campus: String(filters.campus || '').trim().toUpperCase(),
    level: String(filters.level || '').trim().toUpperCase(),
    grade: filters.grade === undefined || filters.grade === null ? '' : String(filters.grade).trim(),
    section: String(filters.section || '').trim().toUpperCase(),
  };
}

async function resolvePrintCardsContext(studentIds = []) {
  const uniqueStudentIds = [...new Set(studentIds.map((id) => String(id)))].map((id) => new mongoose.Types.ObjectId(id));
  if (!uniqueStudentIds.length) return new Map();

  const activeCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  if (!activeCycle?._id) {
    return new Map(uniqueStudentIds.map((id) => [String(id), {
      campusCode: null,
      grade: null,
      section: null,
      classroomLabel: null,
      level: null,
    }]));
  }

  const [studentCycles, vacancies] = await Promise.all([
    StudentCycle.find({ studentId: { $in: uniqueStudentIds }, cycleId: activeCycle._id })
      .select('studentId campusId')
      .lean(),
    Vacancy.find({ studentId: { $in: uniqueStudentIds }, cycleId: activeCycle._id })
      .select('studentId classroomId')
      .lean(),
  ]);

  const classroomIds = [...new Set(vacancies.map((row) => String(row.classroomId || '')).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));

  const classrooms = classroomIds.length
    ? await Classroom.find({ _id: { $in: classroomIds } }).select('_id campusId level grade section displayName').lean()
    : [];

  const campusIds = [...new Set([
    ...studentCycles.map((row) => String(row.campusId || '')),
    ...classrooms.map((row) => String(row.campusId || '')),
  ].filter(Boolean))].map((id) => new mongoose.Types.ObjectId(id));

  const campuses = campusIds.length
    ? await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean()
    : [];

  const campusById = new Map(campuses.map((campus) => [String(campus._id), campus.code || null]));
  const classroomById = new Map(classrooms.map((classroom) => [String(classroom._id), classroom]));
  const studentCycleByStudentId = new Map(studentCycles.map((row) => [String(row.studentId), row]));
  const vacancyByStudentId = new Map(vacancies.map((row) => [String(row.studentId), row]));

  const context = new Map();
  uniqueStudentIds.forEach((studentId) => {
    const key = String(studentId);
    const vacancy = vacancyByStudentId.get(key);
    const classroom = vacancy?.classroomId ? classroomById.get(String(vacancy.classroomId)) : null;
    const cycle = studentCycleByStudentId.get(key);

    const campusCode = classroom?.campusId
      ? campusById.get(String(classroom.campusId)) || null
      : (cycle?.campusId ? campusById.get(String(cycle.campusId)) || null : null);

    context.set(key, {
      campusCode,
      grade: classroom?.grade || null,
      section: classroom?.section || null,
      classroomLabel: classroom?.displayName || null,
      level: classroom?.level || null,
    });
  });

  return context;
}

function mapStudentPrintCard(student, contextByStudentId) {
  const person = student.personId || {};
  const context = contextByStudentId.get(String(student._id)) || {
    campusCode: null,
    grade: null,
    section: null,
    classroomLabel: null,
    level: null,
  };

  return {
    studentId: String(student._id),
    internalCode: student.internalCode || null,
    names: person.names || '',
    lastNames: person.lastNames || '',
    dni: person.dni || null,
    campusCode: context.campusCode,
    grade: context.grade,
    section: context.section,
    classroomLabel: context.classroomLabel,
    level: context.level,
  };
}

function matchesPrintCardFilters(item, filters) {
  if (filters.campus && item.campusCode !== filters.campus) return false;
  if (filters.level && String(item.level || '').toUpperCase() !== filters.level) return false;
  if (filters.grade && String(item.grade || '').toUpperCase() !== filters.grade.toUpperCase()) return false;
  if (filters.section && String(item.section || '').toUpperCase() !== filters.section) return false;

  if (!filters.q) return true;

  const normalizedQ = normalizeSearchTerm(filters.q);
  const haystacks = [
    item.internalCode,
    item.dni,
    item.names,
    item.lastNames,
  ].map((value) => normalizeSearchTerm(value || ''));

  return haystacks.some((value) => value.includes(normalizedQ));
}

export async function getStudentsPrintCardsService({ studentIds = [], filters = {} }) {
  const normalizedIds = [...new Set((studentIds || []).map((id) => String(id)))]
    .filter(Boolean);

  if (normalizedIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new ApiError(400, 'studentIds inválidos');
  }

  const normalizedFilters = normalizePrintCardFilters(filters);

  let where = {};
  if (normalizedIds.length) {
    where = { _id: { $in: normalizedIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  } else {
    where.activeStatus = 'ACTIVE';

    if (normalizedFilters.q) {
      const queryRegex = buildAccentInsensitiveRegex(normalizedFilters.q);
      if (queryRegex) {
        const people = await Person.find({
          $or: [{ names: queryRegex }, { lastNames: queryRegex }, { dni: queryRegex }],
        }).select('_id').lean();

        where.$or = [
          { internalCode: queryRegex },
          ...(people.length ? [{ personId: { $in: people.map((row) => row._id) } }] : []),
        ];
      }
    }
  }

  const students = await Student.find(where)
    .select('_id personId internalCode activeStatus')
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .lean();

  const contextByStudentId = await resolvePrintCardsContext(students.map((student) => student._id));
  let items = students.map((student) => mapStudentPrintCard(student, contextByStudentId));

  if (!normalizedIds.length) {
    items = items.filter((item) => matchesPrintCardFilters(item, normalizedFilters));
    items.sort((a, b) => String(a.lastNames || '').localeCompare(String(b.lastNames || ''), 'es') || String(a.names || '').localeCompare(String(b.names || ''), 'es'));
  } else {
    const orderById = new Map(normalizedIds.map((id, index) => [id, index]));
    items.sort((a, b) => (orderById.get(String(a.studentId)) ?? 999999) - (orderById.get(String(b.studentId)) ?? 999999));
  }

  return {
    items: items.map(({ level, ...row }) => row),
  };
}

export async function getStudentSummaryService(studentId) {
  if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'id inválido');

  const student = await Student.findById(studentId).populate('personId').lean();
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

  const paidCharges = await Charge.find({ studentId: student._id, status: 'PAID' })
    .select('_id')
    .lean();
  const paymentAllocations = paidCharges.length
    ? await PaymentAllocation.find({ chargeId: { $in: paidCharges.map((charge) => charge._id) } })
      .select('paymentId')
      .lean()
    : [];
  const lastPayment = paymentAllocations.length
    ? await Payment.findOne({ _id: { $in: paymentAllocations.map((row) => row.paymentId) } }).sort({ paidAt: -1 }).lean()
    : null;

  const sendStudent = {
    id: student._id.toString(),
    dni: person?.dni || null,
    gender: person?.gender || null,
    phone: person?.phone || null,
    address: person?.address || null,
    internalCode: student?.internalCode || null,
    bankCode: student?.bankCode || null,
    names: person?.names || null,
    lastNames: person?.lastNames || null,
    birthDate: person?.birthDate || null,
    campusCode: latestVacancy?.classroomId?.campusId?.code || null,
    previousCampus: student?.previousCampus || null,
    activeStatus: student.activeStatus,
  }
  const tutorLink = {
    address: null,
    primaryTutor: primaryTutor ? {
      lastNames: primaryTutor.tutorPersonId?.lastNames || null,
      names: primaryTutor.tutorPersonId?.names || null,
      phone: primaryTutor.tutorPersonId?.phone || null,
      relationship: primaryTutor.relationship || null,
      livesWithStudent: primaryTutor.livesWithStudent ?? null
    } : null,
    primaryTutor_send: primaryTutor? {
          lastNames: primaryTutor.tutorPersonId?.lastNames || null,
          names: primaryTutor.tutorPersonId?.names || null,
          phone: primaryTutor.tutorPersonId?.phone || null,
          relationship: primaryTutor.relationship || null,
          livesWithStudent: primaryTutor.livesWithStudent ?? null
        }
      : null,
    otherTutors: (otherTutors || []).map(tutor => ({
      lastNames: tutor.tutorPersonId?.lastNames || null,
      names: tutor.tutorPersonId?.names || null,
      phone: tutor.tutorPersonId?.phone || null,
      relationship: tutor.relationship || null,
      livesWithStudent: tutor.livesWithStudent ?? null
    })),
    otherTutors_send: (otherTutors || []).map(tutor => ({
      lastNames: tutor.tutorPersonId?.lastNames || null,
      names: tutor.tutorPersonId?.names || null,
      phone: tutor.tutorPersonId?.phone || null,
      relationship: tutor.relationship || null,
      livesWithStudent: tutor.livesWithStudent ?? null
    }))
  };
  // console.log('[sendStudent][dbg] content=', sendStudent);
  // console.log('[Student][dbg] content=', student);
  // console.log('[tutorLink][dbg] content=', tutorLink);

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
    tutorLink,
    familyLink: tutorLink,
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
  ensureCampusAccess({ campus: normalized, campusScope });
  const normalizedLimit = Math.max(1, Math.min(50, toNumber(limit, 20)));

  const campuses = await Campus.find({ code: { $in: codes } }).select('_id').lean();
  if (!campuses.length) {
    return { campus: normalized, items: [], nextCursor: null };
  }

  const activeCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  const studentCycleFilter = { campusId: { $in: campuses.map((c) => c._id) } };
  if (activeCycle?._id) {
    studentCycleFilter.cycleId = activeCycle._id;
  }

  const cycles = await StudentCycle.find(studentCycleFilter)
    .sort({ updatedAt: -1 })
    .select('studentId campusId')
    .lean();

  const studentIdSet = new Set();
  const studentIds = [];
  for (const row of cycles) {
    const key = String(row.studentId);
    if (!studentIdSet.has(key)) {
      studentIdSet.add(key);
      studentIds.push(row.studentId);
    }
  }
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

  const hasMore = rows.length > normalizedLimit;
  const selected = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const items = await buildStudentResponse(selected);

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
    .lean();

  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const cycle = await resolveCycleForDetail(cycleId);

  const tutors = await Tutor.find({ studentId: student._id })
    .sort({ isPrimary: -1, _id: 1 })
    .limit(10)
    .populate('tutorPersonId')
    .lean();

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

function getTuitionMonthLabel(monthIndex) {
  const labels = ['Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex < labels.length ? labels[monthIndex] : null;
}

function buildChargeLabel(charge) {
  const baseLabel = charge.conceptId?.name || charge.description || charge.concept || 'Cargo';
  if (charge.concept === 'TUITION') {
    const monthLabel = getTuitionMonthLabel(charge.monthIndex);
    if (monthLabel) return `${baseLabel} - ${monthLabel}`;
  }
  return baseLabel;
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
      .populate({ path: 'chargeId', populate: { path: 'conceptId', select: 'name' } })
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
      internalCode: allocation.paymentId.internalCode || null,
      receiptNumber: allocation.paymentId.receiptNumber || null,
      note: allocation.paymentId.notes || null,
      allocations: [],
    };
    previous.amount = roundMoney(previous.amount + money(allocation.amount));
    if (allocation.chargeId?._id) {
      const allocationAmount = roundMoney(money(allocation.amount));
      const chargeTotalAmount = roundMoney(money(allocation.chargeId?.totalAmount));
      previous.allocations.push({
        chargeId: String(allocation.chargeId._id),
        amount: allocationAmount,
        concept: buildChargeLabel(allocation.chargeId),
        isPartial: allocationAmount < chargeTotalAmount,
      });
    }
    paymentById.set(key, previous);
  }

  const charges = chargesDb.map((charge) => {
    const amount = roundMoney(money(charge.totalAmount));
    const outstandingAmount = roundMoney(money(charge.outstandingAmount));
    const status = mapChargeStatus({ amount, outstandingAmount, dueDate: charge.dueDate });

    return {
      id: charge._id.toString(),
      concept: buildChargeLabel(charge),
      description: charge.description || null,
      monthIndex: charge.monthIndex ?? null,
      conceptCode: charge.concept || null,
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

  const updatedPerson = await updatePersonById(student.personId._id, normalizePersonUpdatePayload({ $set: personUpdates }));
  if (!updatedPerson) {
    throw new ApiError(404, 'No se pudo actualizar la persona del estudiante');
  }

  if (actor) {
    await registerAuditLog({
      entityType: 'CHARGE',
      entityId: student._id,
      action: 'STUDENT_IDENTITY_UPDATED',
      performedBy: actor,
      payloadSnapshot: { studentId, updates: personUpdates },
    });
  }

  const summary = await getStudentSummaryService(studentId);
  return { ok: true, student: summary.student, summary };
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
