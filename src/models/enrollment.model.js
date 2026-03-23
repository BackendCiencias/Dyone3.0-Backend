import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema(
  {
    cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
    status: { type: String, enum: ['ABSENT', 'ENROLLED', 'TRANSFERRED'], default: 'ABSENT', index: true },
    confirmedAt: { type: Date, default: null },
    transferredAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },

    enrollmentStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EnrollmentStudent', index: true }],
  },
  { timestamps: true }
);

enrollmentSchema.index({ campusId: 1, cycleId: 1, status: 1, createdAt: 1 });
enrollmentSchema.index({ enrollmentStudents: 1 });

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema, 'enrollment');
