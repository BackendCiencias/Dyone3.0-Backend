import mongoose from 'mongoose';

const personSchema = new mongoose.Schema({
  names: { type: String, required: true },
  lastNames: { type: String, required: true },
  dni: { type: String, required: true, unique: true },
  gender: { type: String, enum: ['Masculino', 'Femenino'], required: true },
  birthDate: { type: Date },
  phone: { type: String },
  address: { type: String },
  email: { type: String },
  nationality: { type: String, default: 'Peruano' },
  foreignIdNumber: { type: String },
  notes: { type: String },
});

export const Person = mongoose.model('Person', personSchema);