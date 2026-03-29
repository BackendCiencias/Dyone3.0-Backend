import mongoose from 'mongoose';

const programSessionEntrySchema = new mongoose.Schema({
  programEnrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramEnrollment', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  attended: { type: Boolean, default: true },
  paymentStatus: { type: String, enum: ['PAID', 'PENDING'], default: 'PENDING' },
  paymentAmount: { type: mongoose.Types.Decimal128, default: () => mongoose.Types.Decimal128.fromString('0') },
  paymentMethod: { type: String, enum: ['CASH', 'YAPE', 'TRANSFER', 'PENDING'], default: 'PENDING' },
  receivedBy: {
    type: String,
    enum: ['Juan Carlos', 'Juan Manuel', 'Maricarmen', 'Diego', 'Angie', null],
    default: null,
  },
  notes: { type: String },
}, { _id: true });

const programSessionSchema = new mongoose.Schema({
  programId: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', required: true },
  date: { type: Date, required: true },
  wasHeld: { type: Boolean, default: false },
  notes: { type: String },
  entries: { type: [programSessionEntrySchema], default: [] },
});

programSessionSchema.index({ programId: 1, date: 1 }, { unique: true });

export const ProgramSession = mongoose.model('ProgramSession', programSessionSchema);
