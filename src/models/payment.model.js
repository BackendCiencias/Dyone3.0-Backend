import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  paidAt: { type: Date, default: Date.now },
  totalAmount: { type: mongoose.Types.Decimal128, required: true },
  method: { type: String, enum: ['CASH', 'YAPE', 'TRANSFER'], required: true },
  internalCode: { type: String, required: true, unique: true, index: true },
  receiptNumber: { type: String, default: null },
  voucherNumber: { type: String, required: true },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String },
});

export const Payment = mongoose.model('Payment', paymentSchema);
