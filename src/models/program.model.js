import mongoose from 'mongoose';

const programSchema = new mongoose.Schema({
  campusId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campus', default: null },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

export const Program = mongoose.model('Program', programSchema);
