import mongoose from 'mongoose';
import { Charge } from '../../models/charge.model.js';
import { Payment } from '../../models/payment.model.js';
import { PaymentAllocation } from '../../models/paymentAllocation.model.js';
import { Student } from '../../models/student.model.js';
import { ApiError } from '../../utils/errors.js';

export async function createPaymentService({ familyId, campusId, paidAt, method, voucherNumber, allocations, createdByUserId, notes }) {
  const session = await mongoose.startSession();
  session.startTransaction();

try {
    const totalAmountNumber = allocations.reduce((acc, item) => acc + item.amount, 0);

    const payment = await Payment.create([
      {
        familyId,
        campusId,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        totalAmount: mongoose.Types.Decimal128.fromString(totalAmountNumber.toFixed(2)),
        method,
        voucherNumber,
        createdByUserId,
        notes,
      },
    ], { session });

    const createdPayment = payment[0];

    for (const alloc of allocations) {
      const charge = await Charge.findById(alloc.chargeId).session(session);
      if (!charge) {
        throw new ApiError(404, `Cargo no encontrado: ${alloc.chargeId}`);
      }

      const currentOutstanding = parseFloat(charge.outstandingAmount.toString());
      const nextOutstanding = currentOutstanding - alloc.amount;
      if (nextOutstanding < -0.001) {
        throw new ApiError(400, `La asignación excede el saldo pendiente del cargo ${alloc.chargeId}`);
      }

      const normalizedOutstanding = Math.max(nextOutstanding, 0);
      charge.outstandingAmount = mongoose.Types.Decimal128.fromString(normalizedOutstanding.toFixed(2));
      if (normalizedOutstanding === 0) charge.status = 'PAID';
      else if (normalizedOutstanding < parseFloat(charge.totalAmount.toString())) charge.status = 'PARTIAL';
      else charge.status = 'OPEN';

      await charge.save({ session });

      await PaymentAllocation.create([
        {
          paymentId: createdPayment._id,
          chargeId: charge._id,
          amount: mongoose.Types.Decimal128.fromString(alloc.amount.toFixed(2)),
        },
      ], { session });
    }

    await session.commitTransaction();

    const paymentWithAllocations = await Payment.findById(createdPayment._id)
      .populate('familyId')
      .populate('campusId');

    const allocationsSaved = await PaymentAllocation.find({ paymentId: createdPayment._id }).populate('chargeId');

    const students = await Student.find({ familyId }, { _id: 1 });
    const charges = await Charge.find({ studentId: { $in: students.map((s) => s._id) } });

    const summary = charges.reduce(
      (acc, charge) => {
        acc.totalDebt += parseFloat(charge.totalAmount.toString());
        acc.outstandingDebt += parseFloat(charge.outstandingAmount.toString());
        return acc;
      },
      { totalDebt: 0, outstandingDebt: 0 }
    );

    return {
      payment: paymentWithAllocations,
      allocations: allocationsSaved,
      summary,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

export async function getDebtorsService({ cycleId, conceptId, q }) {
  const filter = {
    outstandingAmount: { $gt: mongoose.Types.Decimal128.fromString('0') },
  };

  if (cycleId) filter.cycleId = cycleId;
  if (conceptId) filter.conceptId = conceptId;
  if (q) filter.description = { $regex: q, $options: 'i' };

  return Charge.find(filter)
    .populate({ path: 'studentId', populate: { path: 'personId' } })
    .populate('conceptId');
}