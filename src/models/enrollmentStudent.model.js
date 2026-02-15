import mongoose from 'mongoose';

export const NO_APLICA_PENSION = -1;
const SCHOOL_MONTHS = 10;

const enrollmentStudentSchema = new mongoose.Schema(
  {
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null, index: true },
    previousSchoolType: {
      type: String,
      enum: ['CIMAS', 'CIENCIAS', 'CIENCIAS_APLICADAS', 'OTHER'],
      default: 'OTHER',
    },
    previousSchoolName: { type: String },
    enrollmentFee: {
      amount: { type: Number, default: 0 },
      isExempt: { type: Boolean, default: false },
      reason: { type: String },
    },
    admissionFee: {
      applies: { type: Boolean, default: false },
      amount: { type: Number, default: 0 },
      isExempt: { type: Boolean, default: false },
      reason: { type: String },
    },
    pensionMonthlyAmounts: {
      type: [Number],
      required: true,
      default: () => Array(SCHOOL_MONTHS).fill(NO_APLICA_PENSION),
      validate: {
        validator: (arr) => Array.isArray(arr)
          && arr.length === SCHOOL_MONTHS
          && arr.every((value) => Number.isFinite(value) && value >= NO_APLICA_PENSION),
        message: `pensionMonthlyAmounts debe tener ${SCHOOL_MONTHS} posiciones y valores >= ${NO_APLICA_PENSION}`,
      },
    },
    agreedAt: { type: Date },
    agreedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    chargesGeneratedAt: { type: Date },
  },
  { timestamps: true }
);

enrollmentStudentSchema.index({ enrollmentId: 1 });
enrollmentStudentSchema.index({ studentId: 1 });
enrollmentStudentSchema.index({ classroomId: 1 });
enrollmentStudentSchema.index({ enrollmentId: 1, studentId: 1 }, { unique: true });

enrollmentStudentSchema.pre('validate', function ensurePreviousSchoolName(next) {
  if (this.previousSchoolType === 'OTHER' && !this.previousSchoolName) {
    this.invalidate('previousSchoolName', 'previousSchoolName es requerido cuando previousSchoolType = OTHER');
  }
  next();
});

export const EnrollmentStudent = mongoose.model('EnrollmentStudent', enrollmentStudentSchema);
