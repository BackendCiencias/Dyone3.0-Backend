import mongoose from 'mongoose';

const billingConceptSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  isBlocking: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

export const BillingConcept = mongoose.model('BillingConcept', billingConceptSchema);