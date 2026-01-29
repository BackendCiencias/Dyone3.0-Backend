import mongoose from 'mongoose';

const matriculaSchema = new mongoose.Schema({
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true }],
  enrolledAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'CANCELLED'], default: 'CONFIRMED' },
  createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  originSchool: { type: String, required: true },
  notes: { type: String },
});

export const Matricula = mongoose.model('Matricula', matriculaSchema);