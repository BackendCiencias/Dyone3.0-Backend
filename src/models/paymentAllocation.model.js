import mongoose from 'mongoose';

const paymentAllocationSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  chargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Charge', required: true },
  amount: { type: mongoose.Types.Decimal128, required: true },
}, { timestamps: true });

paymentAllocationSchema.index({ paymentId: 1 });
paymentAllocationSchema.index({ chargeId: 1 });

export const PaymentAllocation = mongoose.model('PaymentAllocation', paymentAllocationSchema);
