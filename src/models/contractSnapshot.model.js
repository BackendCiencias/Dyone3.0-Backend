import mongoose from 'mongoose';

const contractSnapshotSchema = new mongoose.Schema({
  matriculaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Matricula', required: true },
  contractNumber: { type: String },
  createdAt: { type: Date, default: Date.now },
  isSigned: { type: Boolean, default: false },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle' },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus' },
  students: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    monthlyAmount: { type: Number, required: true },
  }],
  discounts: { type: String },
  exemptions: { type: String },
  confirmedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: { type: Date },
  notes: { type: String },
});

export const ContractSnapshot = mongoose.model('ContractSnapshot', contractSnapshotSchema);
