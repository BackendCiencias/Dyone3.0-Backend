import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', index: true },
    cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
    campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
    status: { type: String, enum: ['DRAFT', 'CONFIRMED', 'CANCELLED'], default: 'DRAFT', index: true },
    confirmedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },

    enrollmentStudents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EnrollmentStudent', index: true }],

    // Legacy fields (compatibility with existing documents/endpoints)
    studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true }],
    enrolledAt: { type: Date, default: Date.now },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    originSchool: { type: String },
  },
  { timestamps: true }
);

enrollmentSchema.index({ campusId: 1, cycleId: 1, status: 1, createdAt: 1 });
enrollmentSchema.index({ familyId: 1 });
enrollmentSchema.index({ enrollmentStudents: 1 });

enrollmentSchema.pre('save', function syncLegacyFields(next) {
  if (!this.createdBy && this.createdByUserId) this.createdBy = this.createdByUserId;
  if (!this.createdByUserId && this.createdBy) this.createdByUserId = this.createdBy;
  if (!this.confirmedAt && this.status === 'CONFIRMED') this.confirmedAt = this.enrolledAt || new Date();
  next();
});

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema, 'enrollment');
