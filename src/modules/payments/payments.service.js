import mongoose from 'mongoose';
import { Charge } from '../../models/charge.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { Student } from '../../models/student.model.js';
import { Campus } from '../../models/campus.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { Counter } from '../../models/counter.model.js';
import { Person } from '../../models/person.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { createPaymentRequestLog, findPaymentRequestByKey } from './repositories/payments.repository.js';
import { buildAccentInsensitiveRegex, buildSearchScore, byScoreThenId, normalizeSearchTerm } from '../../utils/search.js';
import { getEnrollmentContextForStudent, getEnrollmentContextMapByStudentIds } from '../../shared/enrollmentCurrent.js';
import { resolveOperationalDay } from '../../shared/operationalDay.js';

function toMoney(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getMethodLabel(method) {
  const normalized = String(method || '').toUpperCase();
  if (normalized === 'CASH') return 'Efectivo';
  if (normalized === 'YAPE') return 'Yape';
  if (normalized === 'TRANSFER') return 'Transferencia';
  if (normalized === 'CAJA_AREQUIPA') return 'Caja Arequipa';
  return method || 'Sin metodo';
}

function buildGradeLabel(classroom = {}) {
  const displayName = String(classroom?.displayName || '').trim();
  if (displayName) return displayName;
  const grade = String(classroom?.grade || '').trim();
  const section = String(classroom?.section || '').trim();
  if (!grade && !section) return null;
  return [grade, section].filter(Boolean).join(' ');
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
  if (conceptCode) return { code: conceptCode, label: conceptName || conceptCode, order: 10 };

  const fallbackLabel = String(charge.description || '').trim();
  if (fallbackLabel) return { code: `DESC:${fallbackLabel.toUpperCase()}`, label: fallbackLabel, order: 20 };

  return { code: 'OTHER', label: 'Otros', order: 99 };
}

function buildChargeLabel(charge = {}) {
  const meta = buildCategoryMetaFromCharge(charge);
  if (meta.code === 'TUITION' && Number.isInteger(charge.monthIndex)) {
    const labels = ['Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const monthLabel = labels[charge.monthIndex] || null;
    if (monthLabel) return `${meta.label} - ${monthLabel}`;
  }
  return meta.label || charge.description || 'Cargo';
}

function toDecimal(value) {
  return mongoose.Types.Decimal128.fromString(roundMoney(value).toFixed(2));
}

function computeChargeStatus(totalAmount, outstandingAmount) {
  if (outstandingAmount <= 0) return 'PAID';
  if (outstandingAmount < totalAmount) return 'PARTIAL';
  return 'OPEN';
}

function hasRole(userRoles = [], expectedRole) {
  return userRoles.some((role) => String(role || '').trim().toUpperCase() === String(expectedRole || '').trim().toUpperCase());
}

function normalizeAllocationPayload(allocations = []) {
  return allocations
    .map((item) => ({
      chargeId: String(item?.chargeId || '').trim(),
      amount: roundMoney(toMoney(item?.amount)),
    }))
    .filter((item) => item.chargeId && item.amount > 0);
}

async function populatePaymentForResponse(paymentId, session = null) {
  const query = Payment.findById(paymentId)
    .populate('studentId')
    .populate('campusId');

  if (session) query.session(session);
  return query;
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

function normalizeVoucherNumber(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function resolvePaidAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date();

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(`${year}-${month}-${day}T12:00:00.000Z`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, 'paidAt inválido');
  }
  return parsed;
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
  const contexts = await getEnrollmentContextMapByStudentIds(studentIds);
  const result = new Map();
  for (const studentId of studentIds) {
    const context = contexts.get(String(studentId));
    result.set(String(studentId), context?.campus?.code || null);
  }
  return result;
}

async function getPaymentsByOperationalDate({ date, campus, campusScope = [], page = 1, limit = 25, excludeMethods = [] }) {
  const normalizedPage = Math.max(1, Number(page) || 1);
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const { campusIds } = await resolveScopedCampusFilter({ campus, campusScope });
  const day = resolveOperationalDay(date);

  const match = {
    paidAt: {
      $gte: day.startUtc,
      $lt: day.endUtc,
    },
  };
  if (campusIds.length) match.campusId = { $in: campusIds };
  const normalizedExcludeMethods = Array.isArray(excludeMethods)
    ? excludeMethods.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean)
    : [];
  if (normalizedExcludeMethods.length) {
    match.method = { $nin: normalizedExcludeMethods };
  }

  const payments = await Payment.find(match)
    .sort({ paidAt: -1, _id: -1 })
    .skip((normalizedPage - 1) * normalizedLimit)
    .limit(normalizedLimit + 1)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate('campusId', 'code name')
    .lean();

  return {
    day,
    campusIds,
    page: normalizedPage,
    limit: normalizedLimit,
    hasNext: payments.length > normalizedLimit,
    items: payments.length > normalizedLimit ? payments.slice(0, normalizedLimit) : payments,
  };
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
  const enrollmentContexts = await getEnrollmentContextMapByStudentIds(studentIds, { cycleId: cycleId || null });
  const chargeSummaryMap = await summarizeChargesForStudentIds({ studentIds, cycleId, campusIds, conceptId });

  return students.map((student) => {
    const key = String(student._id);
    const person = student.personId || {};
    const context = enrollmentContexts.get(key);
    const summary = chargeSummaryMap.get(key) || { totalPending: 0, totalOverdue: 0, conceptStatusByCode: {} };

    return {
      studentId: key,
      names: person.names || null,
      lastNames: person.lastNames || null,
      dni: person.dni || null,
      code: student.internalCode || null,
      campus: context?.campus?.code || null,
      classroomLabel: context?.classroom?.displayName || null,
      level: context?.classroom?.level || null,
      grade: context?.classroom?.grade || null,
      section: context?.classroom?.section || null,
      totalPending: summary.totalPending,
      totalOverdue: summary.totalOverdue,
      conceptStatusByCode: toConceptCodeMap(conceptColumns, summary.conceptStatusByCode),
    };
  });
}

async function resolveChargeScope({ studentId, session }) {
  const student = await Student.findById(studentId).session(session);
  if (!student) throw new ApiError(404, 'Estudiante no encontrado');
  const currentEnrollment = await getEnrollmentContextForStudent(student._id, { session });

  return {
    studentId: student._id,
    studentIds: [student._id],
    campusId: currentEnrollment?.campus?._id || currentEnrollment?.enrollment?.campusId || null,
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
          .populate('studentId')
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

    const scope = await resolveChargeScope({ studentId, session });
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
    const normalizedReceiptNumber = normalizeReceiptNumber(receiptNumber || '');
    const normalizedVoucherNumber = normalizeVoucherNumber(voucherNumber || '') || normalizedReceiptNumber || internalCode;
    const internalCode = await nextPaymentInternalCode(session);

    const [createdPayment] = await Payment.create([
      {
        studentId: scope.studentId,
        studentIds: scope.studentIds,
        campusId: resolvedCampusId,
        paidAt: resolvePaidAt(paidAt),
        totalAmount: toDecimal(paymentAmount),
        method,
        internalCode,
        receiptNumber: normalizedReceiptNumber,
        voucherNumber: normalizedVoucherNumber,
        createdByUserId,
        notes,
      },
    ], { session });

    for (const alloc of resolvedAllocations) {
      const charge = await Charge.findById(alloc.chargeId).session(session);
      if (!charge) throw new ApiError(404, `Cargo no encontrado: ${alloc.chargeId}`);
      if (!scope.studentIds.some((id) => String(id) === String(charge.studentId))) {
        throw new ApiError(400, `El cargo ${alloc.chargeId} no pertenece al alumno indicado`);
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
    .populate('studentId')
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

export async function updatePaymentReceiptService({ paymentId, payload, userId }) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new ApiError(400, 'paymentId inválido');

  const payment = await Payment.findById(paymentId)
    .populate('studentId')
    .populate('campusId');
  if (!payment) throw new ApiError(404, 'Pago no encontrado');

  const previous = {
    method: payment.method,
    receiptNumber: payment.receiptNumber || null,
    voucherNumber: payment.voucherNumber || null,
    notes: payment.notes || null,
  };

  payment.method = payload.method;
  payment.receiptNumber = normalizeReceiptNumber(payload.receiptNumber || '') || null;
  payment.voucherNumber = normalizeVoucherNumber(payload.voucherNumber || '') || payment.internalCode;
  payment.notes = String(payload.notes || '').trim() || undefined;

  await payment.save();

  await registerAuditLog({
    entityType: 'PAYMENT',
    entityId: payment._id,
    action: 'PAYMENT_RECEIPT_CORRECTED',
    performedBy: userId,
    campusId: payment.campusId?._id || payment.campusId,
    payloadSnapshot: {
      correctionReason: payload.correctionReason,
      previous,
      next: {
        method: payment.method,
        receiptNumber: payment.receiptNumber || null,
        voucherNumber: payment.voucherNumber || null,
        notes: payment.notes || null,
      },
    },
  });

  return payment;
}

export async function updatePaymentReceiptServiceV2({ paymentId, payload, userId, userRoles = [] }) {
  if (!mongoose.Types.ObjectId.isValid(paymentId)) throw new ApiError(400, 'paymentId inválido');

  const isAdmin = hasRole(userRoles, 'ADMIN');
  const wantsReassignment = Boolean(payload.reassignStudentId || (Array.isArray(payload.reassignAllocations) && payload.reassignAllocations.length));
  const wantsAmountChange = payload.amount !== undefined && payload.amount !== null;
  const wantsPaidAtChange = Boolean(String(payload.paidAt || '').trim());
  if (wantsReassignment && !isAdmin) {
    throw new ApiError(403, 'Solo admin puede reasignar el pago a otro alumno');
  }
  if (wantsAmountChange && !isAdmin) {
    throw new ApiError(403, 'Solo admin puede modificar el monto del recibo');
  }
  if (wantsPaidAtChange && !isAdmin) {
    throw new ApiError(403, 'Solo admin puede modificar la fecha del recibo');
  }

  const correctionResult = await runInTransaction(async (session) => {
    const restoreAllocationsToCharges = async (allocations) => {
      for (const allocation of allocations) {
        const charge = allocation.chargeId;
        if (!charge?._id) continue;

        const currentOutstanding = roundMoney(toMoney(charge.outstandingAmount));
        const totalAmountCharge = roundMoney(toMoney(charge.totalAmount));
        const restoredOutstanding = roundMoney(currentOutstanding + roundMoney(toMoney(allocation.amount)));
        charge.outstandingAmount = toDecimal(restoredOutstanding);
        charge.status = computeChargeStatus(totalAmountCharge, restoredOutstanding);
        await charge.save({ session });
      }
    };

    const applyAllocationsToCharges = async ({ allocations, allowedStudentId = null }) => {
      const targetCharges = await Charge.find({
        _id: { $in: allocations.map((item) => item.chargeId) },
        status: { $ne: 'CANCELLED' },
      }).session(session);
      const targetChargeMap = new Map(targetCharges.map((row) => [String(row._id), row]));

      let resolvedCampusId = null;
      for (const allocation of allocations) {
        const charge = targetChargeMap.get(allocation.chargeId);
        if (!charge) throw new ApiError(404, `Cargo destino no encontrado: ${allocation.chargeId}`);
        if (allowedStudentId && String(charge.studentId) !== String(allowedStudentId)) {
          throw new ApiError(400, `El cargo ${allocation.chargeId} no pertenece al alumno seleccionado`);
        }

        const currentOutstanding = roundMoney(toMoney(charge.outstandingAmount));
        if (allocation.amount > currentOutstanding + 0.001) {
          throw new ApiError(400, `La asignación excede el saldo pendiente del cargo ${allocation.chargeId}`);
        }

        const nextOutstanding = Math.max(0, roundMoney(currentOutstanding - allocation.amount));
        const totalAmountCharge = roundMoney(toMoney(charge.totalAmount));
        charge.outstandingAmount = toDecimal(nextOutstanding);
        charge.status = computeChargeStatus(totalAmountCharge, nextOutstanding);
        await charge.save({ session });

        if (!resolvedCampusId && charge.campusId) resolvedCampusId = charge.campusId;

        await PaymentAllocation.create([
          {
            paymentId: payment._id,
            chargeId: charge._id,
            amount: toDecimal(allocation.amount),
          },
        ], { session });
      }

      return resolvedCampusId;
    };

    const rebuildAllocationsForAmount = (allocations, targetAmount) => {
      const normalizedTargetAmount = roundMoney(targetAmount);
      let remaining = normalizedTargetAmount;
      const rebuilt = [];

      for (const allocation of allocations) {
        if (remaining <= 0) break;
        const currentOutstanding = roundMoney(toMoney(allocation.chargeId?.outstandingAmount));
        const previousAmount = roundMoney(toMoney(allocation.amount));
        const maxApplicableAmount = roundMoney(currentOutstanding + previousAmount);
        const appliedAmount = Math.min(maxApplicableAmount, remaining);
        if (appliedAmount > 0) {
          rebuilt.push({
            chargeId: allocation.chargeId?._id ? String(allocation.chargeId._id) : String(allocation.chargeId || ''),
            amount: roundMoney(appliedAmount),
          });
          remaining = roundMoney(remaining - appliedAmount);
        }
      }

      if (remaining > 0.001) {
        throw new ApiError(400, 'El nuevo monto excede la suma de los cargos actualmente afectados por el pago');
      }

      return rebuilt;
    };

    const payment = await Payment.findById(paymentId)
      .populate('studentId')
      .populate('campusId')
      .session(session);
    if (!payment) throw new ApiError(404, 'Pago no encontrado');

    const currentAllocations = await PaymentAllocation.find({ paymentId: payment._id })
      .populate('chargeId')
      .session(session);

    const previous = {
      studentId: payment.studentId?._id ? String(payment.studentId._id) : String(payment.studentId || ''),
      amount: roundMoney(toMoney(payment.totalAmount)),
      paidAt: payment.paidAt || null,
      method: payment.method,
      receiptNumber: payment.receiptNumber || null,
      voucherNumber: payment.voucherNumber || null,
      notes: payment.notes || null,
      allocations: currentAllocations.map((row) => ({
        chargeId: row.chargeId?._id ? String(row.chargeId._id) : String(row.chargeId || ''),
        studentId: row.chargeId?.studentId ? String(row.chargeId.studentId) : null,
        amount: roundMoney(toMoney(row.amount)),
      })),
    };

    if (wantsReassignment) {
      const targetStudentId = String(payload.reassignStudentId || '').trim();
      if (!mongoose.Types.ObjectId.isValid(targetStudentId)) {
        throw new ApiError(400, 'reassignStudentId inválido');
      }

      const targetStudent = await Student.findById(targetStudentId).session(session);
      if (!targetStudent) throw new ApiError(404, 'Alumno destino no encontrado');

      const reassignmentAllocations = normalizeAllocationPayload(payload.reassignAllocations || []);
      if (!reassignmentAllocations.length) {
        throw new ApiError(400, 'Se requiere al menos un cargo destino para reasignar el pago');
      }

      const paymentTotal = wantsAmountChange
        ? roundMoney(toMoney(payload.amount))
        : roundMoney(toMoney(payment.totalAmount));
      const reassignedTotal = roundMoney(reassignmentAllocations.reduce((acc, item) => acc + item.amount, 0));
      if (roundMoney(paymentTotal - reassignedTotal) !== 0) {
        throw new ApiError(400, 'La suma de los cargos destino debe coincidir exactamente con el total del pago');
      }

      await restoreAllocationsToCharges(currentAllocations);

      await PaymentAllocation.deleteMany({ paymentId: payment._id }).session(session);

      const targetCharges = await Charge.find({
        _id: { $in: reassignmentAllocations.map((item) => item.chargeId) },
        status: { $ne: 'CANCELLED' },
      }).session(session);
      const targetChargeMap = new Map(targetCharges.map((row) => [String(row._id), row]));

      let resolvedCampusId = null;
      for (const allocation of reassignmentAllocations) {
        const charge = targetChargeMap.get(allocation.chargeId);
        if (!charge) throw new ApiError(404, `Cargo destino no encontrado: ${allocation.chargeId}`);
        if (String(charge.studentId) !== targetStudentId) {
          throw new ApiError(400, `El cargo ${allocation.chargeId} no pertenece al alumno seleccionado`);
        }

        const currentOutstanding = roundMoney(toMoney(charge.outstandingAmount));
        if (allocation.amount > currentOutstanding + 0.001) {
          throw new ApiError(400, `La asignación excede el saldo pendiente del cargo ${allocation.chargeId}`);
        }

        const nextOutstanding = Math.max(0, roundMoney(currentOutstanding - allocation.amount));
        const totalAmountCharge = roundMoney(toMoney(charge.totalAmount));
        charge.outstandingAmount = toDecimal(nextOutstanding);
        charge.status = computeChargeStatus(totalAmountCharge, nextOutstanding);
        await charge.save({ session });

        if (!resolvedCampusId && charge.campusId) resolvedCampusId = charge.campusId;

        await PaymentAllocation.create([
          {
            paymentId: payment._id,
            chargeId: charge._id,
            amount: toDecimal(allocation.amount),
          },
        ], { session });
      }

      payment.studentId = targetStudent._id;
      payment.studentIds = [targetStudent._id];
      if (resolvedCampusId) payment.campusId = resolvedCampusId;
      payment.totalAmount = toDecimal(paymentTotal);
    } else if (wantsAmountChange) {
      const correctedAmount = roundMoney(toMoney(payload.amount));
      if (!currentAllocations.length) {
        payment.totalAmount = toDecimal(correctedAmount);
      } else {
        const rebuiltAllocations = rebuildAllocationsForAmount(currentAllocations, correctedAmount);

        await restoreAllocationsToCharges(currentAllocations);
        await PaymentAllocation.deleteMany({ paymentId: payment._id }).session(session);
        await applyAllocationsToCharges({ allocations: rebuiltAllocations });

        payment.totalAmount = toDecimal(correctedAmount);
      }
    }

    payment.method = payload.method;
    if (wantsPaidAtChange) {
      const parsedPaidAt = new Date(String(payload.paidAt).trim());
      if (Number.isNaN(parsedPaidAt.getTime())) {
        throw new ApiError(400, 'paidAt inválido');
      }
      payment.paidAt = parsedPaidAt;
    }
    payment.receiptNumber = normalizeReceiptNumber(payload.receiptNumber || '') || null;
    payment.voucherNumber = normalizeVoucherNumber(payload.voucherNumber || '') || payment.internalCode;
    payment.notes = String(payload.notes || '').trim() || undefined;

    await payment.save({ session });

    const refreshedPayment = await populatePaymentForResponse(payment._id, session);
    const nextStudentId = refreshedPayment?.studentId?._id ? String(refreshedPayment.studentId._id) : String(refreshedPayment?.studentId || '');

    return {
      payment: refreshedPayment,
      previous,
      affectedStudentIds: Array.from(new Set([previous.studentId || null, nextStudentId || null].filter(Boolean))),
    };
  });

  await registerAuditLog({
    entityType: 'PAYMENT',
    entityId: correctionResult.payment._id,
    action: 'PAYMENT_RECEIPT_CORRECTED',
    performedBy: userId,
    campusId: correctionResult.payment.campusId?._id || correctionResult.payment.campusId,
    payloadSnapshot: {
      correctionReason: payload.correctionReason,
      previous: correctionResult.previous,
      next: {
        studentId: correctionResult.payment.studentId?._id ? String(correctionResult.payment.studentId._id) : String(correctionResult.payment.studentId || ''),
        amount: roundMoney(toMoney(correctionResult.payment.totalAmount)),
        paidAt: correctionResult.payment.paidAt || null,
        method: correctionResult.payment.method,
        receiptNumber: correctionResult.payment.receiptNumber || null,
        voucherNumber: correctionResult.payment.voucherNumber || null,
        notes: correctionResult.payment.notes || null,
      },
      affectedStudentIds: correctionResult.affectedStudentIds,
    },
  });

  return {
    ...correctionResult.payment.toObject(),
    amount: roundMoney(toMoney(correctionResult.payment.totalAmount)),
    affectedStudentIds: correctionResult.affectedStudentIds,
  };
}

export async function getDebtorsService({ cycleId, conceptId, campus, campusScope = [], onlyOverdue = false, limit = 25, page = 1 }) {
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 25));
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
  const normalizedLimit = Math.max(1, Math.min(1000, Number(limit) || 15));
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

export async function getDebtorsPrintService({ studentIds = [], filters = {}, campusScope = [] }) {
  const normalizedStudentIds = [...new Set(
    (Array.isArray(studentIds) ? studentIds : [])
      .map((id) => String(id || '').trim())
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
  )];

  if (!normalizedStudentIds.length) {
    throw new ApiError(400, 'Debes seleccionar al menos un alumno');
  }

  const cycleId = filters?.cycleId;
  const conceptId = filters?.conceptId;
  const campus = filters?.campus || filters?.campusId;
  const onlyOverdue = Boolean(filters?.onlyOverdue);
  const { campusIds } = await resolveScopedCampusFilter({ campus, campusScope });
  const conceptColumns = await getActiveConceptColumns();

  const students = await Student.find({ _id: { $in: normalizedStudentIds } })
    .populate({ path: 'personId', select: 'names lastNames dni' })
    .select('_id personId internalCode')
    .lean();

  const rows = await buildStudentPaymentRows({
    students,
    cycleId,
    campusIds,
    conceptId,
    conceptColumns,
  });

  const rowById = new Map(rows.map((row) => [row.studentId, row]));
  const items = normalizedStudentIds
    .map((studentId) => rowById.get(studentId))
    .filter(Boolean)
    .filter((row) => row.totalPending > 0)
    .filter((row) => !onlyOverdue || row.totalOverdue > 0)
    .map((row) => {
      const conceptsSummary = conceptColumns
        .map((column) => {
          const concept = row.conceptStatusByCode?.[column.code];
          const pendingAmount = roundMoney(toMoney(concept?.pendingAmount));
          if (pendingAmount <= 0) return null;
          return {
            code: column.code,
            label: column.name,
            pendingAmount,
            overdueAmount: roundMoney(toMoney(concept?.overdueAmount)),
          };
        })
        .filter(Boolean);

      return {
        ...row,
        fullName: [row.lastNames, row.names].filter(Boolean).join(', ') || '-',
        pendingNonOverdue: roundMoney(Math.max(0, roundMoney(row.totalPending) - roundMoney(row.totalOverdue))),
        totalPending: roundMoney(row.totalPending),
        totalOverdue: roundMoney(row.totalOverdue),
        conceptsSummary,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    conceptColumns,
    items,
  };
}

export async function getDailyPaymentSummaryService({ date, campus, campusScope = [] }) {
  const { day, items: payments } = await getPaymentsByOperationalDate({
    date,
    campus,
    campusScope,
    page: 1,
    limit: 500,
    excludeMethods: ['CAJA_AREQUIPA'],
  });

  const totalsByMethodMap = {
    CASH: { method: 'CASH', label: getMethodLabel('CASH'), totalAmount: 0, paymentsCount: 0, share: 0 },
    YAPE: { method: 'YAPE', label: getMethodLabel('YAPE'), totalAmount: 0, paymentsCount: 0, share: 0 },
    TRANSFER: { method: 'TRANSFER', label: getMethodLabel('TRANSFER'), totalAmount: 0, paymentsCount: 0, share: 0 },
  };

  for (const payment of payments) {
    const methodKey = String(payment.method || '').toUpperCase();
    if (!totalsByMethodMap[methodKey]) {
      totalsByMethodMap[methodKey] = {
        method: methodKey || 'UNKNOWN',
        label: getMethodLabel(payment.method),
        totalAmount: 0,
        paymentsCount: 0,
        share: 0,
      };
    }

    totalsByMethodMap[methodKey].totalAmount = roundMoney(
      totalsByMethodMap[methodKey].totalAmount + toMoney(payment.totalAmount)
    );
    totalsByMethodMap[methodKey].paymentsCount += 1;
  }

  const totalIncome = roundMoney(payments.reduce((acc, payment) => acc + toMoney(payment.totalAmount), 0));
  const paymentsCount = payments.length;
  const totalsByMethod = Object.values(totalsByMethodMap).map((row) => ({
    ...row,
    totalAmount: roundMoney(row.totalAmount),
    share: totalIncome > 0 ? roundMoney((row.totalAmount / totalIncome) * 100) : 0,
  }));

  return {
    date: day.date,
    totalIncome,
    paymentsCount,
    averageTicket: paymentsCount ? roundMoney(totalIncome / paymentsCount) : 0,
    totalsByMethod,
  };
}

export async function getDailyPaymentTransactionsService({ date, campus, page = 1, limit = 25, campusScope = [] }) {
  const result = await getPaymentsByOperationalDate({
    date,
    campus,
    campusScope,
    page,
    limit,
    excludeMethods: ['CAJA_AREQUIPA'],
  });
  const paymentIds = result.items.map((payment) => payment._id);

  const allocations = paymentIds.length
    ? await PaymentAllocation.find({ paymentId: { $in: paymentIds } })
      .populate({
        path: 'chargeId',
        populate: [
          { path: 'studentId', populate: { path: 'personId' } },
          { path: 'campusId', select: 'code name' },
          { path: 'conceptId', select: 'code name' },
        ],
      })
      .lean()
    : [];

  const allocationsByPaymentId = new Map();
  const studentIds = new Set();
  for (const allocation of allocations) {
    const paymentId = String(allocation.paymentId || '');
    if (!allocationsByPaymentId.has(paymentId)) allocationsByPaymentId.set(paymentId, []);
    allocationsByPaymentId.get(paymentId).push(allocation);

    const studentId = allocation.chargeId?.studentId?._id || allocation.chargeId?.studentId;
    if (studentId) studentIds.add(String(studentId));
  }

  const contexts = await getEnrollmentContextMapByStudentIds(Array.from(studentIds));

  const items = result.items.map((payment) => {
    const paymentId = String(payment._id);
    const paymentAllocations = allocationsByPaymentId.get(paymentId) || [];
    const categoryCodes = new Set();

    const allocationsView = paymentAllocations.map((allocation) => {
      const charge = allocation.chargeId || {};
      const studentId = String(charge.studentId?._id || charge.studentId || '');
      const context = studentId ? contexts.get(studentId) : null;
      const categoryMeta = buildCategoryMetaFromCharge(charge);
      categoryCodes.add(categoryMeta.code);

      const chargeAmount = roundMoney(toMoney(charge.totalAmount));
      const outstandingAmount = roundMoney(toMoney(charge.outstandingAmount));
      const allocationAmount = roundMoney(toMoney(allocation.amount));

      return {
        chargeId: String(charge._id || ''),
        concept: buildChargeLabel(charge),
        amount: allocationAmount,
        isPartial: outstandingAmount > 0 && allocationAmount < chargeAmount,
        campusCode: charge.campusId?.code || context?.campus?.code || payment.campusId?.code || null,
      };
    });

    const student = payment.studentId || {};
    const context = student?._id ? contexts.get(String(student._id)) : null;

    return {
      paymentId,
      studentId: student?._id ? String(student._id) : null,
      studentName: student?.personId ? `${student.personId.lastNames || ''}, ${student.personId.names || ''}`.replace(/^,\s*|\s*,\s*$/g, '').trim() || 'Alumno' : 'Alumno',
      gradeLabel: buildGradeLabel(context?.classroom),
      campusCode: payment.campusId?.code || context?.campus?.code || null,
      amount: roundMoney(toMoney(payment.totalAmount)),
      paidAt: payment.paidAt,
      method: payment.method,
      methodLabel: getMethodLabel(payment.method),
      internalCode: payment.internalCode || null,
      receiptNumber: payment.receiptNumber || null,
      voucherNumber: payment.voucherNumber || null,
      note: payment.notes || null,
      categoryLabel: categoryCodes.size === 1
        ? (paymentAllocations[0] ? buildCategoryMetaFromCharge(paymentAllocations[0].chargeId || {}).label : 'Pago')
        : (categoryCodes.size > 1 ? 'Mixto' : 'Pago'),
      allocations: allocationsView,
    };
  });

  return {
    date: result.day.date,
    items,
    pageInfo: {
      page: result.page,
      limit: result.limit,
      hasNext: result.hasNext,
    },
  };
}

