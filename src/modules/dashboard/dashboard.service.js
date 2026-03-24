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
import { resolveOperationalDay } from '../../shared/operationalDay.js';

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

function buildCategoryMeta(category) {
  const normalized = String(category || '').toUpperCase();
  if (normalized === 'TUITION') return { code: 'TUITION', label: 'Pension', order: 1 };
  if (normalized === 'ENROLLMENT') return { code: 'ENROLLMENT', label: 'Matricula', order: 2 };
  if (normalized === 'ADMISSION') return { code: 'ADMISSION', label: 'Derecho de ingreso', order: 3 };
  return { code: 'OTHER', label: 'Otros', order: 4 };
}

function buildCategoryMetaFromCharge(charge = {}) {
  const conceptId = charge.conceptId || {};
  const conceptCode = String(conceptId.code || '').trim().toUpperCase();
  const conceptName = String(conceptId.name || '').trim();

  if (conceptCode === 'TUITION' || conceptCode === 'TUITION_FEE') {
    return { code: 'TUITION', label: conceptName || 'Pension', order: 1 };
  }
  if (conceptCode === 'ENROLLMENT_FEE' || conceptCode === 'ENROLLMENT') {
    return { code: 'ENROLLMENT_FEE', label: conceptName || 'Matricula', order: 2 };
  }
  if (conceptCode === 'ADMISSION_FEE' || conceptCode === 'ADMISSION') {
    return { code: 'ADMISSION_FEE', label: conceptName || 'Derecho de ingreso', order: 3 };
  }
  if (conceptCode) {
    return { code: conceptCode, label: conceptName || conceptCode, order: 10 };
  }

  const fallbackConcept = String(charge.concept || '').trim().toUpperCase();
  if (fallbackConcept) return buildCategoryMeta(fallbackConcept);

  const fallbackLabel = String(charge.description || conceptName || '').trim();
  if (fallbackLabel) return { code: `DESC:${fallbackLabel.toUpperCase()}`, label: fallbackLabel, order: 20 };

  return { code: 'OTHER', label: 'Otros', order: 99 };
}

function getMethodLabel(method) {
  const normalized = String(method || '').toUpperCase();
  if (normalized === 'CASH') return 'Efectivo';
  if (normalized === 'YAPE') return 'Yape';
  if (normalized === 'TRANSFER') return 'Transferencia';
  return method || 'Sin metodo';
}

