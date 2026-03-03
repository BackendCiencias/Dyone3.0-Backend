import mongoose from 'mongoose';

const chargeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', required: true, index: true },
  conceptId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingConcept', required: true },
  description: { type: String, required: true },
  totalAmount: { type: mongoose.Types.Decimal128, required: true },
  outstandingAmount: { type: mongoose.Types.Decimal128, required: true },
  dueDate: { type: Date },
  status: { type: String, enum: ['OPEN', 'PARTIAL', 'PAID', 'CANCELLED'], default: 'OPEN' },
  notes: { type: String },
});

chargeSchema.index({ studentId: 1 });
chargeSchema.index({ dueDate: 1 });
chargeSchema.index({ outstandingAmount: 1 });
chargeSchema.index({ campusId: 1, cycleId: 1 });

export const Charge = mongoose.model('Charge', chargeSchema);
