import mongoose from 'mongoose';
import { Person } from '../../models/person.model.js';
import { Student } from '../../models/student.model.js';
import { Counter } from '../../models/counter.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Payment } from '../../models/payment.model.js';
import { Charge } from '../../models/charge.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent, NO_APLICA_PENSION } from '../../models/enrollmentStudent.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AttendanceMonthlySummary } from '../../models/attendanceMonthlySummary.model.js';
import { ContractSnapshot } from '../../models/contractSnapshot.model.js';
import { ExamPass } from '../../models/examPass.model.js';
import { Grade } from '../../models/grade.model.js';
import { ProgramEnrollment } from '../../models/programEnrollment.model.js';
import { User } from '../../models/user.model.js';
import { ApiError } from '../../utils/errors.js';
import { getClassroomCapacityService } from '../enrollments/enrollments.service.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { buildAccentInsensitiveRegex, normalizeSearchTerm } from '../../utils/search.js';
import { normalizePersonNameFields, normalizePersonUpdatePayload } from '../../utils/personNameFormatter.js';
import { getEnrollmentContextForStudent, getEnrollmentContextMapByStudentIds, updateEnrollmentStatusForStudent } from '../../shared/enrollmentCurrent.js';
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

function normalizeBankCodeValue(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeLegacyBankCodes(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeBankCodeValue(value))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

async function assertBankCodeAvailable(bankCode, currentStudentId = null) {
  const normalizedBankCode = normalizeBankCodeValue(bankCode);
  if (!normalizedBankCode) return;

  const duplicatedStudent = await Student.findOne({
    _id: currentStudentId ? { $ne: currentStudentId } : { $exists: true },
    $or: [
      { bankCode: normalizedBankCode },
      { legacyBankCodes: normalizedBankCode },
    ],
  })
    .select('_id')
    .lean();

  if (duplicatedStudent) {
    throw new ApiError(409, 'Cod. Caja Arequipa ya esta asignado a otro estudiante');
  }
}

function buildBankCodeUpdateState(student, nextBankCodeInput) {
  const currentBankCode = normalizeBankCodeValue(student?.bankCode);
  const nextBankCode = normalizeBankCodeValue(nextBankCodeInput);
  const nextLegacyBankCodes = normalizeLegacyBankCodes(student?.legacyBankCodes);

  if (currentBankCode && currentBankCode !== nextBankCode) {
    nextLegacyBankCodes.push(currentBankCode);
  }

  const dedupedLegacy = normalizeLegacyBankCodes(nextLegacyBankCodes).filter((code) => code !== nextBankCode);

  return {
    bankCode: nextBankCode,
    legacyBankCodes: dedupedLegacy,
  };
}

function mapTutorLinkSummary(tutor) {
  if (!tutor) return null;

  return {
    id: tutor._id?.toString() || null,
    personId: tutor.tutorPersonId?._id?.toString() || null,
    lastNames: tutor.tutorPersonId?.lastNames || null,
    names: tutor.tutorPersonId?.names || null,
    dni: tutor.tutorPersonId?.dni || null,
    phone: tutor.tutorPersonId?.phone || null,
    gender: tutor.tutorPersonId?.gender || null,
    relationship: tutor.relationship || null,
    isPrimary: tutor.isPrimary ?? null,
    livesWithStudent: tutor.livesWithStudent ?? null,
    notes: tutor.notes || null,
  };
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
    throw new ApiError(400, 'No hay ciclo escolar activo para crear matrícula');
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

  const [contexts, chargeTotals] = await Promise.all([
    getEnrollmentContextMapByStudentIds(studentIds, { cycleId: activeCycle?._id || null }),
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

  const debtByStudent = new Map(
    chargeTotals.map((row) => [String(row._id), roundMoney(Number(row.totalDebt || 0))])
  );

  return items.map((student) => {
    const person = student.personId;
    const context = contexts.get(String(student._id));
    const classroom = context?.classroom || null;
    const campus = context?.campus || null;
    const enrollment = context?.enrollment || null;

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
      enrollmentStatus: enrollment?.status || null,
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

    // El alumno existe como identidad; la matrícula del ciclo guarda su estado actual.
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

      const enrollment = await Enrollment.create([{
        cycleId: cycle._id,
        campusId: classroom.campusId,
        status: 'ABSENT',
        notes,
      }], { session }).then((rows) => rows[0]);

      const enrollmentStudent = await EnrollmentStudent.create([{
        enrollmentId: enrollment._id,
        studentId: studentDoc._id,
        classroomId: classroom._id,
        previousSchoolType: 'OTHER',
        previousSchoolName: 'EXTERNO',
        pensionMonthlyAmounts: Array(10).fill(NO_APLICA_PENSION),
      }], { session }).then((rows) => rows[0]);

      await Enrollment.updateOne(
        { _id: enrollment._id },
        { $set: { enrollmentStudents: [enrollmentStudent._id] } },
        { session }
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
      ? Student.find({ $or: [{ internalCode: qRegex }, { bankCode: qRegex }, { legacyBankCodes: qRegex }] })
        .select('_id personId internalCode bankCode legacyBankCodes')
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
    .select('_id personId internalCode bankCode legacyBankCodes')
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .lean();
  const mapped = students
    .filter((student) => student.personId)
    .map((student) => ({
      _id: student._id,
      internalCode: student.internalCode || null,
      bankCode: student.bankCode || null,
      legacyBankCodes: normalizeLegacyBankCodes(student.legacyBankCodes),
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
  const normalizedLimit = Math.max(1, Math.min(2500, toNumber(limit, 20)));
  const items = await searchUnassignedStudentsModuleService({ q: term, limit: normalizedLimit, campusScope: 'ALL' });

  return { q: term, items };
}

export async function searchUnassignedStudentsService({ limit = 20, cursor }) {
  const normalizedLimit = Math.max(1, Math.min(2500, toNumber(limit, 20)));

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

  const enrollmentContexts = await getEnrollmentContextMapByStudentIds(uniqueStudentIds, { cycleId: activeCycle._id });

  const context = new Map();
  uniqueStudentIds.forEach((studentId) => {
    const key = String(studentId);
    const current = enrollmentContexts.get(key);
    const classroom = current?.classroom || null;
    const campusCode = current?.campus?.code || null;

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
  const activeCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  const person = student.personId;

  const primaryTutor = await Tutor.findOne({ studentId: student._id, isPrimary: true })
    .populate('tutorPersonId')
    .lean();
  // console.log('[primaryTutor][dbg] content=', primaryTutor);

  const otherTutors = await Tutor.find({ studentId: student._id, isPrimary: false })
    .populate('tutorPersonId')
    .lean();

  const currentEnrollment = await getEnrollmentContextForStudent(student._id, { cycleId: activeCycle?._id || null });

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
    campusCode: currentEnrollment?.campus?.code || null,
    previousCampus: student?.previousCampus || null,
    activeStatus: student.activeStatus,
    notes: student?.notes || null,
    internalNotes: student?.internalNotes || null,
  }
  const tutorLink = {
    address: null,
    primaryTutor: mapTutorLinkSummary(primaryTutor),
    primaryTutor_send: mapTutorLinkSummary(primaryTutor),
    otherTutors: (otherTutors || []).map((tutor) => mapTutorLinkSummary(tutor)),
    otherTutors_send: (otherTutors || []).map((tutor) => mapTutorLinkSummary(tutor))
  };
  // console.log('[sendStudent][dbg] content=', sendStudent);
  // console.log('[Student][dbg] content=', student);
  // console.log('[tutorLink][dbg] content=', tutorLink);

  const sendCurrentEnrollment = currentEnrollment ? {
    id: String(currentEnrollment.enrollment._id),
    status: currentEnrollment.enrollment.status || null,
    cycleId: currentEnrollment.cycle?._id?.toString() || String(currentEnrollment.enrollment.cycleId || ''),
    cycleName: currentEnrollment.cycle?.name || null,
    classroomId: currentEnrollment.classroom?._id?.toString() || null,
    classroom: currentEnrollment.classroom ? {
      id: String(currentEnrollment.classroom._id),
      displayName: currentEnrollment.classroom.displayName || null,
      grade: currentEnrollment.classroom.grade || null,
      section: currentEnrollment.classroom.section || null,
      level: currentEnrollment.classroom.level || null,
    } : null,
    campus: currentEnrollment.campus ? {
      id: String(currentEnrollment.campus._id),
      code: currentEnrollment.campus.code || null,
      name: currentEnrollment.campus.name || null,
    } : null,
    confirmedAt: currentEnrollment.enrollment.confirmedAt || null,
    transferredAt: currentEnrollment.enrollment.transferredAt || null,
    notes: currentEnrollment.enrollment.notes || null,
  } : null;

  return {
    student: sendStudent,
    tutorLink,
    currentEnrollment: sendCurrentEnrollment,
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
  const normalizedLimit = Math.max(1, Math.min(2500, toNumber(limit, 20)));

  const campuses = await Campus.find({ code: { $in: codes } }).select('_id').lean();
  if (!campuses.length) {
    return { campus: normalized, items: [], nextCursor: null };
  }

  const activeCycle = await Cycle.findOne({ isActive: true })
    .sort({ year: -1, startDate: -1, _id: -1 })
    .select('_id')
    .lean();

  const enrollments = await Enrollment.find({
    ...(activeCycle?._id ? { cycleId: activeCycle._id } : {}),
    campusId: { $in: campuses.map((c) => c._id) },
  }).select('_id').lean();
  const enrollmentStudents = enrollments.length
    ? await EnrollmentStudent.find({ enrollmentId: { $in: enrollments.map((row) => row._id) } }).select('studentId').lean()
    : [];
  const studentIds = [...new Set(enrollmentStudents.map((row) => row.studentId))];
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

  const currentEnrollment = cycle
    ? await getEnrollmentContextForStudent(student._id, { cycleId: cycle._id })
    : await getEnrollmentContextForStudent(student._id);

  return {
    student,
    notes: student.notes || null,
    internalNotes: student.internalNotes || null,
    person: student.personId || null,
    tutors,
    currentCycle: cycle ? {
      _id: cycle._id,
      name: cycle.name,
      year: cycle.year,
      type: cycle.type,
    } : null,
    currentEnrollment: currentEnrollment ? {
      id: String(currentEnrollment.enrollment._id),
      status: currentEnrollment.enrollment.status,
      cycleId: String(currentEnrollment.enrollment.cycleId),
      cycleName: currentEnrollment.cycle?.name || null,
      campus: currentEnrollment.campus ? {
        id: String(currentEnrollment.campus._id),
        code: currentEnrollment.campus.code || null,
        name: currentEnrollment.campus.name || null,
      } : null,
      classroomId: currentEnrollment.classroom?._id ? String(currentEnrollment.classroom._id) : null,
      classroom: currentEnrollment.classroom || null,
      confirmedAt: currentEnrollment.enrollment.confirmedAt || null,
      transferredAt: currentEnrollment.enrollment.transferredAt || null,
      notes: currentEnrollment.enrollment.notes || null,
    } : null,
  };
}

export async function updateStudentEnrollmentStatusService(studentId, { cycleId, status, reason }, userId = null) {
  const student = await Student.findById(studentId).lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  const cycle = await Cycle.findById(cycleId).lean();
  if (!cycle) throw new ApiError(404, 'Ciclo no encontrado');

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

  const currentEnrollment = await getEnrollmentContextForStudent(studentId, { cycleId });
  const campusId = currentEnrollment?.campus?._id || currentEnrollment?.enrollment?.campusId || null;
  if (!campusId) throw new ApiError(400, 'No se pudo determinar campus para el estado del ciclo');

  if (status === 'TRANSFERRED' || status === 'ABSENT') {
    await Vacancy.deleteOne({ studentId, cycleId });
  }

  const updated = await updateEnrollmentStatusForStudent({ studentId, cycleId, status, reason, userId });

  if (status === 'TRANSFERRED' && userId) {
    await registerAuditLog({
      entityType: 'TRANSFER',
      entityId: updated?._id || currentEnrollment?.enrollment?._id || studentId,
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

      const currentEnrollment = await getEnrollmentContextForStudent(studentId, { cycleId, session });
      if (currentEnrollment?.campus?._id && String(currentEnrollment.campus._id) !== String(classroom.campusId)) {
        throw new ApiError(400, 'Solo se puede cambiar al alumno a otro salón del mismo campus');
      }
      if (currentEnrollment?.enrollment?._id) {
        await EnrollmentStudent.updateOne(
        { _id: currentEnrollment.enrollmentStudent._id },
        { $set: { classroomId } },
        { session }
      );
      await Enrollment.updateOne(
        { _id: currentEnrollment.enrollment._id },
        { $set: { campusId: classroom.campusId } },
        { session }
      );
    }

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
  const conceptCode = String(charge.conceptId?.code || '').trim().toUpperCase();
  const customDescription = String(charge.customDescription || '').trim();
  if (conceptCode === 'OTHER' && customDescription) return `${baseLabel} — ${customDescription}`;
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
  const activeCycle = await resolveCurrentCycle();
  const enrollmentContext = activeCycle
    ? await getEnrollmentContextForStudent(studentId, { cycleId: activeCycle._id })
    : await getEnrollmentContextForStudent(studentId);
  const vacancy = activeCycle
    ? await Vacancy.findOne({ studentId: student._id, cycleId: activeCycle._id }).lean()
    : null;
  const vacancyClassroom = vacancy?.classroomId
    ? await Classroom.findById(vacancy.classroomId).select('displayName').lean()
    : null;
  const gradeDisplayName = enrollmentContext?.classroom?.displayName || vacancyClassroom?.displayName || null;

  const chargesDb = await Charge.find({ studentId: student._id, status: { $ne: 'CANCELLED' } })
    .populate('conceptId', 'name code')
    .sort({ dueDate: 1, _id: 1 })
    .lean();

  const chargeIds = chargesDb.map((charge) => charge._id);
  const allocations = chargeIds.length
    ? await PaymentAllocation.find({ chargeId: { $in: chargeIds } })
      .populate('paymentId')
      .populate({ path: 'chargeId', populate: { path: 'conceptId', select: 'name code' } })
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
      voucherNumber: allocation.paymentId.voucherNumber || null,
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
      customDescription: charge.customDescription || null,
      monthIndex: charge.monthIndex ?? null,
      conceptCode: charge.conceptId?.code || charge.concept || null,
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
      internalCode: student.internalCode || null,
      code: student.internalCode || null,
      bankCode: student.bankCode || null,
      classroomDisplayName: gradeDisplayName,
      gradeDisplayName,
      cycleName: enrollmentContext?.cycle?.name || activeCycle?.name || null,
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

  const studentUpdates = {};
  if (payload.bankCode !== undefined) {
    await assertBankCodeAvailable(payload.bankCode, studentId);
    Object.assign(studentUpdates, buildBankCodeUpdateState(student, payload.bankCode));
  }

  if (!Object.keys(personUpdates).length && !Object.keys(studentUpdates).length) {
    throw new ApiError(400, 'No se enviaron cambios de identidad vÃ¡lidos');
  }

  if (Object.keys(personUpdates).length) {
    const updatedPerson = await updatePersonById(student.personId._id, normalizePersonUpdatePayload({ $set: personUpdates }));
    if (!updatedPerson) {
      throw new ApiError(404, 'No se pudo actualizar la persona del estudiante');
    }
  }

  if (Object.keys(studentUpdates).length) {
    try {
      const updatedStudent = await updateStudentById(studentId, { $set: studentUpdates });
      if (!updatedStudent) {
        throw new ApiError(404, 'No se pudo actualizar el estudiante');
      }
    } catch (error) {
      if (error?.code === 11000 && error?.keyPattern?.bankCode) {
        throw new ApiError(409, 'Cod. Caja Arequipa ya estÃ¡ asignado a otro estudiante');
      }
      throw error;
    }
  }

  if (actor) {
    await registerAuditLog({
      entityType: 'CHARGE',
      entityId: student._id,
      action: 'STUDENT_IDENTITY_UPDATED',
      performedBy: actor,
      payloadSnapshot: { studentId, personUpdates, studentUpdates },
    });
  }

  const summary = await getStudentSummaryService(studentId);
  return { ok: true, student: summary.student, summary };
}

export async function updateStudentInternalNotesService(studentId, internalNotes, actor = null) {
  const student = await updateStudentById(studentId, { $set: { notes: internalNotes } });
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  if (actor) {
    await registerAuditLog({
      entityType: 'STUDENT',
      entityId: student._id,
      action: 'STUDENT_NOTES_UPDATED',
      performedBy: actor,
      payloadSnapshot: { studentId, notes: internalNotes },
    });
  }

  return { ok: true, student };
}


export async function updateStudentBankCodeService(studentId, bankCode, actor = null) {
  const student = await Student.findById(studentId).lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');

  await assertBankCodeAvailable(bankCode, studentId);
  const nextState = buildBankCodeUpdateState(student, bankCode);

  try {
    const updated = await updateStudentById(studentId, { $set: nextState });

    if (actor) {
      await registerAuditLog({
        entityType: 'STUDENT',
        entityId: studentId,
        action: 'STUDENT_BANK_CODE_UPDATED',
        performedBy: actor,
        payloadSnapshot: { studentId, bankCode: nextState.bankCode, legacyBankCodes: nextState.legacyBankCodes },
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

async function buildStudentDeletionSummary(studentId) {
  if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');

  const student = await Student.findById(studentId).populate('personId').lean();
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');
  const activeCycle = await resolveCurrentCycle();
  const enrollmentContext = activeCycle
    ? await getEnrollmentContextForStudent(studentId, { cycleId: activeCycle._id })
    : await getEnrollmentContextForStudent(studentId);

  const [
    tutorRows,
    vacancyCount,
    enrollmentStudentRows,
    paymentRows,
    chargeRows,
    attendanceRecordCount,
    attendanceSummaryCount,
    contractSnapshotCount,
    examPassCount,
    gradeCount,
    programEnrollmentCount,
    linkedUser,
  ] = await Promise.all([
    Tutor.find({ studentId: student._id }).select('_id tutorPersonId').lean(),
    Vacancy.countDocuments({ studentId: student._id }),
    EnrollmentStudent.find({ studentId: student._id }).select('_id enrollmentId').lean(),
    Payment.find({ $or: [{ studentId: student._id }, { studentIds: student._id }] }).select('_id').lean(),
    Charge.find({ studentId: student._id }).select('_id').lean(),
    AttendanceRecord.countDocuments({ studentId: student._id }),
    AttendanceMonthlySummary.countDocuments({ studentId: student._id }),
    ContractSnapshot.countDocuments({ 'students.studentId': student._id }),
    ExamPass.countDocuments({ studentId: student._id }),
    Grade.countDocuments({ studentId: student._id }),
    ProgramEnrollment.countDocuments({ studentId: student._id }),
    User.findOne({ personId: student.personId?._id }).select('_id email roles').lean(),
  ]);

  const enrollmentIds = [...new Set(enrollmentStudentRows.map((row) => String(row.enrollmentId)).filter(Boolean))];
  const paymentIds = paymentRows.map((row) => row._id);
  const chargeIds = chargeRows.map((row) => row._id);

  const [paymentAllocationCount, orphanEnrollmentCount] = await Promise.all([
    paymentIds.length || chargeIds.length
      ? PaymentAllocation.countDocuments({
        $or: [
          ...(paymentIds.length ? [{ paymentId: { $in: paymentIds } }] : []),
          ...(chargeIds.length ? [{ chargeId: { $in: chargeIds } }] : []),
        ],
      })
      : 0,
    enrollmentIds.length
      ? Enrollment.countDocuments({ _id: { $in: enrollmentIds } })
      : 0,
  ]);

  return {
    student: {
      id: String(student._id),
      internalCode: student.internalCode || null,
      code: student.internalCode || null,
      bankCode: student.bankCode || null,
      classroomDisplayName: enrollmentContext?.classroom?.displayName || null,
      gradeDisplayName: enrollmentContext?.classroom?.displayName || null,
      cycleName: enrollmentContext?.cycle?.name || null,
      names: student.personId?.names || null,
      lastNames: student.personId?.lastNames || null,
      dni: student.personId?.dni || null,
    },
    impacts: {
      student: 1,
      studentPerson: student.personId?._id ? 1 : 0,
      tutorRelations: tutorRows.length,
      tutorPersonsPreserved: tutorRows.filter((row) => row.tutorPersonId).length,
      vacancies: vacancyCount,
      enrollments: orphanEnrollmentCount,
      enrollmentStudents: enrollmentStudentRows.length,
      charges: chargeRows.length,
      payments: paymentRows.length,
      paymentAllocations: paymentAllocationCount,
      attendanceRecords: attendanceRecordCount,
      attendanceMonthlySummaries: attendanceSummaryCount,
      contractSnapshots: contractSnapshotCount,
      examPasses: examPassCount,
      grades: gradeCount,
      programEnrollments: programEnrollmentCount,
      linkedUsers: linkedUser ? 1 : 0,
    },
    warnings: [
      'Se eliminará el alumno y toda su información operativa asociada del sistema.',
      'Las personas de los tutores no se eliminarán; solo se eliminarán sus vínculos con este alumno.',
      ...(linkedUser ? ['La persona del alumno tiene un usuario asociado y también será eliminado.'] : []),
    ],
  };
}

export async function getStudentDeletionPreviewService(studentId) {
  return buildStudentDeletionSummary(studentId);
}

export async function deleteStudentService(studentId, actor = null) {
  const preview = await buildStudentDeletionSummary(studentId);

  await runInTransaction(async (session) => {
    const studentObjectId = new mongoose.Types.ObjectId(studentId);
    const student = await Student.findById(studentObjectId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const paymentRows = await Payment.find({
      $or: [{ studentId: studentObjectId }, { studentIds: studentObjectId }],
    }).select('_id').session(session);
    const paymentIds = paymentRows.map((row) => row._id);

    const chargeRows = await Charge.find({ studentId: studentObjectId }).select('_id').session(session);
    const chargeIds = chargeRows.map((row) => row._id);

    const enrollmentStudentRows = await EnrollmentStudent.find({ studentId: studentObjectId })
      .select('_id enrollmentId')
      .session(session);
    const enrollmentStudentIds = enrollmentStudentRows.map((row) => row._id);
    const enrollmentIds = [...new Set(enrollmentStudentRows.map((row) => String(row.enrollmentId)).filter(Boolean))]
      .map((id) => new mongoose.Types.ObjectId(id));

    if (paymentIds.length || chargeIds.length) {
      await PaymentAllocation.deleteMany({
        $or: [
          ...(paymentIds.length ? [{ paymentId: { $in: paymentIds } }] : []),
          ...(chargeIds.length ? [{ chargeId: { $in: chargeIds } }] : []),
        ],
      }).session(session);
    }

    if (paymentIds.length) {
      await Payment.deleteMany({ _id: { $in: paymentIds } }).session(session);
    }

    if (chargeIds.length) {
      await Charge.deleteMany({ _id: { $in: chargeIds } }).session(session);
    }

    await Tutor.deleteMany({ studentId: studentObjectId }).session(session);
    await Vacancy.deleteMany({ studentId: studentObjectId }).session(session);
    await AttendanceRecord.deleteMany({ studentId: studentObjectId }).session(session);
    await AttendanceMonthlySummary.deleteMany({ studentId: studentObjectId }).session(session);
    await ContractSnapshot.deleteMany({ 'students.studentId': studentObjectId }).session(session);
    await ExamPass.deleteMany({ studentId: studentObjectId }).session(session);
    await Grade.deleteMany({ studentId: studentObjectId }).session(session);
    await ProgramEnrollment.deleteMany({ studentId: studentObjectId }).session(session);

    if (enrollmentStudentIds.length) {
      await Enrollment.updateMany(
        { _id: { $in: enrollmentIds } },
        { $pull: { enrollmentStudents: { $in: enrollmentStudentIds } } },
        { session }
      );
      await EnrollmentStudent.deleteMany({ _id: { $in: enrollmentStudentIds } }).session(session);
    }

    if (enrollmentIds.length) {
      const remainingByEnrollment = await EnrollmentStudent.aggregate([
        { $match: { enrollmentId: { $in: enrollmentIds } } },
        { $group: { _id: '$enrollmentId', count: { $sum: 1 } } },
      ]).session(session);
      const remainingMap = new Map(remainingByEnrollment.map((row) => [String(row._id), Number(row.count || 0)]));
      const emptyEnrollmentIds = enrollmentIds.filter((id) => !remainingMap.get(String(id)));
      if (emptyEnrollmentIds.length) {
        await Enrollment.deleteMany({ _id: { $in: emptyEnrollmentIds } }).session(session);
      }
    }

    if (student.personId) {
      await User.deleteMany({ personId: student.personId }).session(session);
    }

    await Student.deleteOne({ _id: studentObjectId }).session(session);

    if (student.personId) {
      await Person.deleteOne({ _id: student.personId }).session(session);
    }
  });

  if (actor) {
    try {
      await registerAuditLog({
        entityType: 'TRANSFER',
        entityId: new mongoose.Types.ObjectId(studentId),
        action: 'STUDENT_DELETED',
        performedBy: actor,
        payloadSnapshot: preview,
      });
    } catch (_error) {
      // Evita bloquear la eliminación si el audit log falla por enum o reglas futuras.
    }
  }

  return {
    ok: true,
    deletedStudentId: studentId,
    summary: preview,
  };
}
