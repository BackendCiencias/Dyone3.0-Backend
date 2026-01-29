import mongoose from 'mongoose';

const contractSnapshotSchema = new mongoose.Schema({
  matriculaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Matricula', required: true },
  contractNumber: { type: String },
  createdAt: { type: Date, default: Date.now },
  isSigned: { type: Boolean, default: false },
  notes: { type: String },
});

export const ContractSnapshot = mongoose.model('ContractSnapshot', contractSnapshotSchema);