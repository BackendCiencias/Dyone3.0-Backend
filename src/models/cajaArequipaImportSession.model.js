import mongoose from 'mongoose';

const cajaArequipaImportRowSchema = new mongoose.Schema({
  rowIndex: { type: Number, required: true },
  reviewStatus: { type: String, required: true, index: true },
  fingerprint: { type: String, required: true },
  institution: { type: String, default: null },
  paidAt: { type: Date, default: null },
  operator: { type: String, default: null },
  establishment: { type: String, default: null },
  isWebPayment: { type: Boolean, default: false },
  bankCode: { type: String, default: null },
  pdfStudentName: { type: String, default: null },
  classification: { type: String, default: null },
  receiptNumber: { type: String, default: null },
  subperiod: { type: String, default: null },
  periodYear: { type: Number, default: null },
  monthNumber: { type: Number, default: null },
  monthIndex: { type: Number, default: null },
  monthLabel: { type: String, default: null },
  reportedAmount: { type: Number, default: 0 },
  expectedTuitionAmount: { type: Number, default: 0 },
  commissionAmount: { type: Number, default: 0 },
  moraAmount: { type: Number, default: 0 },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null },
  studentCode: { type: String, default: null },
  studentFullName: { type: String, default: null },
  chargeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Charge', default: null },
  chargeLabel: { type: String, default: null },
  chargeOutstandingAmount: { type: Number, default: 0 },
  observation: { type: String, default: null },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  importedAt: { type: Date, default: null },
}, { _id: false });

const cajaArequipaImportSessionSchema = new mongoose.Schema({
  campusCode: { type: String, required: true, index: true },
  requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  pdfHash: { type: String, required: true, index: true },
  status: { type: String, enum: ['PROCESSING', 'READY', 'FAILED', 'CONFIRMED'], default: 'PROCESSING', index: true },
  summary: { type: mongoose.Schema.Types.Mixed, default: {} },
  rows: { type: [cajaArequipaImportRowSchema], default: [] },
  errorMessage: { type: String, default: null },
  confirmedAt: { type: Date, default: null },
}, { timestamps: true });

export const CajaArequipaImportSession = mongoose.model('CajaArequipaImportSession', cajaArequipaImportSessionSchema);
