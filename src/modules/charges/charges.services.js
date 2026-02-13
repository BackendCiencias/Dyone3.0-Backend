import mongoose from 'mongoose';
import { Student } from '../../models/student.model.js';
import { BillingConcept } from '../../models/billingConcept.model.js';
import { Charge } from '../../models/charge.model.js';
import { ApiError } from '../../utils/errors.js';

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

export async function createChargeService({ studentId, studentCod, cycleId, conceptName, description, amount, dueDate, notes }) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const student = await resolveStudent({ studentId, studentCod }, session);

    let concept = await BillingConcept.findOne({ name: conceptName }).session(session);
    if (!concept) {
      concept = await BillingConcept.create([
        { name: conceptName, isActive: true },
      ], { session });
      concept = concept[0];
    }

    const charge = await Charge.create([
      {
        studentId: student._id,
        cycleId,
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

    return Charge.findById(charge[0]._id)
      .populate({ path: 'studentId', populate: { path: 'personId' } })
      .populate('conceptId')
      .populate('cycleId');
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}
