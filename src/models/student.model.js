import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  personId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true },
  familyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
  isActive: { type: Boolean, default: true },
  entryDate: { type: Date },
  notes: { type: String },
});

export const Student = mongoose.model('Student', studentSchema);