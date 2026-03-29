import mongoose from 'mongoose';

const programEnrollmentSchema = new mongoose.Schema({
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', default: null },
  pricePerSession: { type: mongoose.Types.Decimal128, required: true, default: () => mongoose.Types.Decimal128.fromString('0') },
  paymentAmount: { type: mongoose.Types.Decimal128, required: true, default: () => mongoose.Types.Decimal128.fromString('0') },
  paymentMethod: { type: String, enum: ['CASH', 'YAPE', 'TRANSFER'], default: 'CASH' },
  paymentDate: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

// Un alumno no debe tener dos inscripciones activas al mismo programa
programEnrollmentSchema.index({ programId: 1, studentId: 1 }, { unique: true });

export const ProgramEnrollment = mongoose.model('ProgramEnrollment', programEnrollmentSchema);
