import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true }],
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  paidAt: { type: Date, default: Date.now },
  totalAmount: { type: mongoose.Types.Decimal128, required: true },
  method: { type: String, enum: ['CASH', 'YAPE', 'TRANSFER', 'CAJA_AREQUIPA'], required: true },
  internalCode: { type: String, required: true, unique: true, index: true },
  receiptNumber: { type: String, default: null },
  voucherNumber: { type: String, required: true },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notes: { type: String },
});

paymentSchema.pre('save', function syncStudentScope(next) {
  if ((!Array.isArray(this.studentIds) || !this.studentIds.length) && this.studentId) this.studentIds = [this.studentId];
  if ((!this.studentId || !String(this.studentId)) && Array.isArray(this.studentIds) && this.studentIds.length) this.studentId = this.studentIds[0];
  next();
});

export const Payment = mongoose.model('Payment', paymentSchema);
