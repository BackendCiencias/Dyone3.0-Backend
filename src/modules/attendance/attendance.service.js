import { AttendancePolicy } from '../../models/attendancePolicy.model.js';
import { AttendanceSession } from '../../models/attendanceSession.model.js';
import { AttendanceRecord } from '../../models/attendanceRecord.model.js';
import { AttendanceMonthlySummary } from '../../models/attendanceMonthlySummary.model.js';
import { Campus } from '../../models/campus.model.js';
import { Student } from '../../models/student.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent } from '../../models/enrollmentStudent.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { Person } from '../../models/person.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { ApiError } from '../../utils/errors.js';
import { getEnrollmentContextForStudent } from '../../shared/enrollmentCurrent.js';

function normalizeDateOnly(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function getYearMonth(dateValue) {
  const date = new Date(dateValue);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function compareTimes(left, right) {
  return String(left || '').localeCompare(String(right || ''));
}

function toFullName(person) {
  if (!person) return null;
  const lastNames = String(person.lastNames || '').trim();
  const names = String(person.names || '').trim();
  return `${lastNames}, ${names}`.replace(/^,\s*/, '').trim();
}

function buildSummaryDelta(record) {
  if (!record) {
    return {
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    };
  }

  return {
    presentCount: record.status === 'PRESENT' ? 1 : 0,
    lateCount: record.status === 'LATE' ? 1 : 0,
    absentCount: record.status === 'ABSENT' ? 1 : 0,
    justifiedLateCount: record.status === 'LATE' && record.justificationStatus === 'JUSTIFIED' ? 1 : 0,
    justifiedAbsentCount: record.status === 'ABSENT' && record.justificationStatus === 'JUSTIFIED' ? 1 : 0,
  };
}

function ensureAuxiliar(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  if (!roles.includes('AUXILIAR')) {
    throw new ApiError(403, 'Permisos insuficientes', 'ATTENDANCE_ROLE_FORBIDDEN');
  }
}

async function ensureCampusInScope({ campusId, campusScope = [] }) {
  if (Array.isArray(campusScope) && campusScope.includes('ALL')) return;

  const campus = await Campus.findById(campusId).select('code').lean();
  const campusCode = campus?.code || null;

  if (!campusCode || !campusScope.includes(campusCode)) {
    throw new ApiError(403, 'No autorizado para este campus', 'ATTENDANCE_CAMPUS_FORBIDDEN');
  }
}

async function resolveCampusScopeIds(campusScope = []) {
  if (Array.isArray(campusScope) && campusScope.includes('ALL')) {
    const campuses = await Campus.find({}).select('_id code name').lean();
    return campuses.map((campus) => ({
      id: String(campus._id),
      code: campus.code,
      name: campus.name || campus.code,
    }));
  }

  const campuses = await Campus.find({ code: { $in: campusScope } }).select('_id code name').lean();
  return campuses.map((campus) => ({
    id: String(campus._id),
    code: campus.code,
    name: campus.name || campus.code,
  }));
}

function getMonthDateRange(year, month) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

function buildSessionPayload(session) {
  return {
    id: String(session._id),
    scopeType: session.scopeType,
    campusId: String(session.campusId),
    cycleId: String(session.cycleId),
    date: formatDateOnly(session.date),
    expectedStartTime: session.expectedStartTime,
    onTimeUntil: session.onTimeUntil,
    lateUntil: session.lateUntil,
    status: session.status,
    takenByUserId: String(session.takenByUserId),
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    notes: session.notes || null,
  };
}

async function getAttendanceSessionOrThrow(sessionId) {
  const session = await AttendanceSession.findById(sessionId).lean();
  if (!session) {
    throw new ApiError(404, 'Sesión de asistencia no encontrada', 'ATTENDANCE_SESSION_NOT_FOUND');
  }
  return session;
}

async function resolveEffectiveAttendanceSchedule({ campusId, cycleId, overrides = {} }) {
  const policies = await AttendancePolicy.find({
    scopeType: 'REGULAR_STUDENT',
    campusId,
    cycleId,
    level: { $in: ['INITIAL', 'PRIMARY', 'SECONDARY'] },
    classroomId: null,
    programId: null,
    isActive: true,
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const representativePolicy = Array.isArray(policies) && policies.length
    ? [...policies].sort((left, right) => compareTimes(left?.defaultOnTimeUntil, right?.defaultOnTimeUntil))[0]
    : null;

  const onTimeUntil = overrides.onTimeUntil || representativePolicy?.defaultOnTimeUntil;
  const expectedStartTime = overrides.expectedStartTime || onTimeUntil;
  const lateUntil = overrides.lateUntil || null;

  if (!onTimeUntil) {
    throw new ApiError(400, 'Debe definir onTimeUntil', 'ATTENDANCE_SCHEDULE_REQUIRED');
  }

  return {
    expectedStartTime,
    onTimeUntil,
    lateUntil,
    attendancePolicyId: representativePolicy?._id || null,
    policyResolved: Boolean(representativePolicy),
  };
}

async function resolveStudentByCode(studentCode) {
  const student = await Student.findOne({ internalCode: String(studentCode || '').trim() })
    .select('_id internalCode activeStatus personId')
    .lean();

  if (!student) {
    throw new ApiError(404, 'Alumno no encontrado por código', 'ATTENDANCE_STUDENT_CODE_NOT_FOUND');
  }

  if (['INACTIVE', 'GRADUATED'].includes(student.activeStatus)) {
    throw new ApiError(409, 'Alumno no apto para asistencia operativa', 'ATTENDANCE_STUDENT_NOT_ACTIVE');
  }

  return student;
}

async function resolveEnrollmentForSession({ studentId, cycleId, campusId }) {
  const studentCycle = await getEnrollmentContextForStudent(studentId, { cycleId });

  if (!studentCycle?.enrollment) {
    throw new ApiError(409, 'Alumno sin matrícula válida para este ciclo', 'ATTENDANCE_ENROLLMENT_NOT_FOUND');
  }

  if (String(studentCycle.campus?._id || studentCycle.enrollment.campusId) !== String(campusId)) {
    throw new ApiError(409, 'Alumno fuera del campus de la sesión', 'ATTENDANCE_STUDENT_CAMPUS_MISMATCH');
  }

  if (studentCycle.enrollment.status !== 'ENROLLED') {
    throw new ApiError(409, 'Alumno no apto para asistencia', 'ATTENDANCE_ENROLLMENT_NOT_ACTIVE');
  }

  return studentCycle;
}

async function resolveStudentContext({ studentId, cycleId }) {
  const [student, vacancy] = await Promise.all([
    Student.findById(studentId).select('_id internalCode personId').lean(),
    Vacancy.findOne({ studentId, cycleId }).select('classroomId').lean(),
  ]);

  const [person, classroom] = await Promise.all([
    student?.personId ? Person.findById(student.personId).select('_id names lastNames').lean() : null,
    vacancy?.classroomId ? Classroom.findById(vacancy.classroomId).select('_id displayName level').lean() : null,
  ]);

  return { student, person, classroom };
}

async function resolveAttendancePolicyForLevel({ campusId, cycleId, level }) {
  if (!level) return null;

  return AttendancePolicy.findOne({
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
}

async function getMonthlySummaryForStudent({ studentId, sessionDate }) {
  const { year, month } = getYearMonth(sessionDate);
  const rows = await AttendanceMonthlySummary.find({ studentId, year, month })
    .select('presentCount lateCount absentCount justifiedLateCount justifiedAbsentCount')
    .lean();

  return rows.reduce((acc, row) => ({
    year,
    month,
    presentCount: acc.presentCount + (row.presentCount || 0),
    lateCount: acc.lateCount + (row.lateCount || 0),
    absentCount: acc.absentCount + (row.absentCount || 0),
    justifiedLateCount: acc.justifiedLateCount + (row.justifiedLateCount || 0),
    justifiedAbsentCount: acc.justifiedAbsentCount + (row.justifiedAbsentCount || 0),
  }), {
    year,
    month,
    presentCount: 0,
    lateCount: 0,
    absentCount: 0,
    justifiedLateCount: 0,
    justifiedAbsentCount: 0,
  });
}

async function syncMonthlySummaryForRecordChange({ before, after, context }) {
  const changes = [];
  if (before) changes.push({ record: before, sign: -1 });
  if (after) changes.push({ record: after, sign: 1 });

  for (const change of changes) {
    const record = change.record;
    const delta = buildSummaryDelta(record);
    const { year, month } = getYearMonth(record.sessionDate || context.sessionDate);

    await AttendanceMonthlySummary.findOneAndUpdate(
      {
        studentId: record.studentId,
        year,
        month,
        classroomId: record.classroomId || null,
      },
      {
        $setOnInsert: {
          studentId: record.studentId,
          campusId: record.campusId || context.campusId,
          cycleId: record.cycleId || context.cycleId,
          classroomId: record.classroomId || null,
          year,
          month,
        },
        $inc: {
          presentCount: change.sign * delta.presentCount,
          lateCount: change.sign * delta.lateCount,
          absentCount: change.sign * delta.absentCount,
          justifiedLateCount: change.sign * delta.justifiedLateCount,
          justifiedAbsentCount: change.sign * delta.justifiedAbsentCount,
        },
        $set: { updatedAt: new Date() },
      },
      { upsert: true }
    );
  }
}

async function buildLatestRecordsPayload({ session, limit = 10, q = '' }) {
  const normalizedQuery = String(q || '').trim().toLowerCase();
  const fetchLimit = normalizedQuery ? Math.max(limit * 5, 50) : limit;

  const records = await AttendanceRecord.find({ sessionId: session._id })
    .sort({ markedAt: -1, _id: -1 })
    .limit(fetchLimit)
    .select('studentId status arrivalTime markedAt justificationStatus justificationReason')
    .lean();

  const studentIds = records.map((row) => row.studentId).filter(Boolean);
  if (!studentIds.length) return [];

  const [students, vacancies, summaries] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).select('_id internalCode personId').lean(),
    Vacancy.find({ studentId: { $in: studentIds }, cycleId: session.cycleId }).select('studentId classroomId').lean(),
    AttendanceMonthlySummary.find({ studentId: { $in: studentIds }, ...getYearMonth(session.date) })
      .select('studentId lateCount absentCount justifiedLateCount justifiedAbsentCount')
      .lean(),
  ]);

  const personIds = students.map((row) => row.personId).filter(Boolean);
  const classroomIds = vacancies.map((row) => row.classroomId).filter(Boolean);
  const [people, classrooms] = await Promise.all([
    personIds.length ? Person.find({ _id: { $in: personIds } }).select('_id names lastNames').lean() : [],
    classroomIds.length ? Classroom.find({ _id: { $in: classroomIds } }).select('_id displayName').lean() : [],
  ]);

  const studentById = new Map(students.map((row) => [String(row._id), row]));
  const personById = new Map(people.map((row) => [String(row._id), row]));
  const vacancyByStudentId = new Map(vacancies.map((row) => [String(row.studentId), row]));
  const classroomById = new Map(classrooms.map((row) => [String(row._id), row]));
  const summaryByStudentId = new Map();

  summaries.forEach((row) => {
    const key = String(row.studentId);
    const current = summaryByStudentId.get(key) || {
      lateCount: 0,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    };
    current.lateCount += row.lateCount || 0;
    current.absentCount += row.absentCount || 0;
    current.justifiedLateCount += row.justifiedLateCount || 0;
    current.justifiedAbsentCount += row.justifiedAbsentCount || 0;
    summaryByStudentId.set(key, current);
  });

  const payload = records.map((record) => {
    const student = studentById.get(String(record.studentId));
    const person = personById.get(String(student?.personId || ''));
    const vacancy = vacancyByStudentId.get(String(record.studentId));
    const classroom = classroomById.get(String(vacancy?.classroomId || ''));
    return {
      recordId: String(record._id),
      studentId: String(record.studentId),
      studentCode: student?.internalCode || null,
      person: { fullName: toFullName(person) },
      classroom: classroom ? { id: String(classroom._id), displayName: classroom.displayName } : null,
      attendance: {
        status: record.status,
        arrivalTime: record.arrivalTime,
        markedAt: record.markedAt,
        justificationStatus: record.justificationStatus || 'NONE',
        justificationReason: record.justificationReason || null,
      },
      monthlySummary: summaryByStudentId.get(String(record.studentId)) || {
        lateCount: 0,
        absentCount: 0,
        justifiedLateCount: 0,
        justifiedAbsentCount: 0,
      },
    };
  });

  if (!normalizedQuery) {
    return payload.slice(0, limit);
  }

  return payload
    .filter((item) => {
      const fullName = String(item?.person?.fullName || '').toLowerCase();
      const studentCode = String(item?.studentCode || '').toLowerCase();
      return fullName.includes(normalizedQuery) || studentCode.includes(normalizedQuery);
    })
    .slice(0, limit);
}

async function resolveExpectedStudentsForSession(session) {
  const enrollments = await Enrollment.find({
    cycleId: session.cycleId,
    campusId: session.campusId,
    status: 'ENROLLED',
  }).select('_id').lean();
  const cycles = enrollments.length
    ? await EnrollmentStudent.find({ enrollmentId: { $in: enrollments.map((row) => row._id) } }).select('enrollmentId studentId').lean()
    : [];

  const studentIds = cycles.map((row) => row.studentId);
  if (!studentIds.length) return [];

  const students = await Student.find({
    _id: { $in: studentIds },
    activeStatus: { $nin: ['INACTIVE', 'GRADUATED'] },
  }).select('_id').lean();

  const allowedIds = new Set(students.map((row) => String(row._id)));
  return cycles
    .filter((row) => allowedIds.has(String(row.studentId)))
    .map((row) => ({ _id: row.enrollmentId, studentId: row.studentId }));
}

async function buildJustificationContext(record, session) {
  const vacancy = await Vacancy.findOne({ studentId: record.studentId, cycleId: session.cycleId })
    .select('classroomId')
    .lean();

  return {
    campusId: session.campusId,
    cycleId: session.cycleId,
    classroomId: vacancy?.classroomId || null,
    sessionDate: session.date,
  };
}

function buildRecordSummaryPayload(updated) {
  return {
    id: String(updated._id),
    status: updated.status,
    justificationStatus: updated.justificationStatus,
    justificationReason: updated.justificationReason || null,
    justifiedAt: updated.justifiedAt || null,
    justifiedByUserId: updated.justifiedByUserId ? String(updated.justifiedByUserId) : null,
  };
}

export async function openAttendanceSessionService(input, user) {
  ensureAuxiliar(user);
  await ensureCampusInScope({ campusId: input.campusId, campusScope: user.campusScope || [] });

  const cycle = await Cycle.findById(input.cycleId).select('_id').lean();
  if (!cycle) {
    throw new ApiError(404, 'Ciclo no encontrado', 'ATTENDANCE_CYCLE_NOT_FOUND');
  }

  const normalizedDate = normalizeDateOnly(input.date);
  const existing = await AttendanceSession.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId: input.campusId,
    cycleId: input.cycleId,
    classroomId: null,
    programId: null,
    programSessionId: null,
    date: normalizedDate,
  }).lean();

  if (existing) {
    return {
      session: buildSessionPayload(existing),
      meta: { wasCreated: false, policyResolved: Boolean(existing.attendancePolicyId) },
    };
  }

  const schedule = await resolveEffectiveAttendanceSchedule({
    campusId: input.campusId,
    cycleId: input.cycleId,
    overrides: input,
  });

  const created = await AttendanceSession.create({
    scopeType: 'REGULAR_STUDENT',
    campusId: input.campusId,
    cycleId: input.cycleId,
    date: normalizedDate,
    expectedStartTime: schedule.expectedStartTime,
    onTimeUntil: schedule.onTimeUntil,
    lateUntil: schedule.lateUntil,
    status: 'OPEN',
    attendancePolicyId: schedule.attendancePolicyId,
    takenByUserId: user.id,
    openedAt: new Date(),
    notes: input.notes || null,
  });

  return {
    session: buildSessionPayload(created.toObject()),
    meta: { wasCreated: true, policyResolved: schedule.policyResolved },
  };
}

export async function getAttendanceIntakeViewService({ sessionId, limit = 10, q = '' }, user) {
  ensureAuxiliar(user);
  const session = await getAttendanceSessionOrThrow(sessionId);
  await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

  return {
    session: {
      id: String(session._id),
      status: session.status,
      date: formatDateOnly(session.date),
      expectedStartTime: session.expectedStartTime,
      onTimeUntil: session.onTimeUntil,
      lateUntil: session.lateUntil,
    },
    latestRecords: await buildLatestRecordsPayload({ session, limit, q }),
  };
}

export async function updateAttendanceSessionService({ sessionId, expectedStartTime, onTimeUntil, lateUntil, notes }, user) {
  ensureAuxiliar(user);
  const session = await getAttendanceSessionOrThrow(sessionId);
  await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

  if (session.status === 'CANCELLED') {
    throw new ApiError(409, 'SesiÃ³n cancelada', 'ATTENDANCE_SESSION_CANCELLED');
  }

  const nextExpectedStartTime = expectedStartTime || session.expectedStartTime;
  const nextOnTimeUntil = onTimeUntil || session.onTimeUntil;

  if (!nextExpectedStartTime || !nextOnTimeUntil) {
    throw new ApiError(400, 'Debe definir expectedStartTime y onTimeUntil', 'ATTENDANCE_SCHEDULE_REQUIRED');
  }

  const updated = await AttendanceSession.findByIdAndUpdate(
    session._id,
    {
      $set: {
        expectedStartTime: nextExpectedStartTime,
        onTimeUntil: nextOnTimeUntil,
        lateUntil: lateUntil === undefined ? session.lateUntil : lateUntil || null,
        notes: notes === undefined ? session.notes || null : notes || null,
      },
    },
    { new: true, lean: true }
  );

  return {
    session: buildSessionPayload(updated),
  };
}

export async function scanAttendanceByStudentCodeService({ sessionId, studentCode, arrivalTime, markMethod }, user) {
  ensureAuxiliar(user);
  const session = await getAttendanceSessionOrThrow(sessionId);
  if (session.status === 'CANCELLED') {
    throw new ApiError(409, 'Sesión cancelada', 'ATTENDANCE_SESSION_CANCELLED');
  }
  await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

  const student = await resolveStudentByCode(studentCode);
  const studentCycle = await resolveEnrollmentForSession({
    studentId: student._id,
    cycleId: session.cycleId,
    campusId: session.campusId,
  });
  const context = await resolveStudentContext({ studentId: student._id, cycleId: session.cycleId });
  const levelPolicy = await resolveAttendancePolicyForLevel({
    campusId: session.campusId,
    cycleId: session.cycleId,
    level: context.classroom?.level,
  });

  const effectiveArrivalTime = arrivalTime || new Date().toISOString().slice(11, 16);
  const onTimeUntil = levelPolicy?.defaultOnTimeUntil || session.onTimeUntil;
  const nextStatus = compareTimes(effectiveArrivalTime, onTimeUntil) <= 0 ? 'PRESENT' : 'LATE';
  const existing = await AttendanceRecord.findOne({ sessionId: session._id, studentId: student._id }).lean();

  if (existing && ['PRESENT', 'LATE'].includes(existing.status)) {
    throw new ApiError(
      409,
      'La asistencia de este alumno ya fue registrada',
      'ATTENDANCE_ALREADY_MARKED'
    );
  }

  const updated = await AttendanceRecord.findOneAndUpdate(
    { sessionId: session._id, studentId: student._id },
    {
      $set: {
        enrollmentId: studentCycle.enrollment._id,
        personId: student.personId || null,
        status: nextStatus,
        arrivalTime: effectiveArrivalTime,
        markMethod,
        markedByUserId: user.id,
        markedAt: new Date(),
      },
      $setOnInsert: {
        sessionId: session._id,
        studentId: student._id,
        justificationStatus: 'NONE',
      },
    },
    { upsert: true, new: true, lean: true }
  );

  await syncMonthlySummaryForRecordChange({
    before: existing ? {
      studentId: existing.studentId,
      status: existing.status,
      justificationStatus: existing.justificationStatus,
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: context.classroom?._id || null,
      sessionDate: session.date,
    } : null,
    after: {
      studentId: updated.studentId,
      status: updated.status,
      justificationStatus: updated.justificationStatus,
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: context.classroom?._id || null,
      sessionDate: session.date,
    },
    context: {
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: context.classroom?._id || null,
      sessionDate: session.date,
    },
  });

  return {
    record: {
      id: String(updated._id),
      studentId: String(updated.studentId),
      studentCode: student.internalCode,
      status: updated.status,
      arrivalTime: updated.arrivalTime,
      markMethod: updated.markMethod,
      markedAt: updated.markedAt,
      justificationStatus: updated.justificationStatus,
      justificationReason: updated.justificationReason || null,
    },
    student: {
      id: String(student._id),
      fullName: toFullName(context.person),
    },
    classroom: context.classroom ? {
      id: String(context.classroom._id),
      displayName: context.classroom.displayName,
    } : null,
    monthlySummary: await getMonthlySummaryForStudent({ studentId: student._id, sessionDate: session.date }),
    latestRecords: await buildLatestRecordsPayload({ session, limit: 10 }),
  };
}

export async function closeAttendanceSessionService({ sessionId, notes }, user) {
  ensureAuxiliar(user);
  const session = await getAttendanceSessionOrThrow(sessionId);
  if (session.status === 'CANCELLED') {
    throw new ApiError(409, 'Sesión cancelada', 'ATTENDANCE_SESSION_CANCELLED');
  }
  await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

  const [expectedStudents, existingRecords] = await Promise.all([
    resolveExpectedStudentsForSession(session),
    AttendanceRecord.find({ sessionId: session._id }).select('studentId').lean(),
  ]);
  const existingStudentIds = new Set(existingRecords.map((row) => String(row.studentId)));

  for (const cycleRow of expectedStudents.filter((row) => !existingStudentIds.has(String(row.studentId)))) {
    const vacancy = await Vacancy.findOne({ studentId: cycleRow.studentId, cycleId: session.cycleId })
      .select('classroomId')
      .lean();
    const created = await AttendanceRecord.create({
      sessionId: session._id,
      studentId: cycleRow.studentId,
      enrollmentId: cycleRow._id,
      status: 'ABSENT',
      arrivalTime: null,
      markMethod: 'BULK',
      markedByUserId: user.id,
      markedAt: new Date(),
      justificationStatus: 'NONE',
    });

    await syncMonthlySummaryForRecordChange({
      before: null,
      after: {
        studentId: created.studentId,
        status: created.status,
        justificationStatus: created.justificationStatus,
        campusId: session.campusId,
        cycleId: session.cycleId,
        classroomId: vacancy?.classroomId || null,
        sessionDate: session.date,
      },
      context: {
        campusId: session.campusId,
        cycleId: session.cycleId,
        classroomId: vacancy?.classroomId || null,
        sessionDate: session.date,
      },
    });
  }

  const updated = await AttendanceSession.findByIdAndUpdate(
    session._id,
    {
      $set: {
        status: 'CLOSED',
        closedAt: new Date(),
        notes: notes || session.notes || null,
      },
    },
    { new: true, lean: true }
  );

  return {
    session: {
      id: String(updated._id),
      status: updated.status,
      closedAt: updated.closedAt,
    },
  };
}

export async function justifyAttendanceRecordService({ recordId, justificationReason }, user) {
  ensureAuxiliar(user);
  const record = await AttendanceRecord.findById(recordId).lean();
  if (!record) {
    throw new ApiError(404, 'Registro de asistencia no encontrado', 'ATTENDANCE_RECORD_NOT_FOUND');
  }

  const session = await getAttendanceSessionOrThrow(record.sessionId);
  await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

  if (!['LATE', 'ABSENT'].includes(record.status)) {
    throw new ApiError(409, 'El registro no admite justificación', 'ATTENDANCE_JUSTIFICATION_NOT_ALLOWED');
  }

  const vacancy = await Vacancy.findOne({ studentId: record.studentId, cycleId: session.cycleId })
    .select('classroomId')
    .lean();
  const updated = await AttendanceRecord.findByIdAndUpdate(
    record._id,
    {
      $set: {
        justificationStatus: 'JUSTIFIED',
        justificationType: record.status,
        justificationReason,
        justifiedByUserId: user.id,
        justifiedAt: new Date(),
      },
    },
    { new: true, lean: true }
  );

  await syncMonthlySummaryForRecordChange({
    before: {
      studentId: record.studentId,
      status: record.status,
      justificationStatus: record.justificationStatus,
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: vacancy?.classroomId || null,
      sessionDate: session.date,
    },
    after: {
      studentId: updated.studentId,
      status: updated.status,
      justificationStatus: updated.justificationStatus,
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: vacancy?.classroomId || null,
      sessionDate: session.date,
    },
    context: {
      campusId: session.campusId,
      cycleId: session.cycleId,
      classroomId: vacancy?.classroomId || null,
      sessionDate: session.date,
    },
  });

  return {
    record: {
      id: String(updated._id),
      status: updated.status,
      justificationStatus: updated.justificationStatus,
      justificationReason: updated.justificationReason,
      justifiedAt: updated.justifiedAt,
      justifiedByUserId: String(updated.justifiedByUserId),
    },
  };
}

export async function justifyAttendanceRecordsBatchService({ recordIds, justificationReason }, user) {
  ensureAuxiliar(user);

  const records = await AttendanceRecord.find({ _id: { $in: recordIds } }).lean();
  if (records.length !== recordIds.length) {
    throw new ApiError(404, 'Uno o mÃ¡s registros no fueron encontrados', 'ATTENDANCE_RECORD_NOT_FOUND');
  }

  const sessions = await AttendanceSession.find({ _id: { $in: records.map((record) => record.sessionId) } })
    .select('_id campusId cycleId date')
    .lean();
  const sessionById = new Map(sessions.map((session) => [String(session._id), session]));
  const items = [];

  for (const record of records) {
    const session = sessionById.get(String(record.sessionId));
    if (!session) {
      throw new ApiError(404, 'SesiÃ³n de asistencia no encontrada', 'ATTENDANCE_SESSION_NOT_FOUND');
    }

    await ensureCampusInScope({ campusId: session.campusId, campusScope: user.campusScope || [] });

    if (!['LATE', 'ABSENT'].includes(record.status)) {
      throw new ApiError(409, 'Uno o mÃ¡s registros no admiten justificaciÃ³n', 'ATTENDANCE_JUSTIFICATION_NOT_ALLOWED');
    }

    const context = await buildJustificationContext(record, session);
    const updated = await AttendanceRecord.findByIdAndUpdate(
      record._id,
      {
        $set: {
          justificationStatus: 'JUSTIFIED',
          justificationType: record.status,
          justificationReason,
          justifiedByUserId: user.id,
          justifiedAt: new Date(),
        },
      },
      { new: true, lean: true }
    );

    await syncMonthlySummaryForRecordChange({
      before: {
        studentId: record.studentId,
        status: record.status,
        justificationStatus: record.justificationStatus,
        ...context,
      },
      after: {
        studentId: updated.studentId,
        status: updated.status,
        justificationStatus: updated.justificationStatus,
        ...context,
      },
      context,
    });

    items.push(buildRecordSummaryPayload(updated));
  }

  return {
    items,
    meta: { total: items.length },
  };
}

export async function getAttendanceClassroomOptionsService(user) {
  ensureAuxiliar(user);

  const scopedCampuses = await resolveCampusScopeIds(user.campusScope || []);
  const campusIds = scopedCampuses.map((row) => row.id);
  const classrooms = campusIds.length
    ? await Classroom.find({ campusId: { $in: campusIds }, isActive: true })
      .select('_id campusId cycleId displayName level grade section')
      .sort({ level: 1, grade: 1, section: 1, displayName: 1 })
      .lean()
    : [];

  return {
    items: classrooms.map((classroom) => {
      const campus = scopedCampuses.find((row) => row.id === String(classroom.campusId));
      return {
        id: String(classroom._id),
        displayName: classroom.displayName,
        level: classroom.level,
        grade: classroom.grade,
        section: classroom.section,
        campus: campus || { id: String(classroom.campusId), code: null, name: null },
        cycleId: String(classroom.cycleId),
      };
    }),
  };
}

export async function getRecentAttendanceJustificationsService({ limit = 20 }, user) {
  ensureAuxiliar(user);

  const scopedCampuses = await resolveCampusScopeIds(user.campusScope || []);
  const campusById = new Map(scopedCampuses.map((row) => [row.id, row]));
  const sessions = await AttendanceSession.find({ campusId: { $in: scopedCampuses.map((row) => row.id) } })
    .select('_id campusId cycleId date')
    .lean();
  const sessionById = new Map(sessions.map((session) => [String(session._id), session]));

  const records = await AttendanceRecord.find({
    sessionId: { $in: sessions.map((session) => session._id) },
    justificationStatus: 'JUSTIFIED',
  })
    .sort({ justifiedAt: -1, _id: -1 })
    .limit(limit)
    .select('_id sessionId studentId status justificationReason justifiedAt')
    .lean();

  const studentIds = records.map((record) => record.studentId).filter(Boolean);
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } }).select('_id internalCode personId').lean()
    : [];
  const people = students.length
    ? await Person.find({ _id: { $in: students.map((row) => row.personId).filter(Boolean) } }).select('_id names lastNames').lean()
    : [];

  const studentById = new Map(students.map((row) => [String(row._id), row]));
  const personById = new Map(people.map((row) => [String(row._id), row]));

  return {
    items: records.map((record) => {
      const session = sessionById.get(String(record.sessionId));
      const student = studentById.get(String(record.studentId));
      const person = personById.get(String(student?.personId || ''));
      const campus = campusById.get(String(session?.campusId || ''));
      return {
        recordId: String(record._id),
        date: session?.date ? formatDateOnly(session.date) : null,
        status: record.status,
        justificationReason: record.justificationReason || null,
        justifiedAt: record.justifiedAt || null,
        student: {
          id: student ? String(student._id) : null,
          internalCode: student?.internalCode || null,
          fullName: toFullName(person),
        },
        campus: campus || null,
      };
    }),
    meta: { total: records.length },
  };
}

