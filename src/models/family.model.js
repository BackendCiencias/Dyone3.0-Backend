import mongoose from 'mongoose';

const familySchema = new mongoose.Schema({
  tutorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Tutor' }],
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  notes: { type: String },
});

export const Family = mongoose.model('Family', familySchema);