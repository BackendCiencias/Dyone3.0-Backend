import { Charge } from '../../models/charge.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { ApiError } from '../../utils/errors.js';
import mongoose from 'mongoose';

export async function createCharges(charges) {
  // charges: array of { studentId, cycleId, conceptId, description, totalAmount, dueDate }
  const created = [];
  for (const ch of charges) {
    const charge = new Charge({
      studentId: ch.studentId,
      cycleId: ch.cycleId,
      conceptId: ch.conceptId,
      description: ch.description,
      totalAmount: mongoose.Types.Decimal128.fromString(ch.totalAmount.toString()),
      outstandingAmount: mongoose.Types.Decimal128.fromString(ch.totalAmount.toString()),
      dueDate: ch.dueDate ? new Date(ch.dueDate) : undefined,
    });
    await charge.save();
    created.push(charge);
  }
  return created;
}

export async function createPaymentService({ familyId, campusId, paidAt, method, totalAmount, allocations, createdByUserId, notes }) {
  // Validar suma de asignaciones
  const sumAlloc = allocations.reduce((acc, a) => acc + a.amount, 0);
  if (Math.abs(sumAlloc - totalAmount) > 0.01) {
    throw new ApiError(400, 'La suma de las asignaciones no coincide con el total pagado');
  }
  // Crear pago
  const payment = new Payment({
    familyId,
    campusId,
    paidAt: paidAt ? new Date(paidAt) : new Date(),
    totalAmount: mongoose.Types.Decimal128.fromString(totalAmount.toString()),
    method,
    createdByUserId,
    notes,
  });
  await payment.save();
  // Procesar asignaciones
  for (const alloc of allocations) {
    const charge = await Charge.findById(alloc.chargeId);
    if (!charge) {
      throw new ApiError(404, `Cargo no encontrado: ${alloc.chargeId}`);
    }
    // convertir a número para restar
    const currentOutstanding = parseFloat(charge.outstandingAmount.toString());
    const newOutstanding = currentOutstanding - alloc.amount;
    if (newOutstanding < -0.001) {
      throw new ApiError(400, 'Asignación excede el saldo pendiente');
    }
    charge.outstandingAmount = mongoose.Types.Decimal128.fromString(Math.max(newOutstanding, 0).toString());
    // actualizar estado
    if (newOutstanding === 0) {
      charge.status = 'PAID';
    } else {
      charge.status = 'PARTIAL';
    }
    await charge.save();
    const allocation = new PaymentAllocation({
      paymentId: payment._id,
      chargeId: charge._id,
      amount: mongoose.Types.Decimal128.fromString(alloc.amount.toString()),
    });
    await allocation.save();
  }
  return payment;
}

export async function getDebtorsService({ campusId, cycleId, conceptId, q }) {
  // Buscar cargos con saldo pendiente
  const filter = {
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
  };
  if (cycleId) {
    filter.cycleId = cycleId;
  }
  if (conceptId) {
    filter.conceptId = conceptId;
  }
  if (q) {
    filter.description = { $regex: q, $options: 'i' };
  }
  // No podemos filtrar por campusId directamente ya que el cargo no tiene campusId
  const charges = await Charge.find(filter)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate('conceptId');
  return charges;
}