export async function getClassroomMonthlySummaryService({ classroomId, campusId, cycleId, year, month }, user) {
  ensureAuxiliar(user);
  const classroom = await Classroom.findById(classroomId).select('_id displayName campusId cycleId').lean();
  if (!classroom) {
    throw new ApiError(404, 'Aula no encontrada', 'ATTENDANCE_CLASSROOM_NOT_FOUND');
  }

  const effectiveCampusId = campusId || classroom.campusId;
  await ensureCampusInScope({ campusId: effectiveCampusId, campusScope: user.campusScope || [] });

  if (cycleId && String(cycleId) !== String(classroom.cycleId)) {
    throw new ApiError(409, 'El aula no pertenece al ciclo indicado', 'ATTENDANCE_INVALID_CONTEXT');
  }

  const rows = await AttendanceMonthlySummary.find({
    classroomId,
    campusId: effectiveCampusId,
    cycleId: cycleId || classroom.cycleId,
    year,
    month,
  }).lean();

  const studentIds = rows.map((row) => row.studentId);
  const students = studentIds.length
    ? await Student.find({ _id: { $in: studentIds } }).select('_id personId').lean()
    : [];
  const people = students.length
    ? await Person.find({ _id: { $in: students.map((row) => row.personId).filter(Boolean) } }).select('_id names lastNames').lean()
    : [];

  const studentById = new Map(students.map((row) => [String(row._id), row]));
  const personById = new Map(people.map((row) => [String(row._id), row]));

  return {
    classroom: {
      id: String(classroom._id),
      displayName: classroom.displayName,
    },
    period: { year, month },
    items: rows.map((row) => {
      const student = studentById.get(String(row.studentId));
      const person = personById.get(String(student?.personId || ''));
      return {
        studentId: String(row.studentId),
        person: { fullName: toFullName(person) },
        summary: {
          lateCount: row.lateCount || 0,
          absentCount: row.absentCount || 0,
          justifiedLateCount: row.justifiedLateCount || 0,
          justifiedAbsentCount: row.justifiedAbsentCount || 0,
        },
      };
    }),
    meta: { total: rows.length },
  };
}

