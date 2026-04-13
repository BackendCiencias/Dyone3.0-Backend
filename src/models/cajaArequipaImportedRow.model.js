import mongoose from 'mongoose';

const cajaArequipaImportedRowSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true, index: true },
  importSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CajaArequipaImportSession', required: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  campusCode: { type: String, required: true, index: true },
  institution: { type: String, default: null },
  bankCode: { type: String, default: null, index: true },
  receiptNumber: { type: String, default: null },
  subperiod: { type: String, default: null },
  paidAt: { type: Date, default: null },
  reportedAmount: { type: Number, default: 0 },
  commissionAmount: { type: Number, default: 0 },
  moraAmount: { type: Number, default: 0 },
}, { timestamps: true });

export const CajaArequipaImportedRow = mongoose.model('CajaArequipaImportedRow', cajaArequipaImportedRowSchema);
