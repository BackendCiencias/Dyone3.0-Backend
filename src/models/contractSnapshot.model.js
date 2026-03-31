import mongoose from 'mongoose';

const contractSnapshotSchema = new mongoose.Schema({
  enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', index: true },
  matriculaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', index: true },
  contractNumber: { type: String },
  createdAt: { type: Date, default: Date.now },
  isSigned: { type: Boolean, default: false },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle' },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus' },
  students: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    monthlyAmount: { type: Number, required: true },
    pensionMonthlyAmounts: { type: [Number], default: undefined },
    names: { type: String },
    lastNames: { type: String },
    internalCode: { type: String },
    classroom: {
      classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom' },
      label: { type: String },
    },
    previousCampus: { type: String },
    admissionFee: {
      applies: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      isExempt: { type: Boolean, default: false },
      reason: { type: String },
    },
    enrollmentFee: {
      amount: { type: Number, default: 0 },
      isExempt: { type: Boolean, default: false },
      reason: { type: String },
    },
  }],
  tutors: [{
    personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person' },
    names: { type: String },
    lastNames: { type: String },
    dni: { type: String },
    phone: { type: String },
    address: { type: String },
    relationship: { type: String },
    includeInContract: { type: Boolean, default: true },
    linkedStudentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  }],
  discounts: { type: String },
  exemptions: { type: String },
  confirmedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: { type: Date },
  notes: { type: String },
});

contractSnapshotSchema.pre('validate', function syncEnrollmentIds(next) {
  if (!this.enrollmentId && this.matriculaId) this.enrollmentId = this.matriculaId;
  if (!this.matriculaId && this.enrollmentId) this.matriculaId = this.enrollmentId;
  next();
});

export const ContractSnapshot = mongoose.model('ContractSnapshot', contractSnapshotSchema);
