import mongoose from 'mongoose';

const cycleSchema = new mongoose.Schema({
  type: { type: String, enum: ['SCHOOL_YEAR', 'SUMMER', 'PRE_U'], required: true },
  name: { type: String, required: true },
  year: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

// Índice compuesto por tipo y year para evitar duplicados
cycleSchema.index({ type: 1, year: 1 }, { unique: true });

export const Cycle = mongoose.model('Cycle', cycleSchema);