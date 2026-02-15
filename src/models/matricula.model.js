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
}, { timestamps: true });

matriculaSchema.index({ studentIds: 1 });
matriculaSchema.index({ cycleId: 1 });
matriculaSchema.index({ campusId: 1 });
matriculaSchema.index({ status: 1 });
matriculaSchema.index({ createdAt: 1 });
matriculaSchema.index({ campusId: 1, cycleId: 1, status: 1, createdAt: 1 });

export const Matricula = mongoose.model('Matricula', matriculaSchema);
