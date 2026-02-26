import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  roles: { type: [String], enum: ['ADMIN', 'PROMOTER', 'SECRETARY', 'SECRETARY_VIEWER', 'AUXILIAR', 'DIRECTOR', 'TEACHER', 'STUDENT'], required: true },
  campusScope: { type: [String], enum: ['ALL', 'CIENCIAS', 'CIENCIAS_APLICADAS', 'CIMAS'], default: [] },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  notes: { type: String },
});

userSchema.index({ personId: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);