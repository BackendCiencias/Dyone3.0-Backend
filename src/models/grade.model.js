import mongoose from 'mongoose';

const gradeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  taughtSubjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaughtSubject', required: true },
  termId: { type: mongoose.Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },
  finalScore: { type: String, required: true },
  status: { type: String, enum: ['DRAFT', 'PUBLISHED'], default: 'DRAFT' },
  recordedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recordedAt: { type: Date, default: Date.now },
  notes: { type: String },
});

export const Grade = mongoose.model('Grade', gradeSchema);