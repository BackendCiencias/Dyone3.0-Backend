import mongoose from 'mongoose';

const campusSchema = new mongoose.Schema({
  code: { type: String, enum: ['CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'], required: true, unique: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

export const Campus = mongoose.model('Campus', campusSchema);