export async function getClassroomDailyReportService({ classroomId, date }, user) {
  ensureAuxiliar(user);

  const classroom = await Classroom.findById(classroomId).select('_id displayName campusId cycleId level grade section').lean();
  if (!classroom) {
    throw new ApiError(404, 'Aula no encontrada', 'ATTENDANCE_CLASSROOM_NOT_FOUND');
  }

  await ensureCampusInScope({ campusId: classroom.campusId, campusScope: user.campusScope || [] });

  const normalizedDate = normalizeDateOnly(date);
  const session = await AttendanceSession.findOne({
    scopeType: 'REGULAR_STUDENT',
    campusId: classroom.campusId,
    cycleId: classroom.cycleId,
    classroomId: null,
    programId: null,
    programSessionId: null,
    date: normalizedDate,
  })
    .select('_id status date')
    .lean();

  const vacancies = await Vacancy.find({ classroomId: classroom._id, cycleId: classroom.cycleId }).select('studentId classroomId').lean();
  const studentIds = vacancies.map((row) => row.studentId).filter(Boolean);
  const [students, records] = await Promise.all([
    studentIds.length
      ? Student.find({ _id: { $in: studentIds } }).select('_id internalCode personId activeStatus').lean()
      : [],
    session && studentIds.length
      ? AttendanceRecord.find({ sessionId: session._id, studentId: { $in: studentIds } })
        .select('_id studentId status arrivalTime markedAt justificationStatus justificationReason')
        .lean()
      : [],
  ]);

  const people = students.length
    ? await Person.find({ _id: { $in: students.map((row) => row.personId).filter(Boolean) } }).select('_id names lastNames').lean()
    : [];

  const personById = new Map(people.map((row) => [String(row._id), row]));
  const studentById = new Map(students.map((row) => [String(row._id), row]));
  const recordByStudentId = new Map(records.map((row) => [String(row.studentId), row]));

  const items = studentIds.map((studentId) => {
    const student = studentById.get(String(studentId));
    const person = personById.get(String(student?.personId || ''));
    const record = recordByStudentId.get(String(studentId));
    return {
      studentId: String(studentId),
      studentCode: student?.internalCode || null,
      person: { fullName: toFullName(person) },
      attendance: record
        ? {
          recordId: String(record._id),
          status: record.status,
          arrivalTime: record.arrivalTime,
          markedAt: record.markedAt,
          justificationStatus: record.justificationStatus || 'NONE',
          justificationReason: record.justificationReason || null,
        }
        : {
          recordId: null,
          status: session ? 'UNMARKED' : 'NO_SESSION',
          arrivalTime: null,
          markedAt: null,
          justificationStatus: 'NONE',
          justificationReason: null,
        },
    };
  });

  return {
    classroom: {
      id: String(classroom._id),
      displayName: classroom.displayName,
      level: classroom.level,
      grade: classroom.grade,
      section: classroom.section,
    },
    date,
    session: session ? { id: String(session._id), status: session.status } : null,
    items,
    meta: { total: items.length },
  };
}

