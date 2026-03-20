import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { Campus } from '../../models/campus.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { Charge } from '../../models/charge.model.js';
import { StudentCycle } from '../../models/studentCycle.model.js';
import { Vacancy } from '../../models/vacancy.model.js';
import { Classroom } from '../../models/classroom.model.js';
import { ApiError } from '../../utils/errors.js';
import { registerAuditLog } from '../../shared/audit.service.js';

async function resolveStudent({ studentId, studentCod }, session) {
  if (studentId) {
    if (!mongoose.Types.ObjectId.isValid(studentId)) throw new ApiError(400, 'studentId inválido');
    const student = await Student.findById(studentId).session(session);
    if (!student) throw new ApiError(404, 'Alumno no encontrado');
    return student;
  }

  if (studentCod) {
    const student = await Student.findOne({ internalCode: studentCod }).session(session);
    if (!student) throw new ApiError(404, 'Alumno no encontrado por studentCod');
    return student;
  }

  throw new ApiError(400, 'Debes enviar studentId o studentCod');
}

function buildConceptCode(conceptName) {
  const raw = String(conceptName || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return raw || 'CONCEPTO';
}

async function resolveCampus(campusId, session) {
  if (!campusId || !mongoose.Types.ObjectId.isValid(campusId)) {
    throw new ApiError(400, 'campusId inválido');
  }

  const campus = await Campus.findById(campusId).select('_id code').session(session);
  if (!campus) throw new ApiError(404, 'Campus no encontrado');
  return campus;
}

async function resolveConceptByName(conceptName, session) {
  const cleanName = String(conceptName || '').trim();
  const code = buildConceptCode(cleanName);

  let concept = await BillingConcept.findOne({ $or: [{ name: cleanName }, { code }] }).session(session);
  if (!concept) {
    concept = await BillingConcept.create([
      { code, name: cleanName, isActive: true },
    ], { session });
    return concept[0];
  }

  if (!concept.code) {
    concept.code = code;
    await concept.save({ session, validateModifiedOnly: true });
  }

  return concept;
}

async function resolveConcept({ billingConceptId, conceptName }, session) {
  if (billingConceptId) {
    if (!mongoose.Types.ObjectId.isValid(billingConceptId)) {
      throw new ApiError(400, 'billingConceptId invÃ¡lido');
    }

    const concept = await BillingConcept.findById(billingConceptId).session(session);
    if (!concept) throw new ApiError(404, 'Concepto de cobro no encontrado');
    return concept;
  }

  if (conceptName) {
    return resolveConceptByName(conceptName, session);
  }

  throw new ApiError(400, 'Debes enviar billingConceptId o conceptName');
}

async function resolveChargeContext(student, { cycleId, campusId }, session) {
  let resolvedCycleId = cycleId ? String(cycleId) : '';
  let resolvedCampusId = campusId ? String(campusId) : '';
  let studentCycle = null;

  if (resolvedCycleId && mongoose.Types.ObjectId.isValid(resolvedCycleId)) {
    studentCycle = await StudentCycle.findOne({ studentId: student._id, cycleId: resolvedCycleId }).session(session);
  }

  if (!studentCycle) {
    studentCycle = await StudentCycle.findOne({ studentId: student._id })
      .sort({ createdAt: -1, _id: -1 })
      .session(session);
  }

  if (studentCycle) {
    resolvedCycleId = resolvedCycleId || String(studentCycle.cycleId);
    resolvedCampusId = resolvedCampusId || String(studentCycle.campusId);
  }

  if (!resolvedCampusId || !resolvedCycleId) {
    const vacancy = resolvedCycleId
      ? await Vacancy.findOne({ studentId: student._id, cycleId: resolvedCycleId }).session(session)
      : await Vacancy.findOne({ studentId: student._id }).sort({ createdAt: -1, _id: -1 }).session(session);

    if (vacancy) {
      resolvedCycleId = resolvedCycleId || String(vacancy.cycleId);
      const classroom = await Classroom.findById(vacancy.classroomId).select('campusId').session(session);
      if (classroom?.campusId) {
        resolvedCampusId = resolvedCampusId || String(classroom.campusId);
      }
    }
  }

  if (!resolvedCycleId || !resolvedCampusId) {
    throw new ApiError(400, 'No se pudo determinar el ciclo o campus del cargo');
  }

  return { cycleId: resolvedCycleId, campusId: resolvedCampusId };
}

export async function createChargeService({
  studentId,
  studentCod,
  cycleId,
  campusId,
  billingConceptId,
  conceptName,
  description,
  amount,
  dueDate,
  notes,
  observation,
  createdByUserId = null,
}) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const student = await resolveStudent({ studentId, studentCod }, session);
    const context = await resolveChargeContext(student, { cycleId, campusId }, session);
    const campus = await resolveCampus(context.campusId, session);
    const concept = await resolveConcept({ billingConceptId, conceptName }, session);
    const safeDescription = String(description || concept.name || concept.code || 'Cargo').trim();
    const safeNotes = String(notes || observation || '').trim();

    const charge = await Charge.create([
      {
        studentId: student._id,
        cycleId: context.cycleId,
        campusId: campus._id,
        conceptId: concept._id,
        description: safeDescription,
        totalAmount: mongoose.Types.Decimal128.fromString(amount.toString()),
        outstandingAmount: mongoose.Types.Decimal128.fromString(amount.toString()),
        dueDate: dueDate ? new Date(dueDate) : new Date(),
        status: 'OPEN',
        notes: safeNotes || undefined,
      },
    ], { session });

    await session.commitTransaction();

    const createdCharge = await Charge.findById(charge[0]._id)
      .populate({ path: 'studentId', populate: { path: 'personId' } })
      .populate('conceptId')
      .populate('cycleId')
      .populate('campusId');

    if (createdByUserId) {
      await registerAuditLog({
        entityType: 'CHARGE',
        entityId: createdCharge._id,
        action: 'CHARGE_CREATED',
        performedBy: createdByUserId,
        campusId: campus._id,
        payloadSnapshot: {
          amount,
          conceptName: concept.name,
          cycleId: context.cycleId,
          campusId: campus._id,
        },
      });
    }

    return createdCharge;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

function money(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function decimal(value) {
  return mongoose.Types.Decimal128.fromString(Number(value).toFixed(2));
}

function resolveChargeStatus({ totalAmount, outstandingAmount, currentStatus }) {
  if (currentStatus === 'CANCELLED') return 'CANCELLED';
  if (outstandingAmount <= 0) return 'PAID';
  if (outstandingAmount < totalAmount) return 'PARTIAL';
  return 'OPEN';
}

export async function updateChargeService(chargeId, { amount, dueDate }, updatedByUserId = null) {
  if (!mongoose.Types.ObjectId.isValid(chargeId)) {
    throw new ApiError(400, 'chargeId inválido');
  }

  const charge = await Charge.findById(chargeId);
  if (!charge) throw new ApiError(404, 'Cargo no encontrado');
  if (charge.status === 'CANCELLED') {
    throw new ApiError(409, 'No se puede editar un cargo cancelado');
  }

  const nextAmount = Number(amount);
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    throw new ApiError(400, 'amount inválido');
  }

  const currentTotal = money(charge.totalAmount);
  const currentOutstanding = money(charge.outstandingAmount);
  const alreadyPaid = Math.max(currentTotal - currentOutstanding, 0);

  if (nextAmount < alreadyPaid) {
    throw new ApiError(409, 'El nuevo monto no puede ser menor a lo ya pagado');
  }

  const nextOutstanding = Math.max(nextAmount - alreadyPaid, 0);
  const nextDueDate = dueDate ? new Date(dueDate) : new Date();

  charge.totalAmount = decimal(nextAmount);
  charge.outstandingAmount = decimal(nextOutstanding);
  charge.dueDate = nextDueDate;
  charge.status = resolveChargeStatus({
    totalAmount: nextAmount,
    outstandingAmount: nextOutstanding,
    currentStatus: charge.status,
  });

  await charge.save();

  const updatedCharge = await Charge.findById(charge._id)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate('conceptId')
    .populate('cycleId')
    .populate('campusId');

  if (updatedByUserId) {
    await registerAuditLog({
      entityType: 'CHARGE',
      entityId: updatedCharge._id,
      action: 'CHARGE_UPDATED',
      performedBy: updatedByUserId,
      campusId: updatedCharge.campusId?._id || updatedCharge.campusId,
      payloadSnapshot: { chargeId, amount: nextAmount, dueDate: nextDueDate },
    });
  }

  return updatedCharge;
}

export async function deleteChargeService(chargeId, deletedByUserId = null) {
  if (!mongoose.Types.ObjectId.isValid(chargeId)) {
    throw new ApiError(400, 'chargeId inválido');
  }

  const charge = await Charge.findById(chargeId).populate('campusId');
  if (!charge) throw new ApiError(404, 'Cargo no encontrado');

  const totalAmount = money(charge.totalAmount);
  const outstandingAmount = money(charge.outstandingAmount);
  const paidAmount = Math.max(totalAmount - outstandingAmount, 0);

  if (paidAmount > 0 || charge.status === 'PAID' || charge.status === 'PARTIAL') {
    throw new ApiError(409, 'No se puede eliminar un cargo que ya tiene pagos aplicados');
  }

  charge.status = 'CANCELLED';
  charge.outstandingAmount = decimal(0);
  await charge.save();

  if (deletedByUserId) {
    await registerAuditLog({
      entityType: 'CHARGE',
      entityId: charge._id,
      action: 'CHARGE_CANCELLED',
      performedBy: deletedByUserId,
      campusId: charge.campusId?._id || charge.campusId,
      payloadSnapshot: { chargeId },
    });
  }

  return { ok: true, chargeId };
}
