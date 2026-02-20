import mongoose from 'mongoose';

const vacancySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cycle', required: true },
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Classroom', required: true },
  notes: { type: String },
});

vacancySchema.index({ studentId: 1, cycleId: 1 }, { unique: true });

export const Vacancy = mongoose.model('Vacancy', vacancySchema);
