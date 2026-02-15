import mongoose from 'mongoose';

const studentCycleSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },

  status: {
    type: String,
    enum: ['ABSENT', 'ENROLLED', 'TRANSFERRED'],
    default: 'ABSENT',
    index: true,
  },

  enrolledAt: { type: Date },
  transferredAt: { type: Date },
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment' },
  matriculaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment' },
  notes: { type: String },
}, { timestamps: true });

studentCycleSchema.index({ studentId: 1, cycleId: 1, campusId: 1 }, { unique: true });

studentCycleSchema.pre('save', function syncEnrollmentIds(next) {
  if (!this.enrollmentId && this.matriculaId) this.enrollmentId = this.matriculaId;
  if (!this.matriculaId && this.enrollmentId) this.matriculaId = this.enrollmentId;
  next();
});

export const StudentCycle = mongoose.model('StudentCycle', studentCycleSchema);
