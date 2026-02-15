import mongoose from 'mongoose';
import { Charge } from '../../models/charge.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { Student } from '../../models/student.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Campus } from '../../models/campus.model.js';
import { ApiError } from '../../utils/errors.js';
import { runInTransaction } from '../../shared/dbSession.js';
import { registerAuditLog } from '../../shared/audit.service.js';
import { createPaymentRequestLog, findPaymentRequestByKey } from './repositories/payments.repository.js';

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

    const [createdPayment] = await Payment.create([
      {
        familyId: scope.familyId,
        campusId: resolvedCampusId,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        totalAmount: toDecimal(paymentAmount),
        method,
        voucherNumber: voucherNumber || `AUTO-${Date.now()}`,
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

export async function getDebtorsService({ cycleId, conceptId, q, campus, campusScope = [] }) {
  const filter = {
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
    status: { $ne: 'CANCELLED' },
  };

  if (cycleId) filter.cycleId = cycleId;
  if (conceptId) filter.conceptId = conceptId;

  const charges = await Charge.find(filter)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .lean();

  const scopeAll = campusScope.includes('*');
  const campusFilter = campus ? String(campus) : null;
  const studentIds = [...new Set(charges.map((charge) => String(charge.studentId?._id)).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));

  const studentCycles = studentIds.length
    ? await StudentCycle.find({ studentId: { $in: studentIds } }).sort({ updatedAt: -1 }).select('studentId campusId').lean()
    : [];

  const latestCampusByStudent = new Map();
  for (const row of studentCycles) {
    const key = String(row.studentId);
    if (!latestCampusByStudent.has(key)) latestCampusByStudent.set(key, String(row.campusId));
  }

  const campusIds = [...new Set(Array.from(latestCampusByStudent.values()))].map((id) => new mongoose.Types.ObjectId(id));
  const campuses = await Campus.find({ _id: { $in: campusIds } }).select('_id code').lean();
  const campusById = new Map(campuses.map((row) => [String(row._id), row.code]));

  if (!scopeAll && campusFilter && !campusScope.includes(campusFilter)) {
    const campusFromId = campusById.get(campusFilter);
    if (!campusFromId || !campusScope.includes(campusFromId)) throw new ApiError(403, 'No autorizado para este campus');
  }

  const now = new Date();
  const grouped = new Map();

  for (const charge of charges) {
    const student = charge.studentId;
    if (!student?._id || !student.personId) continue;

    const studentKey = String(student._id);
    const studentCampusId = latestCampusByStudent.get(studentKey) || null;
    const studentCampus = studentCampusId ? campusById.get(studentCampusId) || studentCampusId : null;

    if (!scopeAll && campusScope.length && !campusScope.includes(studentCampus) && !campusScope.includes(studentCampusId)) continue;
    if (campusFilter && campusFilter !== studentCampusId && campusFilter !== studentCampus) continue;

    if (q) {
      const term = String(q).toLowerCase();
      const matches = [student.personId.names, student.personId.lastNames, student.personId.dni, student.internalCode]
        .some((value) => String(value || '').toLowerCase().includes(term));
      if (!matches) continue;
    }

    const outstanding = toMoney(charge.outstandingAmount);
    if (!grouped.has(studentKey)) {
      grouped.set(studentKey, {
        studentId: studentKey,
        names: student.personId.names || null,
        lastNames: student.personId.lastNames || null,
        dni: student.personId.dni || null,
        campus: studentCampus,
        totalPending: 0,
        totalOverdue: 0,
      });
    }

    const row = grouped.get(studentKey);
    row.totalPending = roundMoney(row.totalPending + outstanding);
    if (charge.dueDate && new Date(charge.dueDate) < now) row.totalOverdue = roundMoney(row.totalOverdue + outstanding);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalPending - a.totalPending);
}