export async function getStudentMonthlySummaryService({ studentId, year, month }, user) {
  ensureAuxiliar(user);
  const student = await Student.findById(studentId).select('_id personId').lean();
  if (!student) {
    throw new ApiError(404, 'Alumno no encontrado', 'ATTENDANCE_STUDENT_NOT_FOUND');
  }

  const studentCycle = await getEnrollmentContextForStudent(studentId);
  if (studentCycle?.campus?._id || studentCycle?.enrollment?.campusId) {
    await ensureCampusInScope({ campusId: studentCycle.campus?._id || studentCycle.enrollment.campusId, campusScope: user.campusScope || [] });
  }

  const rows = await AttendanceMonthlySummary.find({ studentId, year, month }).lean();
  const person = student.personId
    ? await Person.findById(student.personId).select('_id names lastNames').lean()
    : null;
  const { start, end } = getMonthDateRange(year, month);
  const sessions = await AttendanceSession.find({
    scopeType: 'REGULAR_STUDENT',
    date: { $gte: start, $lt: end },
  })
    .select('_id date cycleId')
    .sort({ date: 1 })
    .lean();
  const sessionIds = sessions.map((session) => session._id);
  const records = sessionIds.length
    ? await AttendanceRecord.find({ studentId, sessionId: { $in: sessionIds } })
      .select('_id sessionId status arrivalTime markedAt justificationStatus justificationReason justifiedAt')
      .sort({ markedAt: 1, _id: 1 })
      .lean()
    : [];
  const sessionById = new Map(sessions.map((session) => [String(session._id), session]));

  return {
    student: {
      id: String(student._id),
      fullName: toFullName(person),
    },
    period: { year, month },
    summary: rows.reduce((acc, row) => ({
      presentCount: acc.presentCount + (row.presentCount || 0),
      lateCount: acc.lateCount + (row.lateCount || 0),
      absentCount: acc.absentCount + (row.absentCount || 0),
      justifiedLateCount: acc.justifiedLateCount + (row.justifiedLateCount || 0),
      justifiedAbsentCount: acc.justifiedAbsentCount + (row.justifiedAbsentCount || 0),
    }), {
      presentCount: 0,
      lateCount: 0,
      absentCount: 0,
      justifiedLateCount: 0,
      justifiedAbsentCount: 0,
    }),
    records: records.map((record) => ({
      recordId: String(record._id),
      sessionId: String(record.sessionId),
      date: formatDateOnly(sessionById.get(String(record.sessionId))?.date || start),
      status: record.status,
      arrivalTime: record.arrivalTime,
      markedAt: record.markedAt,
      justificationStatus: record.justificationStatus || 'NONE',
      justificationReason: record.justificationReason || null,
      justifiedAt: record.justifiedAt || null,
    })),
  };
}
