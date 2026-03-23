import mongoose from 'mongoose';
import { Campus } from '../../models/campus.model.js';
import { Cycle } from '../../models/cycle.model.js';
import { Student } from '../../models/student.model.js';
import { Tutor } from '../../models/tutor.model.js';
import { Charge } from '../../models/charge.model.js';
import { Enrollment } from '../../models/enrollment.model.js';
import { EnrollmentStudent } from '../../models/enrollmentStudent.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { ApiError } from '../../utils/errors.js';
import { getEnrollmentContextMapByStudentIds } from '../../shared/enrollmentCurrent.js';

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildFullName(person = {}) {
  return [person.lastNames, person.names].filter(Boolean).join(', ').trim() || 'Alumno';
}

function getMissingStudentFields(student = {}) {
  const missing = [];
  const person = student.personId || {};

  if (!person.dni) missing.push('DNI');
  if (!person.phone) missing.push('Telefono');
  if (!person.address) missing.push('Direccion');

  return missing;
}

function getTuitionMonthLabel(monthIndex) {
  const labels = ['Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex < labels.length ? labels[monthIndex] : null;
}

function buildChargeLabel(charge = {}) {
  if (charge.concept === 'TUITION') {
    const monthLabel = getTuitionMonthLabel(charge.monthIndex);
    if (monthLabel) return `Pension - ${monthLabel}`;
    return 'Pension';
  }
  if (charge.concept === 'ADMISSION') return 'Derecho de ingreso';
  if (charge.concept === 'ENROLLMENT') return 'Matricula';
  return charge.description || charge.concept || 'Cargo';
}

async function resolveScopedCampusFilter({ campus, campusScope = [] }) {
  const scopeAll = campusScope.includes('ALL');
  const requestedCampus = campus ? String(campus).trim().toUpperCase() : '';

  if (!scopeAll && requestedCampus && !campusScope.includes(requestedCampus)) {
    throw new ApiError(403, 'No autorizado para consultar este campus');
  }

  const allowedCodes = requestedCampus
    ? [requestedCampus]
    : (scopeAll ? [] : campusScope.filter(Boolean));

  if (!allowedCodes.length) {
    return { campusIds: [], campusCodeById: new Map() };
  }

  const campuses = await Campus.find({ code: { $in: allowedCodes } }).select('_id code').lean();
  return {
    campusIds: campuses.map((row) => row._id),
    campusCodeById: new Map(campuses.map((row) => [String(row._id), row.code])),
  };
}

async function resolveCurrentCycle() {
  const now = new Date();
  const activeCycle = await Cycle.findOne({
    type: 'SCHOOL_YEAR',
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  })
    .sort({ startDate: -1 })
    .lean();

  if (activeCycle) return activeCycle;

  return Cycle.findOne({ type: 'SCHOOL_YEAR', isActive: true })
    .sort({ startDate: -1 })
    .lean();
}

async function getScopedEnrollments({ cycleId, campusIds }) {
  const match = { cycleId };
  if (campusIds.length) match.campusId = { $in: campusIds };

  return Enrollment.find(match)
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}

async function ensureCampusCodeMap({ campusCodeById, enrollments = [] }) {
  if (campusCodeById.size > 0 || !enrollments.length) return campusCodeById;

  const missingCampusIds = Array.from(
    new Set(
      enrollments
        .map((row) => String(row.campusId || ''))
        .filter(Boolean),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));

  if (!missingCampusIds.length) return campusCodeById;

  const campuses = await Campus.find({ _id: { $in: missingCampusIds } }).select('_id code').lean();
  const next = new Map(campusCodeById);
  for (const campus of campuses) {
    next.set(String(campus._id), campus.code);
  }
  return next;
}

async function getStudentMap(studentIds) {
  if (!studentIds.length) return new Map();

  const students = await Student.find({ _id: { $in: studentIds } })
    .populate('personId')
    .lean();

  return new Map(students.map((row) => [String(row._id), row]));
}

async function getRecentEnrollmentActivity({ cycleId, campusIds, limit = 4 }) {
  const match = { cycleId };
  if (campusIds.length) match.campusId = { $in: campusIds };

  const enrollments = await Enrollment.find(match)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  if (!enrollments.length) return [];

  const enrollmentStudentRows = await EnrollmentStudent.find({
    enrollmentId: { $in: enrollments.map((row) => row._id) },
  })
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .lean();

  const firstStudentByEnrollmentId = new Map();
  const countByEnrollmentId = new Map();
  for (const row of enrollmentStudentRows) {
    const key = String(row.enrollmentId);
    if (!firstStudentByEnrollmentId.has(key) && row.studentId?.personId) {
      firstStudentByEnrollmentId.set(key, row.studentId);
    }
    countByEnrollmentId.set(key, (countByEnrollmentId.get(key) || 0) + 1);
  }

  return enrollments.map((row) => {
    const firstStudent = firstStudentByEnrollmentId.get(String(row._id));
    const studentLabel = firstStudent?.personId ? buildFullName(firstStudent.personId) : 'Matricula reciente';
    const studentCount = countByEnrollmentId.get(String(row._id)) || 0;

    return {
      id: `enrollment-${row._id}`,
      type: 'ENROLLMENT',
      title: studentLabel,
      subtitle: studentCount > 1 ? `${studentCount} alumnos en la matricula` : 'Matricula registrada',
      at: row.createdAt,
      to: `/dashboard/enrollments`,
    };
  });
}

async function getRecentPaymentActivity({ campusIds, limit = 4 }) {
  const match = {};
  if (campusIds.length) match.campusId = { $in: campusIds };

  const payments = await Payment.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  if (!payments.length) return [];

  const allocations = await PaymentAllocation.find({
    paymentId: { $in: payments.map((row) => row._id) },
  })
    .populate({
      path: 'chargeId',
      populate: { path: 'studentId', populate: { path: 'personId' } },
    })
    .lean();

  const firstStudentByPaymentId = new Map();
  for (const allocation of allocations) {
    const paymentId = String(allocation.paymentId);
    const student = allocation.chargeId?.studentId;
    if (!firstStudentByPaymentId.has(paymentId) && student?.personId) {
      firstStudentByPaymentId.set(paymentId, student);
    }
  }

  return payments.map((row) => {
    const student = firstStudentByPaymentId.get(String(row._id));
    return {
      id: `payment-${row._id}`,
      type: 'PAYMENT',
      title: student?.personId ? buildFullName(student.personId) : `Pago ${row.internalCode}`,
      subtitle: `${row.internalCode} - S/ ${roundMoney(toMoney(row.totalAmount)).toFixed(2)}`,
      at: row.paidAt,
      to: student?._id ? `/dashboard/payments/${student._id}` : '/dashboard/payments',
    };
  });
}

export async function getSecretaryOverviewService({ campus, campusScope = [] }) {
  const { campusIds, campusCodeById } = await resolveScopedCampusFilter({ campus, campusScope });
  const currentCycle = await resolveCurrentCycle();

  if (!currentCycle?._id) {
    return {
      summary: {
        activeStudents: 0,
        recentEnrollments: 0,
        paymentsToday: 0,
        openIssues: 0,
      },
      critical: {
        studentsWithoutTutorsCount: 0,
        incompleteStudentsCount: 0,
        overdueStudentsCount: 0,
        draftEnrollmentsCount: 0,
      },
      studentsWithoutTutors: [],
      incompleteStudents: [],
      topDebtors: [],
      upcomingDue: [],
      recentActivity: [],
    };
  }

  const enrollments = await getScopedEnrollments({ cycleId: currentCycle._id, campusIds });
  const scopedCampusCodeById = await ensureCampusCodeMap({ campusCodeById, enrollments });
  const enrollmentStudents = enrollments.length
    ? await EnrollmentStudent.find({ enrollmentId: { $in: enrollments.map((row) => row._id) } }).select('enrollmentId studentId').lean()
    : [];
  const enrollmentById = new Map(enrollments.map((row) => [String(row._id), row]));
  const latestCycleByStudentId = new Map();
  for (const row of enrollmentStudents) {
    const enrollment = enrollmentById.get(String(row.enrollmentId));
    if (!enrollment) continue;
    const key = String(row.studentId);
    if (!latestCycleByStudentId.has(key)) {
      latestCycleByStudentId.set(key, {
        studentId: row.studentId,
        status: enrollment.status,
        campusId: enrollment.campusId,
      });
    }
  }

  const scopedStudentIds = Array.from(latestCycleByStudentId.keys()).map((id) => new mongoose.Types.ObjectId(id));
  const studentMap = await getStudentMap(scopedStudentIds);
  const tutorRows = scopedStudentIds.length
    ? await Tutor.find({ studentId: { $in: scopedStudentIds } }).select('studentId').lean()
    : [];
  const studentIdsWithTutors = new Set(tutorRows.map((row) => String(row.studentId)));

  const activeStudents = Array.from(latestCycleByStudentId.values()).filter((row) => row.status === 'ENROLLED').length;

  const studentsWithoutTutors = Array.from(studentMap.values())
    .filter((student) => !studentIdsWithTutors.has(String(student._id)))
    .map((student) => {
      const cycleRow = latestCycleByStudentId.get(String(student._id));
      return {
        studentId: String(student._id),
        fullName: buildFullName(student.personId),
        dni: student.personId?.dni || null,
        code: student.internalCode || null,
        campus: scopedCampusCodeById.get(String(cycleRow?.campusId)) || null,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))
    .slice(0, 5);

  const incompleteStudentsAll = Array.from(studentMap.values())
    .map((student) => {
      const missingFields = getMissingStudentFields(student);
      if (!missingFields.length) return null;
      const cycleRow = latestCycleByStudentId.get(String(student._id));
      return {
        studentId: String(student._id),
        fullName: buildFullName(student.personId),
        dni: student.personId?.dni || null,
        code: student.internalCode || null,
        campus: scopedCampusCodeById.get(String(cycleRow?.campusId)) || null,
        missingFields,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.missingFields.length - a.missingFields.length || a.fullName.localeCompare(b.fullName, 'es'));

  const overdueMatch = {
    cycleId: currentCycle._id,
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
    status: { $ne: 'CANCELLED' },
    dueDate: { $lt: new Date() },
  };
  if (campusIds.length) overdueMatch.campusId = { $in: campusIds };

  const groupedOverdue = await Charge.aggregate([
    { $match: overdueMatch },
    {
      $group: {
        _id: '$studentId',
        totalPending: { $sum: { $toDouble: '$outstandingAmount' } },
        totalOverdue: { $sum: { $toDouble: '$outstandingAmount' } },
      },
    },
    { $sort: { totalOverdue: -1, totalPending: -1 } },
    { $limit: 5 },
  ]);

  const topDebtors = groupedOverdue
    .map((row) => {
      const student = studentMap.get(String(row._id));
      const cycleRow = latestCycleByStudentId.get(String(row._id));
      if (!student?.personId) return null;
      return {
        studentId: String(row._id),
        fullName: buildFullName(student.personId),
        code: student.internalCode || null,
        campus: scopedCampusCodeById.get(String(cycleRow?.campusId)) || null,
        totalPending: roundMoney(row.totalPending),
        totalOverdue: roundMoney(row.totalOverdue),
      };
    })
    .filter(Boolean);

  const upcomingMatch = {
    cycleId: currentCycle._id,
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
    status: { $ne: 'CANCELLED' },
    dueDate: {
      $gte: new Date(),
      $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  };
  if (campusIds.length) upcomingMatch.campusId = { $in: campusIds };

  const upcomingCharges = await Charge.find(upcomingMatch)
    .sort({ dueDate: 1, outstandingAmount: -1 })
    .limit(5)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate('campusId', 'code')
    .lean();

  const upcomingDue = upcomingCharges.map((charge) => ({
    chargeId: String(charge._id),
    studentId: String(charge.studentId?._id || ''),
    fullName: buildFullName(charge.studentId?.personId),
    code: charge.studentId?.internalCode || null,
    campus: charge.campusId?.code || null,
    concept: buildChargeLabel(charge),
    dueDate: charge.dueDate,
    pendingAmount: roundMoney(toMoney(charge.outstandingAmount)),
  }));

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const enrollmentsLast7DaysMatch = { cycleId: currentCycle._id, createdAt: { $gte: weekAgo } };
  if (campusIds.length) enrollmentsLast7DaysMatch.campusId = { $in: campusIds };
  const recentEnrollments = await Enrollment.countDocuments(enrollmentsLast7DaysMatch);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const paymentsTodayMatch = { paidAt: { $gte: todayStart } };
  if (campusIds.length) paymentsTodayMatch.campusId = { $in: campusIds };
  const paymentsToday = await Payment.countDocuments(paymentsTodayMatch);

  const absentEnrollmentsMatch = { cycleId: currentCycle._id, status: 'ABSENT' };
  if (campusIds.length) absentEnrollmentsMatch.campusId = { $in: campusIds };
  const draftEnrollmentsCount = await Enrollment.countDocuments(absentEnrollmentsMatch);

  const recentActivity = [
    ...(await getRecentEnrollmentActivity({ cycleId: currentCycle._id, campusIds, limit: 4 })),
    ...(await getRecentPaymentActivity({ campusIds, limit: 4 })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 6);

  const overdueStudentsCount = groupedOverdue.length;
  const studentsWithoutTutorsCount = Array.from(studentMap.values()).filter((student) => !studentIdsWithTutors.has(String(student._id))).length;
  const incompleteStudentsCount = incompleteStudentsAll.length;

  return {
    summary: {
      activeStudents,
      recentEnrollments,
      paymentsToday,
      openIssues: studentsWithoutTutorsCount + incompleteStudentsCount + overdueStudentsCount + draftEnrollmentsCount,
    },
    critical: {
      studentsWithoutTutorsCount,
      incompleteStudentsCount,
      overdueStudentsCount,
      draftEnrollmentsCount,
    },
    studentsWithoutTutors,
    incompleteStudents: incompleteStudentsAll.slice(0, 5),
    topDebtors,
    upcomingDue,
    recentActivity,
  };
}
