import mongoose from 'mongoose';

const tutorSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  tutorPersonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  relationship: { type: String, enum: ['Padre', 'Madre', 'Abuelo', 'Abuela', 'Tio', 'Tia', 'Apoderado', 'Otro'], required: true },
  isPrimary: { type: Boolean, default: false },
  livesWithStudent: { type: Boolean, default: true },
  notes: { type: String },
});

export const Tutor = mongoose.model('Tutor', tutorSchema);