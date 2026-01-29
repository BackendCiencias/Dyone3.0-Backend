import mongoose from 'mongoose';

const chargeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  conceptId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingConcept', required: true },
  description: { type: String, required: true },
  totalAmount: { type: mongoose.Types.Decimal128, required: true },
  outstandingAmount: { type: mongoose.Types.Decimal128, required: true },
  dueDate: { type: Date },
  status: { type: String, enum: ['OPEN', 'PARTIAL', 'PAID', 'CANCELLED'], default: 'OPEN' },
  notes: { type: String },
});

export const Charge = mongoose.model('Charge', chargeSchema);