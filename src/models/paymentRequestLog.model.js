import mongoose from 'mongoose';

const paymentRequestLogSchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true },
  createdAt: { type: Date, default: Date.now },
});

export const PaymentRequestLog = mongoose.model('PaymentRequestLog', paymentRequestLogSchema);
