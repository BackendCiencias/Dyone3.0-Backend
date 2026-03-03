import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { Campus } from '../../models/campus.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { Charge } from '../../models/charge.model.js';
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

export async function createChargeService({ studentId, studentCod, cycleId, campusId, conceptName, description, amount, dueDate, notes, createdByUserId = null }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const student = await resolveStudent({ studentId, studentCod }, session);
    const campus = await resolveCampus(campusId, session);
    const concept = await resolveConceptByName(conceptName, session);

    const charge = await Charge.create([
      {
        studentId: student._id,
        cycleId,
        campusId: campus._id,
        conceptId: concept._id,
        description,
        totalAmount: mongoose.Types.Decimal128.fromString(amount.toString()),
        outstandingAmount: mongoose.Types.Decimal128.fromString(amount.toString()),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        status: 'OPEN',
        notes,
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
        payloadSnapshot: { amount, conceptName, cycleId, campusId: campus._id },
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