function buildGradeLabel(classroom = {}) {
  const grade = String(classroom?.grade || '').trim();
  const section = String(classroom?.section || '').trim();
  if (!grade && !section) return null;
  return [grade, section].filter(Boolean).join(' ');
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

async function getCashTodaySummary({ campusIds = [] }) {
  const operationalDay = resolveOperationalDay();

  const paymentMatch = {
    paidAt: {
      $gte: operationalDay.startUtc,
      $lt: operationalDay.endUtc,
    },
  };
  if (campusIds.length) paymentMatch.campusId = { $in: campusIds };

  const payments = await Payment.find(paymentMatch)
    .sort({ paidAt: -1, _id: -1 })
    .populate('studentId')
    .populate('campusId', 'code name')
    .lean();

  if (!payments.length) {
    return {
      date: operationalDay.date,
      totalIncome: 0,
      paymentsCount: 0,
      averageTicket: 0,
      categoriesCount: 0,
      totalsByMethod: [
        { method: 'CASH', label: getMethodLabel('CASH'), totalAmount: 0, paymentsCount: 0, share: 0 },
        { method: 'YAPE', label: getMethodLabel('YAPE'), totalAmount: 0, paymentsCount: 0, share: 0 },
        { method: 'TRANSFER', label: getMethodLabel('TRANSFER'), totalAmount: 0, paymentsCount: 0, share: 0 },
      ],
      byCategory: [],
      recentPayments: [],
    };
  }

  const paymentIds = payments.map((row) => row._id);
  const allocations = await PaymentAllocation.find({ paymentId: { $in: paymentIds } })
    .populate({
      path: 'chargeId',
      populate: [
        { path: 'studentId', populate: { path: 'personId' } },
        { path: 'campusId', select: 'code name' },
        { path: 'conceptId', select: 'code name' },
      ],
    })
    .lean();

  const allocationsByPaymentId = new Map();
  const studentIdsFromAllocations = new Set();
  for (const allocation of allocations) {
    const paymentId = String(allocation.paymentId || '');
    if (!allocationsByPaymentId.has(paymentId)) allocationsByPaymentId.set(paymentId, []);
    allocationsByPaymentId.get(paymentId).push(allocation);

    const studentId = allocation.chargeId?.studentId?._id || allocation.chargeId?.studentId;
    if (studentId) studentIdsFromAllocations.add(String(studentId));
  }

  const enrollmentContexts = await getEnrollmentContextMapByStudentIds(Array.from(studentIdsFromAllocations));
  const categoryMap = new Map();
  const recentPayments = [];
  const totalsByMethod = {
    CASH: { method: 'CASH', label: getMethodLabel('CASH'), totalAmount: 0, paymentsCount: 0 },
    YAPE: { method: 'YAPE', label: getMethodLabel('YAPE'), totalAmount: 0, paymentsCount: 0 },
    TRANSFER: { method: 'TRANSFER', label: getMethodLabel('TRANSFER'), totalAmount: 0, paymentsCount: 0 },
  };

  for (const payment of payments) {
    const paymentId = String(payment._id);
    const paymentAllocations = allocationsByPaymentId.get(paymentId) || [];
    const paymentAmount = roundMoney(toMoney(payment.totalAmount));
    const paymentMethodKey = String(payment.method || '').toUpperCase();
    if (!totalsByMethod[paymentMethodKey]) {
      totalsByMethod[paymentMethodKey] = {
        method: paymentMethodKey || 'UNKNOWN',
        label: getMethodLabel(payment.method),
        totalAmount: 0,
        paymentsCount: 0,
      };
    }
    totalsByMethod[paymentMethodKey].totalAmount = roundMoney(totalsByMethod[paymentMethodKey].totalAmount + paymentAmount);
    totalsByMethod[paymentMethodKey].paymentsCount += 1;

    const paymentCategories = new Set();
    let firstStudentName = null;
    let firstGradeLabel = null;
    let firstCampusCode = payment.campusId?.code || null;

    for (const allocation of paymentAllocations) {
      const charge = allocation.chargeId || {};
      const student = charge.studentId || {};
      const studentId = String(student?._id || charge?.studentId || '');
      const context = studentId ? enrollmentContexts.get(studentId) : null;
      const categoryMeta = buildCategoryMetaFromCharge(charge);
      const detailAmount = roundMoney(toMoney(allocation.amount));
      const detailCampusCode = charge.campusId?.code || context?.campus?.code || payment.campusId?.code || null;
      const detailCampusName = charge.campusId?.name || context?.campus?.name || payment.campusId?.name || null;
      const detailGradeLabel = buildGradeLabel(context?.classroom);
      const detailStudentName = student?.personId ? buildFullName(student.personId) : 'Alumno';

      if (!firstStudentName) firstStudentName = detailStudentName;
      if (!firstGradeLabel) firstGradeLabel = detailGradeLabel;
      if (!firstCampusCode) firstCampusCode = detailCampusCode;

      paymentCategories.add(categoryMeta.code);

      if (!categoryMap.has(categoryMeta.code)) {
        categoryMap.set(categoryMeta.code, {
          category: categoryMeta.code,
          label: categoryMeta.label,
          order: categoryMeta.order,
          totalAmount: 0,
          paymentsCount: 0,
          details: [],
          paymentIds: new Set(),
        });
      }

      const categoryRow = categoryMap.get(categoryMeta.code);
      categoryRow.totalAmount = roundMoney(categoryRow.totalAmount + detailAmount);
      categoryRow.details.push({
        paymentId,
        paymentInternalCode: payment.internalCode || null,
        paidAt: payment.paidAt,
        studentId: studentId || null,
        studentName: detailStudentName,
        gradeLabel: detailGradeLabel,
        campusCode: detailCampusCode,
        campusName: detailCampusName,
        amount: detailAmount,
        method: payment.method,
        methodLabel: getMethodLabel(payment.method),
        concept: charge.concept || null,
        conceptLabel: buildChargeLabel(charge),
      });
      categoryRow.paymentIds.add(paymentId);
    }

    if (!paymentAllocations.length) {
      const uncategorizedMeta = buildCategoryMeta('OTHER');
      if (!categoryMap.has(uncategorizedMeta.code)) {
        categoryMap.set(uncategorizedMeta.code, {
          category: uncategorizedMeta.code,
          label: uncategorizedMeta.label,
          order: uncategorizedMeta.order,
          totalAmount: 0,
          paymentsCount: 0,
          details: [],
          paymentIds: new Set(),
        });
      }
      const categoryRow = categoryMap.get(uncategorizedMeta.code);
      categoryRow.totalAmount = roundMoney(categoryRow.totalAmount + paymentAmount);
      categoryRow.details.push({
        paymentId,
        paymentInternalCode: payment.internalCode || null,
        paidAt: payment.paidAt,
        studentId: payment.studentId?._id ? String(payment.studentId._id) : null,
        studentName: firstStudentName || 'Alumno',
        gradeLabel: firstGradeLabel,
        campusCode: firstCampusCode,
        campusName: payment.campusId?.name || null,
        amount: paymentAmount,
        method: payment.method,
        methodLabel: getMethodLabel(payment.method),
        concept: null,
        conceptLabel: 'Pago sin categoria',
      });
      categoryRow.paymentIds.add(paymentId);
      paymentCategories.add(uncategorizedMeta.code);
    }

    recentPayments.push({
      paymentId,
      internalCode: payment.internalCode || null,
      paidAt: payment.paidAt,
      studentName: firstStudentName || 'Pago registrado',
      gradeLabel: firstGradeLabel,
      campusCode: firstCampusCode,
      amount: paymentAmount,
      method: payment.method,
      methodLabel: getMethodLabel(payment.method),
      categoryLabel: paymentCategories.size === 1
        ? buildCategoryMeta(Array.from(paymentCategories)[0]).label
        : 'Mixto',
      to: payment.studentId?._id ? `/dashboard/payments/${payment.studentId._id}` : '/dashboard/payments',
    });
  }

  const byCategory = Array.from(categoryMap.values())
    .map((row) => ({
      category: row.category,
      label: row.label,
      totalAmount: roundMoney(row.totalAmount),
      paymentsCount: row.paymentIds.size,
      details: row.details.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)),
      detailsCount: row.details.length,
      share: 0,
      order: row.order,
    }))
    .sort((a, b) => a.order - b.order || b.totalAmount - a.totalAmount);

  const totalIncome = roundMoney(payments.reduce((acc, row) => acc + roundMoney(toMoney(row.totalAmount)), 0));
  const paymentsCount = payments.length;
  const totalsByMethodList = Object.values(totalsByMethod)
    .map((row) => ({
      method: row.method,
      label: row.label,
      totalAmount: roundMoney(row.totalAmount),
      paymentsCount: row.paymentsCount,
      share: totalIncome > 0 ? roundMoney((row.totalAmount / totalIncome) * 100) : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  for (const category of byCategory) {
    category.share = totalIncome > 0 ? roundMoney((category.totalAmount / totalIncome) * 100) : 0;
    delete category.order;
  }

  return {
    date: operationalDay.date,
    totalIncome,
    paymentsCount,
    averageTicket: paymentsCount ? roundMoney(totalIncome / paymentsCount) : 0,
    categoriesCount: byCategory.length,
    totalsByMethod: totalsByMethodList,
    byCategory,
    recentPayments: recentPayments.slice(0, 8),
  };
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
      cashToday: {
        date: new Date().toISOString(),
        totalIncome: 0,
        paymentsCount: 0,
        averageTicket: 0,
        categoriesCount: 0,
        totalsByMethod: [],
        byCategory: [],
        recentPayments: [],
      },
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

  const operationalDay = resolveOperationalDay();
  const paymentsTodayMatch = { paidAt: { $gte: operationalDay.startUtc, $lt: operationalDay.endUtc } };
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
  const cashToday = await getCashTodaySummary({ campusIds });

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
    cashToday,
  };
}
