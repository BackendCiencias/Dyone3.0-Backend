import mongoose from 'mongoose';

const examPassSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  validUntil: { type: Date, required: true },
  reason: { type: String },
  grantedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

export const ExamPass = mongoose.model('ExamPass', examPassSchema);