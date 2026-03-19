import mongoose from 'mongoose';
import { Charge } from '../../models/charge.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { Student } from '../../models/student.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Campus } from '../../models/campus.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { Counter } from '../../models/counter.model.js';
import { Person } from '../../models/person.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { createPaymentRequestLog, findPaymentRequestByKey } from './repositories/payments.repository.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, normalizeSearchTerm } from '../../utils/search.js';

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toDecimal(value) {
  return mongoose.Types.Decimal128.fromString(roundMoney(value).toFixed(2));
}

function computeChargeStatus(totalAmount, outstandingAmount) {
  if (outstandingAmount <= 0) return 'PAID';
  if (outstandingAmount < totalAmount) return 'PARTIAL';
  return 'OPEN';
}

function normalizeReceiptNumber(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 6) {
    throw new ApiError(400, 'receiptNumber no puede exceder 6 dígitos');
  }
  return digits.padStart(6, '0');
}

async function nextPaymentInternalCode(session) {
  const counter = await Counter.findOneAndUpdate(
    { key: 'payment_internal_code' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );

  return `PAY-${String(counter.seq).padStart(6, '0')}`;
}

async function resolveScopedCampusFilter({ campus, campusScope = [] }) {
  const scopeAll = campusScope.includes('ALL');
  const requestedCampus = campus ? String(campus) : null;

  if (!scopeAll && requestedCampus && !campusScope.includes(requestedCampus)) {
    throw new ApiError(403, 'No autorizado para este campus');
  }

  const allowedCodes = requestedCampus
    ? [requestedCampus]
    : (scopeAll ? [] : campusScope.filter(Boolean));

  if (!allowedCodes.length) {
    return { scopeAll, allowedCodes, campusIds: [], campusById: new Map() };
  }

  const campuses = await Campus.find({ code: { $in: allowedCodes } }).select('_id code').lean();
  return {
    scopeAll,
    allowedCodes,
    campusIds: campuses.map((row) => row._id),
    campusById: new Map(campuses.map((row) => [String(row._id), row.code])),
  };
}

async function getActiveConceptColumns() {
  const concepts = await BillingConcept.find({ isActive: true })
    .select('_id code name')
    .sort({ code: 1, name: 1 })
    .lean();

  return concepts.map((concept) => ({
    conceptId: String(concept._id),
    code: concept.code,
    name: concept.name,
  }));
}

async function getLatestCampusCodeMap(studentIds) {
  if (!studentIds.length) return new Map();

  const cycles = await StudentCycle.find({ studentId: { $in: studentIds } })
    .sort({ updatedAt: -1 })
    .select('studentId campusId')
    .lean();

  const latestCampusIdByStudent = new Map();
  for (const row of cycles) {
    const key = String(row.studentId);
    if (!latestCampusIdByStudent.has(key)) {
      latestCampusIdByStudent.set(key, String(row.campusId));
    }
  }

  const campusIds = [...new Set(Array.from(latestCampusIdByStudent.values()))].map((id) => new mongoose.Types.ObjectId(id));
  const campuses = await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean();
  const campusCodeById = new Map(campuses.map((row) => [String(row._id), row.code]));

  const result = new Map();
  for (const [studentId, campusId] of latestCampusIdByStudent.entries()) {
    result.set(studentId, campusCodeById.get(campusId) || null);
  }
  return result;
}

async function summarizeChargesForStudentIds({ studentIds, cycleId, campusIds = [], conceptId }) {
  if (!studentIds.length) return new Map();

  const filter = {
    studentId: { $in: studentIds },
    status: { $ne: 'CANCELLED' },
  };
  if (cycleId) filter.cycleId = new mongoose.Types.ObjectId(cycleId);
  if (conceptId) filter.conceptId = new mongoose.Types.ObjectId(conceptId);
  if (campusIds.length) filter.campusId = { $in: campusIds };

  const charges = await Charge.find(filter)
    .select('studentId conceptId outstandingAmount dueDate')
    .lean();

  const now = new Date();
  const summaryByStudent = new Map();
  for (const charge of charges) {
    const studentKey = String(charge.studentId);
    const conceptKey = String(charge.conceptId);
    const outstanding = roundMoney(toMoney(charge.outstandingAmount));
    const isOverdue = Boolean(charge.dueDate && new Date(charge.dueDate) < now && outstanding > 0);

    if (!summaryByStudent.has(studentKey)) {
      summaryByStudent.set(studentKey, {
        totalPending: 0,
        totalOverdue: 0,
        conceptStatusByCode: {},
      });
    }

    const row = summaryByStudent.get(studentKey);
    row.totalPending = roundMoney(row.totalPending + outstanding);
    if (isOverdue) row.totalOverdue = roundMoney(row.totalOverdue + outstanding);

    if (!row.conceptStatusByCode[conceptKey]) {
      row.conceptStatusByCode[conceptKey] = {
        pendingAmount: 0,
        overdueAmount: 0,
        owes: false,
      };
    }

    row.conceptStatusByCode[conceptKey].pendingAmount = roundMoney(row.conceptStatusByCode[conceptKey].pendingAmount + outstanding);
    if (isOverdue) {
      row.conceptStatusByCode[conceptKey].overdueAmount = roundMoney(row.conceptStatusByCode[conceptKey].overdueAmount + outstanding);
    }
    row.conceptStatusByCode[conceptKey].owes = row.conceptStatusByCode[conceptKey].pendingAmount > 0;
  }

  return summaryByStudent;
}

function toConceptCodeMap(conceptColumns, conceptStatusById) {
  const result = {};
  for (const column of conceptColumns) {
    const source = conceptStatusById?.[column.conceptId];
    result[column.code] = source || {
      pendingAmount: 0,
      overdueAmount: 0,
      owes: false,
    };
  }
  return result;
}

async function buildStudentPaymentRows({ students, cycleId, campusIds = [], conceptId, conceptColumns }) {
  const studentIds = students.map((student) => student._id);
  const campusMap = await getLatestCampusCodeMap(studentIds);
  const chargeSummaryMap = await summarizeChargesForStudentIds({ studentIds, cycleId, campusIds, conceptId });

  return students.map((student) => {
    const key = String(student._id);
    const person = student.personId || {};
    const summary = chargeSummaryMap.get(key) || { totalPending: 0, totalOverdue: 0, conceptStatusByCode: {} };

    return {
      studentId: key,
      names: person.names || null,
      lastNames: person.lastNames || null,
      dni: person.dni || null,
      code: student.internalCode || null,
      campus: campusMap.get(key) || null,
      totalPending: summary.totalPending,
      totalOverdue: summary.totalOverdue,
      conceptStatusByCode: toConceptCodeMap(conceptColumns, summary.conceptStatusByCode),
    };
  });
}

async function resolveChargeScope({ studentId, familyId, session }) {
  if (studentId) {
    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Estudiante no encontrado');

    const latestCycle = await StudentCycle.findOne({ studentId: student._id }).sort({ updatedAt: -1 }).session(session);

    return {
      familyId: student.familyId,
      studentIds: [student._id],
      campusId: latestCycle?.campusId || null,
    };
  }

  const students = await Student.find({ familyId }).select('_id').session(session);
  if (!students.length) throw new ApiError(404, 'No hay estudiantes asociados a la familia');

  const latestFamilyCycle = await StudentCycle.findOne({ studentId: { $in: students.map((s) => s._id) } })
    .sort({ updatedAt: -1 })
    .session(session);

  return {
    familyId,
    studentIds: students.map((s) => s._id),
    campusId: latestFamilyCycle?.campusId || null,
  };
}

function autoAllocate(charges, amount) {
  const allocations = [];
  let remaining = roundMoney(amount);

  for (const charge of charges) {
    if (remaining <= 0) break;
    const outstanding = roundMoney(toMoney(charge.outstandingAmount));
    if (outstanding <= 0) continue;

    const applied = Math.min(outstanding, remaining);
    if (applied > 0) {
      allocations.push({ chargeId: charge._id.toString(), amount: roundMoney(applied) });
      remaining = roundMoney(remaining - applied);
    }
  }

  return allocations;
}

async function createPaymentAtomic({
  familyId,
  campusId,
  studentId,
  amount,
  paidAt,
  method,
  receiptNumber,
  voucherNumber,
  allocations,
  createdByUserId,
  notes,
  idempotencyKey,
}) {
  return runInTransaction(async (session) => {
    if (idempotencyKey) {
      const existingRequest = await findPaymentRequestByKey(idempotencyKey, session);
      if (existingRequest?.paymentId) {
        const existingPayment = await Payment.findById(existingRequest.paymentId)
          .populate('familyId')
          .populate('campusId')
          .lean();
        const allocationsSaved = await PaymentAllocation.find({ paymentId: existingRequest.paymentId }).populate('chargeId').lean();
        return {
          payment: existingPayment,
          allocations: allocationsSaved,
          summary: null,
          idempotentReplay: true,
        };
      }
    }

    const scope = await resolveChargeScope({ studentId, familyId, session });
    const paymentAmount = roundMoney(amount || allocations?.reduce((acc, item) => acc + item.amount, 0) || 0);
    if (paymentAmount <= 0) throw new ApiError(400, 'Monto de pago inválido');

    let resolvedAllocations = allocations || [];
    if (!resolvedAllocations.length) {
      const dueOrderedCharges = await Charge.find({
        studentId: { $in: scope.studentIds },
        outstandingAmount: { $gt: toDecimal(0) },
        status: { $ne: 'CANCELLED' },
      }).session(session);

      const now = new Date();
      dueOrderedCharges.sort((a, b) => {
        const aOverdue = a.dueDate && a.dueDate < now ? 0 : 1;
        const bOverdue = b.dueDate && b.dueDate < now ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;

        const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return String(a._id).localeCompare(String(b._id));
      });

      resolvedAllocations = autoAllocate(dueOrderedCharges, paymentAmount);
    }

    const allocationTotal = roundMoney(resolvedAllocations.reduce((acc, item) => acc + item.amount, 0));
    if (allocationTotal > paymentAmount) throw new ApiError(400, 'La suma de allocations no puede exceder el monto del pago');

    const resolvedCampusId = campusId || scope.campusId;
    if (!resolvedCampusId) throw new ApiError(400, 'No se pudo resolver campusId para registrar el pago');
    const normalizedReceiptNumber = normalizeReceiptNumber(receiptNumber || voucherNumber);
    const internalCode = await nextPaymentInternalCode(session);

    const [createdPayment] = await Payment.create([
      {
        familyId: scope.familyId,
        campusId: resolvedCampusId,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        totalAmount: toDecimal(paymentAmount),
        method,
        internalCode,
        receiptNumber: normalizedReceiptNumber,
        voucherNumber: normalizedReceiptNumber || internalCode,
        createdByUserId,
        notes,
      },
    ], { session });

    for (const alloc of resolvedAllocations) {
      const charge = await Charge.findById(alloc.chargeId).session(session);
      if (!charge) throw new ApiError(404, `Cargo no encontrado: ${alloc.chargeId}`);
      if (!scope.studentIds.some((id) => String(id) === String(charge.studentId))) {
        throw new ApiError(400, `El cargo ${alloc.chargeId} no pertenece al alumno/familia indicada`);
      }

      const currentOutstanding = roundMoney(toMoney(charge.outstandingAmount));
      const nextOutstanding = roundMoney(currentOutstanding - alloc.amount);
      if (nextOutstanding < -0.001) throw new ApiError(400, `La asignación excede el saldo pendiente del cargo ${alloc.chargeId}`);

      const normalizedOutstanding = Math.max(nextOutstanding, 0);
      const totalAmountCharge = roundMoney(toMoney(charge.totalAmount));
      charge.outstandingAmount = toDecimal(normalizedOutstanding);
      charge.status = computeChargeStatus(totalAmountCharge, normalizedOutstanding);
      await charge.save({ session });

      await PaymentAllocation.create([
        { paymentId: createdPayment._id, chargeId: charge._id, amount: toDecimal(alloc.amount) },
      ], { session });
    }

    if (idempotencyKey) {
      await createPaymentRequestLog({ idempotencyKey, paymentId: createdPayment._id }, session);
    }

    const allocationsSaved = await PaymentAllocation.find({ paymentId: createdPayment._id }).populate('chargeId').session(session);
    const charges = await Charge.find({ studentId: { $in: scope.studentIds } }).session(session);
    const summary = charges.reduce((acc, charge) => {
      acc.totalDebt = roundMoney(acc.totalDebt + toMoney(charge.totalAmount));
      acc.outstandingDebt = roundMoney(acc.outstandingDebt + toMoney(charge.outstandingAmount));
      return acc;
    }, { totalDebt: 0, outstandingDebt: 0 });

    return {
      payment: createdPayment,
      allocations: allocationsSaved,
      summary,
      replay: false,
    };
  });
}

export async function createPaymentService(payload) {
  const result = await createPaymentAtomic(payload);

  const paymentDoc = await Payment.findById(result.payment._id || result.payment.id)
    .populate('familyId')
    .populate('campusId');

  if (!result.idempotentReplay) {
    await registerAuditLog({
      entityType: 'PAYMENT',
      entityId: paymentDoc._id,
      action: 'PAYMENT_CREATED',
      performedBy: payload.createdByUserId,
      campusId: paymentDoc.campusId?._id || paymentDoc.campusId,
      payloadSnapshot: {
        amount: toMoney(paymentDoc.totalAmount),
        method: paymentDoc.method,
        allocations: result.allocations.map((row) => ({ chargeId: row.chargeId?._id || row.chargeId, amount: toMoney(row.amount) })),
      },
    });
  }

  return {
    payment: paymentDoc,
    allocations: result.allocations,
    summary: result.summary,
    idempotentReplay: Boolean(result.idempotentReplay),
  };
}

export async function getDebtorsService({ cycleId, conceptId, campus, campusScope = [], onlyOverdue = false, limit = 25, page = 1 }) {
  const normalizedLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  const normalizedPage = Math.max(1, Number(page) || 1);
  const { campusIds } = await resolveScopedCampusFilter({ campus, campusScope });
  const conceptColumns = await getActiveConceptColumns();

  const match = {
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
    status: { $ne: 'CANCELLED' },
  };
  if (cycleId) match.cycleId = new mongoose.Types.ObjectId(cycleId);
  if (conceptId) match.conceptId = new mongoose.Types.ObjectId(conceptId);
  if (campusIds.length) match.campusId = { $in: campusIds };
  if (onlyOverdue) match.dueDate = { $lt: new Date() };

  const zero = mongoose.Types.Decimal128.fromString('0');
  const grouped = await Charge.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$studentId',
        totalPending: { $sum: '$outstandingAmount' },
        totalOverdue: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$dueDate', null] },
                  { $lt: ['$dueDate', new Date()] },
                ],
              },
              '$outstandingAmount',
              zero,
            ],
          },
        },
      },
    },
    { $sort: { totalOverdue: -1, totalPending: -1, _id: 1 } },
    { $skip: (normalizedPage - 1) * normalizedLimit },
    { $limit: normalizedLimit + 1 },
  ]);

  const hasNext = grouped.length > normalizedLimit;
  const selected = hasNext ? grouped.slice(0, normalizedLimit) : grouped;
  const studentIds = selected.map((row) => row._id);

  const students = await Student.find({ _id: { $in: studentIds } })
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id personId internalCode')
    .lean();

  const studentsById = new Map(students.map((row) => [String(row._id), row]));
  const rows = await buildStudentPaymentRows({
    students: selected.map((row) => studentsById.get(String(row._id))).filter(Boolean),
    cycleId,
    campusIds,
    conceptId,
    conceptColumns,
  });

  const rowById = new Map(rows.map((row) => [row.studentId, row]));
  const orderedItems = selected
    .map((row) => rowById.get(String(row._id)))
    .filter(Boolean)
    .map((row) => ({
      ...row,
      totalPending: roundMoney(row.totalPending),
      totalOverdue: roundMoney(row.totalOverdue),
    }));

  return {
    conceptColumns,
    items: orderedItems,
    pageInfo: {
      page: normalizedPage,
      limit: normalizedLimit,
      hasNext,
    },
  };
}

