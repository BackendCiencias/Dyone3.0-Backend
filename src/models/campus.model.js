import mongoose from 'mongoose';

const campusSchema = new mongoose.Schema({
  code: { type: String, enum: ['CIMAS', 'CIENCIAS_PRI', 'CIENCIAS_SEC'], required: true, unique: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String },
});

export const Campus = mongoose.model('Campus', campusSchema);