export async function getDebtorsSearchService({ q, cycleId, campus, campusScope = [], limit = 15 }) {
  const normalizedLimit = Math.max(1, Math.min(60, Number(limit) || 15));
  const normalizedQ = normalizeSearchTerm(q);
  const { campusIds, allowedCodes } = await resolveScopedCampusFilter({ campus, campusScope });
  const conceptColumns = await getActiveConceptColumns();
  const regex = buildAccentInsensitiveRegex(q);
  const isMostlyNumeric = /^\d+$/.test(String(q || '').trim());

  const people = await Person.find({
    $or: [
      ...(regex ? [{ names: regex }, { lastNames: regex }] : []),
      ...(isMostlyNumeric ? [{ dni: new RegExp(`^${String(q).trim()}`) }] : []),
    ],
  })
    .select('_id names lastNames dni')
    .limit(normalizedLimit * 3)
    .lean();

  const personIds = people.map((row) => row._id);
  const codeRegex = new RegExp(`^${String(q || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const students = await Student.find({
    $or: [
      ...(personIds.length ? [{ personId: { $in: personIds } }] : []),
      { internalCode: codeRegex },
    ],
  })
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id personId internalCode')
    .limit(normalizedLimit * 3)
    .lean();

  const campusCodeMap = await getLatestCampusCodeMap(students.map((row) => row._id));
  const filteredStudents = students
    .filter((student) => {
      const campusCode = campusCodeMap.get(String(student._id)) || null;
      if (allowedCodes.length && campusCode && !allowedCodes.includes(campusCode)) return false;
      if (allowedCodes.length && !campusCode) return false;
      return true;
    })
    .map((student) => ({
      ...student,
      score: buildSearchScore({
        normalizedQ,
        dni: student.personId?.dni,
        names: student.personId?.names,
        lastNames: student.personId?.lastNames,
        internalCode: student.internalCode,
      }),
      id: String(student._id),
    }))
    .sort(byScoreThenId)
    .slice(0, normalizedLimit);

  const rows = await buildStudentPaymentRows({
    students: filteredStudents,
    cycleId,
    campusIds,
    conceptColumns,
  });

  return {
    conceptColumns,
    items: rows,
  };
}
